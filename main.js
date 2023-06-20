"use strict";

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

let capturelog = [];
let capturebuffers = [];
let objectmap = {}; // capture_id -> object
let asyncmap = {}; // async_id
let labelmap = {};
let mappedBuffers = {};
let device = null;
let playpos = 0;
const logversion = 1; 

function FixupParamsRec(params, base) {
    if ( params===null || params===undefined )
        return;
    var keys = Object.keys(params);
    for ( var i=0; i<keys.length; i++ ) {
        if (params[keys[i]]===null || params[keys[i]]===undefined )
            continue; 
        if (params[keys[i]] == "capture_undefined" ) {
            params[keys[i]] = undefined;
        } else if (params[keys[i]].hasOwnProperty("capture_id") ) {
            params[keys[i]] = objectmap[params[keys[i]].capture_id];
        } else if (typeof params[keys[i]] === 'object' ) {
            FixupParamsRec(params[keys[i]], base);
        } else if (params[keys[i]]=="capture_datafillin_string") {
            console.assert(base.hasOwnProperty("dataindex"));
            let dec = new TextDecoder("utf-8");
            params[keys[i]] = dec.decode(capturebuffers[base.dataindex].data);
            capturebuffers[base.dataindex].refcount2++;
        } else if (params[keys[i]]=="capture_datafillin_u8array") {
            console.assert(base.hasOwnProperty("dataindex"));
            params[keys[i]] = capturebuffers[base.dataindex].data;
            capturebuffers[base.dataindex].refcount2++;
        }
    }
}

function ScaleCanvasToFit(can, intoe) {
    const maxw = intoe.clientWidth; 
    const maxh = intoe.clientHeight; 
    let scalex = maxw / can.width;
    let scaley = maxh / can.height;
    let scale = Math.min(scalex, scaley);
    can.style.width = ((can.width * scale)|0).toString() + "px";
    can.style.height = ((can.height * scale)|0).toString() + "px";
}

window.capture_makeCanvas = function (dim) {
    let can = document.getElementById("can_rendercanvas");
    can.capture_resizeCanvas = function(dim) {
        console.log ( "Resize canvas", dim);
        this.width = dim.width;
        this.height = dim.height;
        ScaleCanvasToFit(this, document.getElementById("div_rendercanvas"));
    }
    can.capture_resizeCanvas(dim);
    return can;
}

function CopyArray ( dest, src ) {
    console.assert(src instanceof Uint8Array);
    if ( dest instanceof Uint8Array ) {
        dest.set(src);
    } else if ( dest instanceof ArrayBuffer ) {
        new Uint8Array(dest).set(src);
    } else {
        console.assert(false);
    }
}

function ReplayCall(callidx, e) {
    console.assert(e.hasOwnProperty("callobj"));
    console.log ( "Replay:", e);
    if (e.call == "createBuffer" ) {
        if ( e.params[0].hasOwnProperty("mappedAtCreation") ) {
            if ( e.params[0].mappedAtCreation == true) {
                mappedBuffers[e.resobj] = { write:true, mappedArray:null };
            } 
        }
        // inject copy source where possible
        if ((e.params[0].usage & (GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE))==0 )
            e.params[0].usage |= GPUBufferUsage.COPY_SRC;
    } else if (e.call == "createTexture" ) {
        // inject copy source
        e.params[0].usage |= GPUTextureUsage.COPY_SRC;
    }

    if (e.call == "unmap" ) {
        if ( mappedBuffers[e.callobj].write == true ) {
            CopyArray ( mappedBuffers[e.callobj].mappedArray, capturebuffers[e.dataindex].data );
            capturebuffers[e.dataindex].refcount2++;
        }
        delete mappedBuffers[e.callobj];
    }
    let o;
    if ( e.callobj==-1 ) 
        o = window;
    else 
        o = objectmap[e.callobj];
    let params = structuredClone(e.params);
    FixupParamsRec(params,e);
    let r = o[e.call].apply(o, params);
    if ( e.hasOwnProperty("resobj")) {
        objectmap[e.resobj] = r;
        r.capture_createdby = callidx;
    }
    if (e.call == "getMappedRange" ) {
        console.assert(r instanceof ArrayBuffer && r.byteLength>0);
        mappedBuffers[e.callobj].mappedArray = r;
    }
    if ( e.call == "destroy" || e.call == "finish" || e.call == "end" )
        objectmap[e.callobj].capture_destroyed = true;
}

function ReplayCallAsync(e) {
    console.log ( "Replay Async:", e);
    console.assert(e.hasOwnProperty("callobj"));
    let o;
    if ( e.callobj==-1 ) {
        if ( e.callasync == "requestAdapter" ) 
            o = navigator.gpu;
        else
            o = window;
    } else {
        o = objectmap[e.callobj];
    }
    if ( e.callasync=="mapAsync" ) {
        let write = (e.params[0] & GPUMapMode.WRITE)!=0;
        mappedBuffers[e.callobj] = { write:write, mappedArray:null };
    }
    let params = structuredClone(e.params);
    FixupParamsRec(params,e);
    let innerp = o[e.callasync].apply(o, params);
    // r is promise here
    let outerp = new Promise((resolve, reject) => {
        innerp.then(
            (res) => { 
                asyncmap[e.asyncid].state = "done";
                asyncmap[e.asyncid].result = res;
                //console.log ( "Setting async result", e.asyncid, res);
                resolve(res); 
            }
        ).catch(
            (reason) => { 
                asyncmap[e.asyncid].state = "failed";
                asyncmap[e.asyncid].reason = reason;
                reject(reason); 
            } 
        );
    });
    asyncmap[e.asyncid] = { state:"pending", result:null, promise:outerp }
}

async function ReplayResolve(logidx, e) {
    console.log ( "Replay Resolve:", e);
    if (asyncmap[e.asyncid].state=="pending") {
        //console.log ( "Replay resolve not ready yet...");
        await asyncmap[e.asyncid].promise;
        //console.log ( "Replay resolve ready now!");
    }
    console.assert(asyncmap[e.asyncid].state!="pending");
    console.assert(asyncmap[e.asyncid].state!="failed" );
    console.assert(asyncmap[e.asyncid].state=="done" );
    if ( e.hasOwnProperty("resobj") && e.resobj!=-1) {
        objectmap[e.resobj] = asyncmap[e.asyncid].result;
        objectmap[e.resobj].capture_createdby = logidx;
    }
    if ( e.resolve=="requestDevice" ) {
        //console.log ( "Special case setting device and queue.");
        device = asyncmap[e.asyncid].result;
        let dq = asyncmap[e.asyncid].result.queue;
        objectmap[e.defaultqueueid] = dq;
    }
    delete asyncmap[e.asyncid];
}

async function ReplayLogEntry(logidx, e) {
    // handle different kinds of entries: 
    if ( e.hasOwnProperty("call") ) {
        ReplayCall(logidx, e);
    } else if ( e.hasOwnProperty("callasync") ) {
        ReplayCallAsync(e);
    } else if ( e.hasOwnProperty("resolve") ) {
        await ReplayResolve(logidx, e);
    } else if ( e.hasOwnProperty("rafmarker") ) {
        
    } else if ( e.hasOwnProperty("marker") ) {
    
    }
}

async function ReplayLog(start, end) {
    for ( let i=start; i<end && i<capturelog.length; i++ ) {
        await ReplayLogEntry(i, capturelog[i]);
        playpos = i+1;
    }
}

function FindNextFrame(start) {
    for ( let i=start; i<capturelog.length; i++ ) {
        if ( capturelog[i].hasOwnProperty("rafmarker" ))
            return i+1;
    }
    return capturelog.length;
}

function Base64toU8(b64string) {
    let binaryString = atob(b64string);
    let bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++)
        bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

function CheckRefCountsOnBuffers(buffers) {
    for ( let i=0; i<buffers.length; i++ ) {
        if ( buffers[i].refcount != buffers[i].refcount2 ) {
            console.log ( "Buffer use count mismatch:", i, buffers[i] );
        }
    }
    console.log ( "Buffer ref counts checked:", buffers.length );
}

function UnpackBuffers(buffers) {
    for ( let i=0; i<buffers.length; i++ ) {
        buffers[i].data = Base64toU8(buffers[i].base64data);
        delete buffers[i].base64data;
        buffers[i].refcount2 = 0;
    }
}

async function LoadURI(uri) {
    let r = await fetch(uri);
    let jr = await r.json();
    console.log ( "Loaded:", jr );
    if ( jr.content != "WebGPU Capture" )
        throw ( "Invalid JSON");
    if ( jr.version != logversion )
        throw ( `JSON version mismatch, Got: ${jr.version} Expected: ${logversion}` );
    capturelog = jr.log;
    capturebuffers = jr.buffers;
    labelmap = jr.labels?jr.labels:{};
    mappedBuffers = [];
    playpos = 0;
    UnpackBuffers(capturebuffers);
}

// UI Code here --------------------------------------------------------------------------------------------------------

// deal with CSP annoyance for opening viewer via extension
function CheckCSPNoInline() {
    try {
        new Function('');
        console.log ( "CSP inline is allowed.");
        return false;
    } catch (err) {
        console.log ( "CSP inline is NOT allowed.");
        return true;
    }
}

let cspnoinline = CheckCSPNoInline();

function FixUpCSPInlineJS(e) {
    if ( cspnoinline==false )
        return;
    function ParseParam(x) {
        if ( x===undefined ) return undefined;
        if ( x=="undefined" ) return undefined;
        return parseInt(x);
    }
    let ce = e.children;
    for ( let i=0; i<ce.length; i++ ) {
        let c = ce[i];
        if ( c instanceof HTMLAnchorElement ) {
            if ( c.href && c.href.startsWith("javascript:") ) {
                // matches only for javascript:document.funcname(a,b) | javascript:document.funcname(a)
                let r = c.href.match(/javascript:document\.(\w+)\(([\w*-]+)(?:,([\w*-]+))?/);
                console.assert(r && r[1]!=undefined);
                c.capture_callname = r[1];
                c.capture_callparam0 = ParseParam(r[2]);
                c.capture_callparam1 = ParseParam(r[3]);
                c.addEventListener('click', (e) => {
                    let t = e.target;
                    document[t.capture_callname](t.capture_callparam0, t.capture_callparam1);
                    e.preventDefault();
                });
                c.href = "";
            }
        } else {
            FixUpCSPInlineJS(c);
        }
    }
} 

// end of CSP 

let commandlistselected = -1;
let objectselected = -1;

function MakeCommandListEntryInner(idx, entrytype, text, selected) {
    let classid = "listentry";
    if ( selected ) classid += " listselected";
    if ( entrytype ) classid += " "+entrytype;
    return `<div class="${classid}">${idx}: ${text}</div>`;
}

function ObjectString(id) {
    let idstr = `${id}`;
    if ( labelmap.hasOwnProperty(idstr) )
        idstr = labelmap[idstr];
    return idstr;
}

function MakeObjectInner(id) {
    return `<a href="javascript:document.GoToCaptureObject(${id});">${ObjectString(id)}</a>`;
}

function MakeResolveInner(e) {
    let r = `Resolve: ${e.resolve}`;
    if ( e.hasOwnProperty("resobj") && e.resobj!=-1 )
        r += ` with ${MakeObjectInner(e.resobj)}`;
    return r;
}

const VarNames = ["a", "b", "c", "d", "e"];

function MakeParamsInner(params, logidx) {
    let r = "(";
    let pnum = params.length;
    while ( pnum>=1 && params[pnum-1]==undefined || params[pnum-1]=="capture_undefined" )
        pnum--;
    for ( let i=0; i<pnum; i++ ) {
        if ( i!=0 ) r+= ", ";
        if ( params[i].hasOwnProperty("capture_id") ) {
            r += MakeObjectInner(params[i].capture_id);
        } else if ( typeof params[i] === 'number' ) {
            r += params[i].toString();
        } else if ( params[i]==undefined || params[i]=="capture_undefined" ) {
            r += "undefined";
        } else {
            r += `<a href="javascript:document.OpenCloseParam(${logidx},${i});">${VarNames[i]}</a>`;
        }
    }
    r+=")";
    return r;
}

function MakeCallInner(e, logidx) {
    let r="";
    if ( e.hasOwnProperty("callobj") && e.callobj!=-1 )
        r+= MakeObjectInner(e.callobj)+".";
    r += `${e.call}`;
    if ( e.hasOwnProperty("callorg") )
        r += `(was ${e.callorg})`;
    if ( e.hasOwnProperty("params") )
        r += " "+MakeParamsInner(e.params, logidx);
    if ( e.hasOwnProperty("resobj") && e.resobj!=-1 )
        r += ` -> ${MakeObjectInner(e.resobj)}`;
    return r;
}

function MakeBufferInner(bufferidx, isstring) {
    return `<a href="javascript:document.GoToBuffer(${bufferidx},${isstring});">${isstring?"S":"B"}${bufferidx}</a>`;
}

function StringifyParamCleanRec(param, logidx) {
    if ( param===null ) return "null";
    if ( param===undefined ) return "undefined";
    if (typeof param === 'number' ) {
        return param.toString();
    } else if ( param == "capture_datafillin_u8array" ) {
        return MakeBufferInner(capturelog[logidx].dataindex, false);
    } else if ( param == "capture_datafillin_string" ) {
        return MakeBufferInner(capturelog[logidx].dataindex, true);
    } else if (typeof param === 'string' ) {
        return param;
    }
    var keys = Object.keys(param);
    if ( keys.length<=0 )
        return "";
    let isArray = Array.isArray(param); 
    let r = isArray?"[":"{";
    for ( var i=0; i<keys.length; i++ ) {
        if ( i!=0 ) r+=",";
        if ( !isArray )
            r+=keys[i]+"=";
        let val = param[keys[i]];
        if (val=="capture_datafillin_string") {
            r += MakeBufferInner(capturelog[logidx].dataindex, true);
        } else if (val=="capture_datafillin_u8array") {
            r += MakeBufferInner(capturelog[logidx].dataindex, false);
        } else if (val.hasOwnProperty("capture_id") ) {
            r += MakeObjectInner(val.capture_id);
        } else if (typeof val === 'object' ) {
            r += StringifyParamCleanRec(val, logidx);
        } else {
            r += JSON.stringify(val);
        }
    }
    r += isArray?"]":"}";
    return r;
}

document.GoToCaptureObject = function(objidx) {
    console.log ( "goto object", objidx );
    SelectObject(objidx);
    ScrollToObject(objidx);
}

document.InspectObject = function(objidx) {
    let obj = objectmap[objidx];
    let objnativetype = ObjectNativeType(obj);
    console.log ( "inspect object", objidx, objnativetype );
    SelectObject(objidx);
    if ( objnativetype=="GPUBuffer" ) {
        ReadbackAndInspectBuffer(obj, objidx);
    } else if ( objnativetype=="GPUTexture" ) {
        ReadbackAndInspectTexture(obj, objidx);
    } else if ( objnativetype=="GPUShaderModule" ) {
        let loge = capturelog[obj.capture_createdby];
        console.assert(loge.params[0].code=='capture_datafillin_string');
        InspectBuffer(capturebuffers[loge.dataindex].data,`S${loge.dataindex} (Input Buffer)`, "Text: UTF-8");
    } else {
        InspectContentError(`Object${objidx}`, "Can not inspect this object type yet.");
    }
}

document.GoToBuffer = function(bufferidx, isstring) {
    console.log ( "go to buffer", bufferidx, isstring );
    InspectBuffer(capturebuffers[bufferidx].data,`${isstring?"S":"B"}${bufferidx} (Input Buffer)`, isstring?"Text: UTF-8":"Raw: u8");
}

document.GoToCall = function(idx) {
    if ( idx === undefined )
        return;
    ScrollToPosCommand(idx);
}

document.OpenCloseParam = function(logidx, paramidx) {
    //console.log ( "open param", logidx, paramidx );
    let e = document.getElementById("div_commandlist").children[logidx];
    // remove (close) it if previously open
    if (e.children && e.children.length>0 ) {
        for ( let i=0; i<e.children.length; i++ ) {
            if ( e.children[i].capture_forparam == paramidx ) {
                e.removeChild(e.children[i]);
                return;
            }
        }
    }
    // open it
    let ep = document.createElement("div");
    ep.classList.add("listparams");
    ep.capture_forparam = paramidx;
    ep.innerHTML = VarNames[paramidx]+"="+StringifyParamCleanRec(capturelog[logidx].params[paramidx],logidx);
    FixUpCSPInlineJS(ep);
    e.append(ep);
}

function MakeCommandListEntry(idx, e, selected) {
    if ( e.hasOwnProperty("call") ) {
        return MakeCommandListEntryInner(idx, undefined, MakeCallInner(e, idx), selected);
    } else if ( e.hasOwnProperty("callasync") ) {
        return MakeCommandListEntryInner(idx, "listasync", e.callasync, selected);
    } else if ( e.hasOwnProperty("resolve") ) {
        return MakeCommandListEntryInner(idx, "listasync", MakeResolveInner(e), selected);
    } else if ( e.hasOwnProperty("rafmarker") ) {
        return MakeCommandListEntryInner(idx, "listmark", "RAF", selected);
    } else if ( e.hasOwnProperty("marker") ) {
        return MakeCommandListEntryInner(idx, "listmark", "Marker "+e.marker, selected);
    } else {
        return MakeCommandListEntryInner(idx, undefined, "Unknown / Error", selected);
    }
}

function ScrollToPosCommand(pos) {
    let cle = document.getElementById("div_commandlist");
    if ( pos<0 ) {
        cle.scrollTop = 0;
        return;
    }
    let es = cle.children;
    if ( pos>=es.length ) {
        cle.scrollTop = cle.scrollHeight;
        return;
    }
    cle.scrollTop = es[pos].offsetTop - cle.offsetHeight/2;
}

function SelectPlayPosInCommandList() {
    if ( commandlistselected == playpos ) 
        return; 
    let es = document.getElementById("div_commandlist").children;
    if ( commandlistselected!=-1 )
        es[commandlistselected].classList.remove("listselected");
    if ( playpos < es.length ) {
        es[playpos].classList.add("listselected");
        commandlistselected = playpos;
    } else {
        commandlistselected = -1;
    }
}

function FillCommandList() {
    let dest = "";
    for ( let i=0; i<capturelog.length; i++ ) {    
        let e = capturelog[i];
        dest += MakeCommandListEntry(i, e, playpos==i);
        dest += "\n";
    }
    let ecl = document.getElementById("div_commandlist");
    ecl.innerHTML = dest;
    FixUpCSPInlineJS(ecl);
    commandlistselected = playpos;
}

function ObjectNativeType(obj) {
    let s = obj.toString();
    return s.slice(8,-1);
}

function CreateObjectListEntry(objidx, obj) {
    let ep = document.createElement("div");
    ep.classList.add("listentry");
    if ( objidx==objectselected ) {
        ep.classList.add ("listselected");
    }
    if ( obj.hasOwnProperty("capture_destroyed") )
        ep.classList.add ( "listdestroyed");
    ep.innerHTML = `<a href="javascript:document.InspectObject(${objidx})">${ObjectString(objidx)}</a>: 
        ${ObjectNativeType(obj)}
        (source: <a href="javascript:document.GoToCall(${obj.capture_createdby})">${obj.capture_createdby}</a>)
    `;
    FixUpCSPInlineJS(ep);
    ep.capture_objidx = objidx;
    obj.capture_listentry = ep;
    return ep; 
}

function FillObjectList() {
    let e = document.getElementById("div_objectlist");
    e.innerHTML = "";
    let cle = e.children;
    for ( let i=0; i<cle.length; i++ )
        e.removeChild(cle[i]);

    let ok = Object.keys(objectmap);
    for ( let i=0; i<ok.length; i++ ) {
        if ( !objectmap.hasOwnProperty("capture_listentry") ) {
            let ee = CreateObjectListEntry(i, objectmap[ok[i]]);
            FixUpCSPInlineJS(ee);
            e.append(ee);
        }
    }
}

function ScrollToObject(objidx) {
    // this is broken. but NO IDEA why. exact same thing works for command list. 
    let e = document.getElementById("div_objectlist");
    let ec = e.children;
    for ( let i=0; i<ec.length; i++ ) {
        if ( ec[i].capture_objidx == objidx ) {
            e.scrollTop = ec[i].offsetTop - e.offsetHeight/2;
            return;
        }
    }
    console.log ( "Could not find elment to scroll to:", objidx);
}

function SelectObject(objidx) {
    let ec = document.getElementById("div_objectlist").children;
    for ( let i=0; i<ec.length; i++ ) {
        if ( ec[i].capture_objidx == objidx )
            ec[i].classList.add ( "listselected")
        else 
            ec[i].classList.remove ( "listselected")
    }
}

let currentcontentbuffer = null;

function InspectSetOutputText(abuf, subtype, rows) {
    let inspe = document.getElementById("div_inspectorcontent");
    inspe.classList.remove("checkerboard");
    let dec = new TextDecoder(subtype);
    let s = dec.decode(abuf);
    inspe.innerHTML = "<pre>"+s+"</pre>";
}

// nans, infs flush to zero (fixme!)
function Convertf16ToNumber(x) {
    let e = (x >> 10) & 0x1f;
    if ( e === 0x1f )
        return 0.0; // flush all nans and infs to 0
    let m = x & 0x3ff;
    const sign = (x >> 15);
    if ( e !== 0 ) { // denormals don't add leading one, normal numbers do
        m |= 0x400; 
        e--;
    }
    if ( sign !== 0 ) 
        m = -m;
    return m * Math.pow(2.0, e-24); // sucks that we have to use Math.pow here, would be an ldexp
}

function FormatAddress(x) {
    return "0x"+x.toString(16).padStart(8,'0')+": ";
}

function InspectSetOutputMessage(msg) {
    let inspe = document.getElementById("div_inspectorcontent");
    inspe.classList.remove("checkerboard");
    inspe.innerHTML = msg;
}

function InspectSetOutputRaw(abuf, subtype, cols) {
    let inspe = document.getElementById("div_inspectorcontent");
    inspe.classList.remove("checkerboard");
    if ( abuf instanceof Uint8Array )
        abuf = abuf.buffer;
    let vbuf;
    let formatf;
    if ( subtype=="u8" ) {
        vbuf = new Uint8Array(abuf);
        formatf = (x) => "0x"+x.toString(16).padStart(2,'0');
    } else if ( subtype=="u16" ) {
        vbuf = new Uint16Array(abuf);
        formatf = (x) => "0x"+x.toString(16).padStart(4,'0');
    } else if ( subtype=="u32" ) {
        vbuf = new Uint32Array(abuf);
        formatf = (x) => "0x"+x.toString(16).padStart(8,'0');
    } else if ( subtype=="i8" ) {
        vbuf = new Int8Array(abuf);
        formatf = (x) => x.toString();
    } else if ( subtype=="i16" ) {
        vbuf = new Int16Array(abuf);
        formatf = (x) => x.toString();
    } else if ( subtype=="i32" ) {
        vbuf = new Int32Array(abuf);
        formatf = (x) => x.toString();
    } else if ( subtype=="f16" ) {
        vbuf = new Uint16Array(abuf);
        formatf = (x) => Convertf16ToNumber(x).toString();
    } else if ( subtype=="f32" ) {
        vbuf = new Float32Array(abuf);
        formatf = (x) => x.toString();
    } else {
        InspectSetOutputMessage("Content filter not implemented yet.");
        return;
    }
    let s = "";
    for ( let i=0; i<vbuf.length; i++ ) {
        if ( i % cols == 0 ) {
            if ( i!=0 ) s+="\n";
            s+=FormatAddress(i);
        }
        s+=formatf(vbuf[i])+" ";
    }
    // fixme: show only n-first elements, then have a "show more" button
    inspe.innerHTML = "<pre>"+s+"</pre>";
}

function BYPPFromFormat(f) {
    if ( f=="r8unorm" ||  f=="r8snorm",
         f=="r8uint" || f=="r8sint" )
        return 1;
    if ( f=="r16float" || f=="rg8unorm" || f=="rg8snorm" )
        return 2;
    if ( f=="rgba8unorm" || f=="rgba8unorm-srgb" || 
         f=="bgra8unorm" || f=="bgra8unorm-srgb" ||
         f=="rgbx8unorm" || f=="xxxa8unorm" || 
         f=="r32float" || f=="rg16float" || f=="depth32float")
        return 4;
    if ( f=="rgba16float" )
        return 8;
    if ( f=="rgba32float" )
        return 16;
    if ( f=="depth24plus")
        return 4;
    return 0;
}

function AspectFromFormat(f) {
    if ( f=="depth24plus" || f=="depth16unorm" || f=="depth32float")
        return "depth-only";
    if ( f=="stencil8")
        return "stencil-only";
    // fixme, handle mixed formats? 
    return "all";
}

function InspectSetOutputImage(abuf, subtype, cols) {
    let inspe = document.getElementById("div_inspectorcontent");
    inspe.classList.add("checkerboard");
    inspe.innerHTML = "";
    if ( abuf instanceof Uint8Array )
        abuf = abuf.buffer;
    let formatf;
    let viewf;
    let bypp = BYPPFromFormat(subtype);
    // fixme linear->srgb for non srgb mode? 
    if ( subtype=="rgba8unorm" || subtype=="rgba8unorm-srgb" ) {
        viewf = new Uint8Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = src[srco+0];  
            dest[desto+1] = src[srco+1];  
            dest[desto+2] = src[srco+2];  
            dest[desto+3] = src[srco+3];  
        };
    } else if ( subtype=="bgra8unorm" || subtype=="bgra8unorm-srgb") {
        viewf = new Uint8Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = src[srco+2];  
            dest[desto+1] = src[srco+1];  
            dest[desto+2] = src[srco+0];  
            dest[desto+3] = src[srco+3];  
        };
    } else if ( subtype=="rgbx8unorm") {
        viewf = new Uint8Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = src[srco+0];  
            dest[desto+1] = src[srco+1];  
            dest[desto+2] = src[srco+2];  
            dest[desto+3] = 255;  
        };
    } else if ( subtype=="xxxa8unorm") {
        viewf = new Uint8Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = src[srco+3];  
            dest[desto+1] = src[srco+3];  
            dest[desto+2] = src[srco+3];  
            dest[desto+3] = 255;  
        };
    } else if ( subtype=="rgba16float" ) {
        viewf = new Uint16Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = (Convertf16ToNumber(src[srco+0]) * 255) | 0;  
            dest[desto+1] = (Convertf16ToNumber(src[srco+1]) * 255) | 0;  
            dest[desto+2] = (Convertf16ToNumber(src[srco+2]) * 255) | 0;  
            dest[desto+3] = (Convertf16ToNumber(src[srco+3]) * 255) | 0;  
        };
    } else if ( subtype=="rgba32float" ) {
        viewf = new Float32Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            dest[desto+0] = (src[srco+0] * 255) | 0;  
            dest[desto+1] = (src[srco+1] * 255) | 0;  
            dest[desto+2] = (src[srco+2] * 255) | 0;  
            dest[desto+3] = (src[srco+3] * 255) | 0;  
        };
    } else if ( subtype=="depth24plus" ) {
        viewf = new Uint32Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            let d = src[srco] & 0xffffff;
            let dnorm = d>>16;
            dest[desto+0] = dnorm;  
            dest[desto+1] = dnorm;  
            dest[desto+2] = dnorm;  
            dest[desto+3] = 255;  
        };
    } else if ( subtype=="depth32float" ) {
        viewf = new Float32Array(abuf);
        formatf = (src, srco, dest, desto ) => { 
            let f = src[srco] * 255;
            if ( !(f>0) ) f=0;
            if ( !(f<255) ) f=255;
            dest[desto+0] = f;  
            dest[desto+1] = f;  
            dest[desto+2] = f;  
            dest[desto+3] = 255;  
        };
    }
    if ( !formatf || !bypp || !viewf ) {
        InspectSetOutputMessage(`View type not implemented yet: ${subtype}`);
        return;
    }
    let rows = abuf.byteLength / (cols*bypp);
    let clipwarn = 0;
    const maxrows = 8192;
    if ( rows>maxrows ) {
        clipwarn = rows;
        rows = maxrows; 
    }
    if ( rows<=0 ) {
        InspectSetOutputMessage("Failed to create image rows. Too little data.");
        return;
    }
    let e = document.createElement("canvas");
    e.width = cols;
    e.height = rows; 
    // set style to scale
    let ctx = e.getContext("2d", {alpha:false});
    let imd = ctx.createImageData(cols, rows);
    let dest = imd.data;
    let srco = 0;
    let desto = 0;
    for ( let y=0; y<rows; y++ ) {
        for ( let x=0; x<cols; x++ ) {
            formatf(viewf, srco, dest, desto);
            srco += bypp/viewf.BYTES_PER_ELEMENT;
            desto+=4;
        }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'copy';
    ctx.putImageData(imd,0,0);
    if ( clipwarn>0 ) {
        let e2 = document.createElement("div");
        e2.innerHTML = `Image was clipped. Displaying only ${maxrows} out of ${clipwarn|0} rows.`;
        inspe.appendChild(e2);
    }
    ScaleCanvasToFit(e, inspe);
    e.classList.add("moveablecanvas");
    SetupCanvasMouseControl(e);
    inspe.appendChild(e);
}

function RoundUp256(x) {
    return (x+255) & (~255);
}

async function ReadbackMapTextureOneLevel(texobj, layer, mip, rbbuf, bypp, aspect) {
    let wmip = mip==0?texobj.width:((texobj.width+1)>>mip);
    let hmip = mip==0?texobj.height:((texobj.height+1)>>mip);
    if ( aspect!="all") {

    }
    let enc = device.createCommandEncoder();
    device.pushErrorScope("validation");
    enc.copyTextureToBuffer( {texture:texobj, miplevel:mip, origin:{ x:0, y:0, z:layer }, aspect:aspect},
        {buffer:rbbuf, offset:0, bytesPerRow:RoundUp256(wmip)*bypp, rowsPerImage:hmip},
        {width:wmip, height:hmip});
    let cmd = enc.finish();
    device.queue.submit([cmd]);
    let err = await device.popErrorScope();
    if (err) {
        console.log("copyTextureToBuffer failed with: ", err);
        return err;
    }
    await rbbuf.mapAsync(GPUMapMode.READ);
    return rbbuf.getMappedRange();
}

function CopyArrayWithOffsetAndStride(destu8, desto, srcab, bytesperline, deststridebytesperline, numlines ) {
    let srcu8 = new Uint8Array(srcab);
    let srco = 0;
    for ( let y=0; y<numlines; y++ ) {
        let desto2 = desto + y * deststridebytesperline;
        for ( let x=0; x<bytesperline; x++ )
            destu8[x+desto2] = srcu8[srco++];
    }
}

async function ReadbackAndInspectTexture(obj, objidx) {
    if ( !(obj instanceof GPUTexture) )
        throw ( "Not a texture");
    let namestr = `RT${objidx} (GPUTexture) ${obj.width}, ${obj.height}, ${obj.depthOrArrayLayers}`;
    if ( (obj.usage & GPUTextureUsage.COPY_SRC)==0 ) {
        InspectContentError(namestr, `Texture can not be read.
        <br>Missing GPUTextureUsage.COPY_SRC usage.
        <br>This usually means it has usage of read or write.
        <br>Or it is the framebuffer texture - which is not yet fixed up for readback.`);
        return;
    }
    let bypp = BYPPFromFormat(obj.format);
    if ( bypp==0 ) {
        InspectContentError(namestr, `Not yet supported texture format ${obj.format}`);
        return;
    }
    let layersize = obj.width*obj.height; 
    if ( obj.mipLevelCount > 1 )
        layersize += obj.width*((obj.height+1)/2);
    layersize *= bypp;
    let bsize = layersize;
    bsize *= obj.depthOrArrayLayers;
    let aspect = AspectFromFormat(obj.format);

    let cpubuf = new Uint8Array(bsize);
    let rbbuf = device.createBuffer ( {size:RoundUp256(obj.width)*obj.height*bypp, usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let desto = 0;
    for ( let d=0; d<obj.depthOrArrayLayers; d++ ) {
        let destolayer = desto;
        let mr = await ReadbackMapTextureOneLevel(obj, d, 0, rbbuf, bypp, aspect );
        if ( mr instanceof GPUValidationError) {
            InspectContentError(namestr, `Failed to copy texture to buffer.<br>${mr.message}`);
            return;
        }
        CopyArrayWithOffsetAndStride(cpubuf, desto, mr, RoundUp256(obj.width)*bypp, obj.width*bypp, obj.height );
        desto += obj.width*obj.height*bypp;
        rbbuf.unmap();
        for ( let m=1; m<obj.mipLevelCount; m++ ) {
            // pack in lower mips
        }
        desto = destolayer + layersize; 
    }
    rbbuf.destroy();

    InspectBuffer(cpubuf, namestr, "Image: "+obj.format, obj.width);
}

async function ReadbackAndInspectBuffer(obj, objidx) {
    if ( !(obj instanceof GPUBuffer) )
        throw ( "Not a buffer");
    let namestr = `RB${objidx} (GPUBuffer)`;
    if ( obj.size > 0x1000000 ) { // 16mb
        if ( !confirm (`This is a very large buffer! ${FormatSize(obj.size)} in total.\nThis is unlikely to work.\nTry anyway?`) ) {
            InspectContentError(namestr, `Buffer is to big: ${FormatSize(obj.size)}`);
            return;
        }
    }
    if ( (obj.usage & GPUBufferUsage.COPY_SRC)==0 ) {
        InspectContentError(namestr, "Buffer can not be read.<br>Missing GPUBufferUsage.COPY_SRC usage.<br>This usually means it has usage of read or write.");
        return;
    }
    let cpubuf = new Uint8Array(obj.size);
    // copy to readable buffer
    let rbbuf = device.createBuffer ( {size:obj.size, usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    let enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(obj, 0, rbbuf, 0, obj.size );
    let cmd = enc.finish();
    device.queue.submit([cmd]);
    await rbbuf.mapAsync(GPUMapMode.READ);
    let mr = rbbuf.getMappedRange();
    cpubuf.set(new Uint8Array(mr));
    rbbuf.unmap();
    rbbuf.destroy();
    InspectBuffer(cpubuf, namestr);
}

function InspectContentError(name, detail) {
    let inspe = document.getElementById("div_inspectorcontent");
    inspe.classList.remove("checkerboard");
    document.getElementById("div_inspectorname").innerHTML = name;
    inspe.innerHTML = detail;
}

function UpdateInspectContent(type, cols) {
    if ( !cols || cols < 1 ) 
        cols = 1;
    document.getElementById("div_inspectorcontent").innerHTML = "";
    if ( !currentcontentbuffer )
        return;
    if ( type.startsWith("Text: ") )
        InspectSetOutputText(currentcontentbuffer, type.slice(6), cols);
    else if ( type.startsWith("Raw: ") )
        InspectSetOutputRaw(currentcontentbuffer, type.slice(5), cols);
    else if ( type.startsWith("Image: ") )
        InspectSetOutputImage(currentcontentbuffer, type.slice(7), cols);
    else    
        throw ( "Unknown output type to inspect");
}

function FormatSize(l) {
    if ( l < 0x10000 ) return `${l}bytes`;
    else if ( l < 0x10000 ) return `${l>>10}kb`; 
    else if ( l < 0x1000000 ) return `${l>>20}mb`; 
    return`${(l/(1<<20))|0}mb`; // handle > 2gb
}

function InspectBuffer(abuf, name, typehint, colshint) {
    currentcontentbuffer = abuf;
    let l = abuf.byteLength;
    let sizestr = FormatSize(l);
    document.getElementById("div_inspectorname").innerHTML = `${name} ${sizestr}`;
    if ( !typehint )
        typehint = "Raw: u8";
    if ( !colshint ) 
        colshint = 8;
    document.getElementById("sel_inspecttype").value = typehint;
    document.getElementById("in_inspectcols").value = colshint;
    UpdateInspectContent(typehint, colshint);
}

function ResetUI() {
    document.getElementById("div_objectlist").innerHTML = "";
    document.getElementById("div_commandlist").innerHTML = "";
    document.getElementById("div_inspectorcontent").innerHTML = "";
}

function GetStyleValue(x) {
    if ( x==undefined ) return 0;
    if ( x=="" ) return 0;
    if ( x.startsWith("scale(")) x=x.slice(6);
    return parseFloat(x);
}

function SetupCanvasMouseControl(can) {
    // this is really shitty, please fixme
    can.addEventListener("mousedown", function (e) {
        let self = e.target;
        if ( e.button==2 ) {
            self.style.transform = "scale(1)"; 
            self.style.top = "0px";
            self.style.left = "0px";
            e.preventDefault();
        }
    });
    can.addEventListener("contextmenu", function(e) {
        e.preventDefault();
        return false;
    });
    can.addEventListener("mousemove", function (e) {
        let self = e.target;
        if ( (e.buttons & 1) == 1) {
            self.style.top = (GetStyleValue(self.style.top) + e.movementY) + 'px';
            self.style.left = (GetStyleValue(self.style.left) + e.movementX) + 'px';
            e.preventDefault();
        }
    });
    can.addEventListener("wheel", function (e) {
        let self = e.target;
        if ( e.deltaY ) {
            let s = GetStyleValue(self.style.transform);
            if ( s==0 ) s=1;
            s += e.deltaY * .001;
            if ( s<0.1 ) s=0.1; 
            if ( s>10.0 ) s=10.0;
            self.style.transform = `scale(${s})`; 
            e.preventDefault();
        }
    });
}

SetupCanvasMouseControl(document.getElementById("can_rendercanvas"));

document.getElementById("btn_load").addEventListener("click", () => {
    document.getElementById("input_file").click();
});

document.getElementById("btn_load_test").addEventListener("click", async () => {
    //await LoadURI("trace.json");
    await LoadURI("demotrace.json");
    ResetUI();
    FillCommandList();
});

document.getElementById("input_file").addEventListener('change', async (event) => {
    const ei = document.getElementById("input_file");
    if ( ei.files.length<=0 )
        return;
    console.log ( "Selected file:", ei.files[0].name);
    const uri = URL.createObjectURL(ei.files[0]);
    await LoadURI(uri);
    URL.revokeObjectURL(uri);
    ResetUI();
    FillCommandList();
    ei.value = "";
});

document.getElementById("btn_play_next").addEventListener("click", async () => {
    await ReplayLog(playpos,playpos+1);
    SelectPlayPosInCommandList();
    FillObjectList();
});

document.getElementById("btn_play_frame").addEventListener("click", async () => {
    let endpos = FindNextFrame(playpos);
    await ReplayLog(playpos,endpos);
    SelectPlayPosInCommandList();
    ScrollToPosCommand(playpos);
    FillObjectList();
});

document.getElementById("btn_play_all").addEventListener("click", async () => {
    await ReplayLog(playpos,capturelog.length);
    CheckRefCountsOnBuffers(capturebuffers);
    SelectPlayPosInCommandList();
    ScrollToPosCommand(playpos);
    FillObjectList();
});

document.getElementById("btn_reset").addEventListener("click", async () => {
    playpos = 0;
    objectmap = {}; // capture_id -> object
    asyncmap = {}; // async_id
    mappedBuffers = {};
    SelectPlayPosInCommandList();
    ScrollToPosCommand(playpos);
    FillObjectList();
});

document.getElementById("sel_inspecttype").addEventListener("change", ()=> {
    UpdateInspectContent ( document.getElementById("sel_inspecttype").value, 
                           document.getElementById("in_inspectcols").value );
});

document.getElementById("in_inspectcols").addEventListener("change", ()=> {
    UpdateInspectContent ( document.getElementById("sel_inspecttype").value, 
                           document.getElementById("in_inspectcols").value );
});