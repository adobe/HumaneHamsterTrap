// Generated file. DO NOT EDIT. 
// This file was copied from the parent directory using
// copytoext.sh
// It is checked in for extension packing convenience only.


// first line intentionally left blank

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

 let WGPUCapture = {
// it sucks to have to write code as an object, but we have to isolate everything (without modules!)
// for injecting into pages via the extension
// WGPUCapture is a singleton object, and only used for isolation
// use the api sub-object for ing stuff

nextresolveid : 0,
nextobjectid : 0,
capturelog : [],
capturebuffers : [],
capturebuffershashlookup : {},
stopped : false,
autostop : -1,
autostopf : null,
framecount : 0,
mappedBuffers : {},
labelmap : {}, // object id -> label, if set
isworker : false,

consolelogon : function() { 
    var args = Array.prototype.slice.call(arguments);
    args.unshift("WebGPU Capture:");
    console.log.apply(console, args);
},

consolelogoff : function() { },

consolelog : function() { 
    var args = Array.prototype.slice.call(arguments);
    args.unshift("WebGPU Capture:");
    console.log.apply(console, args);
},

InjectDestroy : function (obj, name) {
    obj.capture_destroy = obj.destroy; 
    obj.destroy = function() {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog ( "destroy", name );
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call:"destroy", 
                callobj:this.capture_id, 
            });
        }
        this.capture_destroy();
    }
},

BuffersAreEqual : function (a, b) {
    if ( a.length != b.length ) return false;
    if ( a.byteLength != b.byteLength ) return false;
    for ( let i=0; i<a.length; i++ )
        if ( a[i]!=b[i] ) return false;
    return true;
},

HashBuffer : function (data) {
    // simple fnv32 hash
    let h = 0x811c9dc5;
    for ( let i=0; i<data.length; i++ ) {
        h ^= data[i];
        h *= 0x01000193;
        h &= 0xffffffff;
    }
    return h;
},

CaptureBuffer : function (data) {
    if ( typeof data === 'string' || data instanceof String )
        data = new TextEncoder().encode(data);
    console.assert(data instanceof Uint8Array);
    console.assert(data.length>0);
    // here: hash & de-dup, maybe compress, base64 encode
    let hash = WGPUCapture.HashBuffer(data);
    if ( WGPUCapture.capturebuffershashlookup.hasOwnProperty(hash) ) {
        let i = WGPUCapture.capturebuffershashlookup[hash];
        if ( WGPUCapture.BuffersAreEqual(data, WGPUCapture.capturebuffers[i].data) ) {
            WGPUCapture.capturebuffers[i].refcount++;
            return i;
        }
    }
    WGPUCapture.capturebuffers.push({data:data, hash:hash, size:data.length, refcount:1});
    WGPUCapture.capturebuffershashlookup[hash] = WGPUCapture.capturebuffers.length-1;
    return WGPUCapture.capturebuffers.length-1;
},

InjectBuffer : function(buffer, id) {
    buffer.capture_id = id;
    WGPUCapture.InjectLabel(buffer);
    WGPUCapture.InjectDestroy(buffer, "Buffer");
    buffer.capture_getMappedRange = buffer.getMappedRange;
    buffer.getMappedRange = function(offset, size) {
        let arb = this.capture_getMappedRange(offset, size);
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog ("getMappedRange", offset, size);
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call:"getMappedRange", 
                callobj:this.capture_id, 
                params: WGPUCapture.ToCapture([offset, size])
            });
            WGPUCapture.mappedBuffers[this.capture_id].mappedArray = arb; // track it
            WGPUCapture.mappedBuffers[this.capture_id].offset = offset;
        }
        return arb;
    }

    buffer.capture_unmap = buffer.unmap;
    buffer.unmap = function() {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog ("unmap");
            let dataidx = -1;
            if (WGPUCapture.mappedBuffers[this.capture_id].write) {
                let data = WGPUCapture.DeepCopyBufferSourceToU8(WGPUCapture.mappedBuffers[this.capture_id].mappedArray); 
                dataidx = WGPUCapture.CaptureBuffer(data);
            }
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call:"unmap",
                callobj:this.capture_id,
                dataindex:dataidx
            });
            delete WGPUCapture.mappedBuffers[this.capture_id];
        }
        this.capture_unmap();
    }

    buffer.capture_mapAsync = buffer.mapAsync; 
    buffer.mapAsync = function(mode, offset, size) {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog ( "mapAsync", mode, offset, size)
            let resolveid = WGPUCapture.nextresolveid++;
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                callasync:"mapAsync", callobj:this.capture_id, 
                params: WGPUCapture.ToCapture([mode, offset, size]),
                asyncid:resolveid 
            });
            let innnerp = this.capture_mapAsync(mode, offset, size);
            let wrapp = new Promise((resolve, reject) => {
                innnerp.then(
                    () => { 
                        WGPUCapture.capturelog.push ( { time:performance.now(), 
                            resolve:"mapAsync", 
                            asyncid:resolveid
                        });
                        console.assert(!WGPUCapture.mappedBuffers.hasOwnProperty(this.capture_id));
                        WGPUCapture.mappedBuffers[this.capture_id] = { mappedArray : null, write : (mode & GPUMapMode.WRITE)!=0, offset : offset };
                        WGPUCapture.consolelog ( "mapAsync resolved");
                        resolve(); 
                    }
                ).catch(
                    () => { 
                        WGPUCapture.capturelog.push ( { time:performance.now(), 
                            reject:"mapAsync", 
                            asyncid:resolveid 
                        });
                        WGPUCapture.consolelog ( "mapAsync failed");
                        reject(reason); 
                    } 
                );
            });
            return wrapp;
        } else {
            return this.capture_mapAsync(mode, offset, size);
        } 
    }
},

DeepCopyBufferSourceToU8 : function (data, offset, size) {
    // hope this is correct 
    if ( data instanceof ArrayBuffer ) {
        if ( !size )
            size = data.byteLength;
        return new Uint8Array(new Uint8Array(data, offset, size));
    } else {
        if ( !size )
            size = data.byteLength / data.BYTES_PER_ELEMENT;
        let u8view = new Uint8Array(data.buffer, data.byteOffset + offset*data.BYTES_PER_ELEMENT, size*data.BYTES_PER_ELEMENT);
        return new Uint8Array(u8view);
    } 
},

InjectQueue : function (queue, id) {
    queue.capture_id = id;
    WGPUCapture.InjectLabel(queue);
    WGPUCapture.InjectDoFunction(queue, "submit");
    queue.capture_writeBuffer = queue.writeBuffer;
    queue.writeBuffer = function ( buffer, bufferOffset, data, dataOffset, size ) {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog("writeBuffer");
            let datau8 = WGPUCapture.DeepCopyBufferSourceToU8(data, dataOffset, size);
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call: "writeBuffer", 
                callobj: this.capture_id, 
                params: WGPUCapture.ToCapture([buffer, bufferOffset, "capture_datafillin_u8array", 0, undefined]),
                dataindex: WGPUCapture.CaptureBuffer(datau8),
            });
        }
        this.capture_writeBuffer(buffer, bufferOffset, data, dataOffset, size);
    }

    queue.capture_writeTexture = queue.writeTexture;
    queue.writeTexture = function ( dest, data, layout, texsize ) {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog("writeTexture");
            let datau8 = WGPUCapture.DeepCopyBufferSourceToU8(data, 0);
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call: "writeTexture", 
                callobj: this.capture_id, 
                params: WGPUCapture.ToCapture([dest, "capture_datafillin_u8array", layout, texsize]),
                dataindex: WGPUCapture.CaptureBuffer(datau8),
            });
        }
        this.capture_writeTexture(dest, data, layout, texsize);
    }

    queue.capture_copyExternalImageToTexture = queue.copyExternalImageToTexture;
    queue.copyExternalImageToTexture = function ( source, dest, copysize ) {
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog("copyExternalImageToTexture");
            let datau8 = null;
            let h = 0;
            let w = 0;
            if ( !source.origin ) source.origin = { x:0, y:0 };
            if ( !source.flipY ) source.flipY = false;
            let realsource = source.source;
            if ( realsource instanceof HTMLVideoElement ) {
                WGPUCapture.consolelog("Failed to capture external texture from video, not yet supported.")
            }
            if ( realsource instanceof HTMLCanvasElement ) {
                let ctx2d = realsource.getContext('2d');
                if ( ctx2d ) { 
                    w = realsource.width - source.origin.x;
                    h = realsource.height - source.origin.y;
                    let imd = ctx2d.getImageData(source.origin.x,source.origin.y,w,h);
                    datau8 = new Uint8Array(imd.data.buffer);
                } else {
                    // TODO: do a horrible dance with toDataURL 
                    WGPUCapture.consolelog("Failed to capture external texture from canvas, only 2d supported right now.")
                }
            } 
            if ( realsource instanceof OffscreenCanvas ) {
                realsource = realsource.transferToImageBitmap();
            }
            if ( realsource instanceof ImageBitmap ) {
                w = realsource.width - source.origin.x;
                h = realsource.height - source.origin.y;
                let cantemp = new OffscreenCanvas(w,h);
                let ctxtemp = cantemp.getContext("2d");
                ctxtemp.globalCompositeOperation = "copy";
                ctxtemp.drawImage(realsource, -source.origin.x, -source.origin.y);
                let imd = ctxtemp.getImageData(0,0,w,h);
                datau8 = new Uint8Array(imd.data.buffer);
            }
            // FIXME: handle source.source instanceof HTMLVideoElement
            if ( datau8 ) {
                WGPUCapture.capturelog.push ( { time:performance.now(), 
                    call: "writeTexture", 
                    callorg: "copyExternalImageToTexture", 
                    callobj: this.capture_id, 
                    params: WGPUCapture.ToCapture([dest, "capture_datafillin_u8array", {offset:0, bytesPerRow:w*4, rowsPerImage:h}, copysize]),
                    dataindex: WGPUCapture.CaptureBuffer(datau8),
                });
            } else {
                WGPUCapture.consolelog("Failed to capture external texture.")
            }
        }
        this.capture_copyExternalImageToTexture(source, dest, copysize);
    }
    // Promise<undefined> onSubmittedWorkDone();
},

InjectLabel : function(obj) {
    if ( obj.hasOwnProperty("capture_label") )
        return;
    obj.capture_label = obj.label;
    Object.defineProperty(obj, "label", {
        get : function () {
            return this.capture_label;
        },
        set : function (x) { 
            this.capture_label = x; 
            WGPUCapture.labelmap[this.capture_id] = x;
        }
    })
},

InjectDefault : function (obj, id) {
    obj.capture_id = id;
    WGPUCapture.InjectLabel(obj);
},

InjectTexture : function(obj, id) {
    obj.capture_id = id;
    WGPUCapture.InjectLabel(obj);
    WGPUCapture.InjectDestroy(obj, "Texture");
    WGPUCapture.InjectCreateFunction(obj, "createView", WGPUCapture.InjectDefault);
},

InjectBindingCommandsMixin : function(obj) {
    WGPUCapture.InjectDoFunction(obj, "setBindGroup");
},

InjectDebugCommandsMixin : function(obj) {
    WGPUCapture.InjectDoFunction(obj, "pushDebugGroup");
    WGPUCapture.InjectDoFunction(obj, "popDebugGroup");
    WGPUCapture.InjectDoFunction(obj, "insertDebugMarker");
},

InjectRenderCommandsMixin : function (obj) {
    WGPUCapture.InjectDoFunction(obj, "setPipeline");
    WGPUCapture.InjectDoFunction(obj, "setIndexBuffer");
    WGPUCapture.InjectDoFunction(obj, "setVertexBuffer");
    WGPUCapture.InjectDoFunction(obj, "draw");
    WGPUCapture.InjectDoFunction(obj, "drawIndexed");
    WGPUCapture.InjectDoFunction(obj, "drawIndirect");
    WGPUCapture.InjectDoFunction(obj, "drawIndexedIndirect");
},

InjectRenderPass : function (pass, id) {
    pass.capture_id = id;
    WGPUCapture.InjectLabel(pass);
    WGPUCapture.InjectDoFunction(pass, "setViewport");
    WGPUCapture.InjectDoFunction(pass, "setScissorRect");
    WGPUCapture.InjectDoFunction(pass, "setBlendConstant");
    WGPUCapture.InjectDoFunction(pass, "setStencilReference");
    WGPUCapture.InjectDoFunction(pass, "beginOcclusionQuery");
    WGPUCapture.InjectDoFunction(pass, "endOcclusionQuery");
    WGPUCapture.InjectDoFunction(pass, "executeBundles");
    WGPUCapture.InjectDoFunction(pass, "end");
    WGPUCapture.InjectBindingCommandsMixin (pass);
    WGPUCapture.InjectRenderCommandsMixin (pass);
    WGPUCapture.InjectDebugCommandsMixin(pass);
},

InjectComputePass : function (pass, id) {
    pass.capture_id = id;
    WGPUCapture.InjectLabel(pass);
    WGPUCapture.InjectDoFunction(pass, "setPipeline");
    WGPUCapture.InjectDoFunction(pass, "dispatchWorkgroups");
    WGPUCapture.InjectDoFunction(pass, "dispatchWorkgroupsIndirect");
    WGPUCapture.InjectDoFunction(pass, "end");
    WGPUCapture.InjectBindingCommandsMixin(pass);
    WGPUCapture.InjectDebugCommandsMixin(pass);
},

InjectCommandEncoder : function(enc, id) {
    enc.capture_id = id;
    WGPUCapture.InjectLabel(enc);
    WGPUCapture.InjectCreateFunction(enc,"beginRenderPass", WGPUCapture.InjectRenderPass);
    WGPUCapture.InjectCreateFunction(enc,"beginComputePass", WGPUCapture.InjectComputePass);
    WGPUCapture.InjectCreateFunction(enc,"finish", WGPUCapture.InjectDefault);
    WGPUCapture.InjectDoFunction(enc,"copyBufferToBuffer");
    WGPUCapture.InjectDoFunction(enc,"copyBufferToTexture");
    WGPUCapture.InjectDoFunction(enc,"copyTextureToBuffer");
    WGPUCapture.InjectDoFunction(enc,"copyTextureToTexture");
    WGPUCapture.InjectDoFunction(enc,"clearBuffer");
    WGPUCapture.InjectDoFunction(enc,"writeTimestamp");
    WGPUCapture.InjectDoFunction(enc,"resolveQuerySet"); //??
    WGPUCapture.InjectDebugCommandsMixin(enc);
},

InjectRenderBundleEncoder : function(enc, id) {
    enc.capture_id = id;
    WGPUCapture.InjectLabel(enc);
    WGPUCapture.InjectCreateFunction(enc,"finish", WGPUCapture.InjectDefault);
    WGPUCapture.InjectBindingCommandsMixin(enc);
    WGPUCapture.InjectRenderCommandsMixin(enc);
    WGPUCapture.InjectDebugCommandsMixin(enc);
},

InjectPipeline : function(pipe, id) {
    pipe.capture_id = id;
    WGPUCapture.InjectLabel(pipe);
    WGPUCapture.InjectCreateFunction(pipe,"getBindGroupLayout", WGPUCapture.InjectDefault);
},

ToCapture : function (args) {
    // fix up undefined values to survive json
    let anyundef = false;
    for ( let i=0; i<args.length; i++ ) {
        if ( args[i]===undefined ) {
            args[i] = "capture_undefined";
            anyundef = true;
        }
    }
    let s = JSON.parse(JSON.stringify(args)); 
    // undo undefined changes
    if ( anyundef ) {
        for ( let i=0; i<args.length; i++ ) {
            if ( args[i]=="capture_undefined" )
                args[i] = undefined;
        }
    }
    return s;
},

InjectDoFunction : function (obj, name) {
    let cname = "capture_"+name; 
    obj[cname] = obj[name];
    obj[name] = function () {
        let args = Array.prototype.slice.call(arguments);
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog ( name, args);
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call: name, 
                callobj: this.capture_id, 
                params: WGPUCapture.ToCapture(args),
            } );
        }
        this[cname].apply(this, args);
    }
},

InjectCreateFunction : function (obj, name, injectf, extraf) {
    let cname = "capture_"+name; 
    obj[cname] = obj[name];
    obj[name] = function () {
        let args = Array.prototype.slice.call(arguments);
        let r = this[cname].apply(this, args);
        if ( !WGPUCapture.stopped ) {
            WGPUCapture.consolelog (name, args);
            let resid;
            if ( r.hasOwnProperty("capture_id") ) { // has already been injected, happens for get-create functions like getCurrentTexture
                resid = r.capture_id;
                WGPUCapture.consolelog (name, "returned object that was already injected");
            } else {
                resid = WGPUCapture.nextobjectid++;
                injectf(r, resid);
            }
            if ( extraf )
                extraf(obj, r);
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call:name, 
                callobj:this.capture_id, 
                params:WGPUCapture.ToCapture(args),
                resobj:resid
            });
        }
        return r;
    }
},

InjectAsyncCreate : function(obj, name, injectf, extraf ) {
    let cname = "capture_"+name; 
    obj[cname] = obj[name];
    obj[name] = function () {
        let args = Array.prototype.slice.call(arguments);
        let innerp = this[cname].apply(this, args);
        if ( WGPUCapture.stopped ) {
            return innerp;
        } else {
            WGPUCapture.consolelog ( name, args)
            let resolveid = WGPUCapture.nextresolveid++;
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                callasync: name, 
                callobj: obj.capture_id, 
                params: WGPUCapture.ToCapture(args), 
                asyncid: resolveid 
            });
            let wrapp = new Promise((resolve, reject) => {
                innerp.then((r) => {
                    console.assert ( !r.hasOwnProperty("capture_id") );
                    let resid = WGPUCapture.nextobjectid++;
                    injectf(r, resid);
                    if ( extraf )
                        extraf(obj, r);
                    WGPUCapture.capturelog.push ( { time:performance.now(), 
                        resolve: name,
                        asyncid:resolveid, 
                        resobj:resid
                    });
                    WGPUCapture.consolelog ( name, "resolved", resolveid);
                    resolve(r); 
                }).catch((reason) => { 
                    WGPUCapture.capturelog.push ( { time:performance.now(), 
                        reject: name, 
                        asyncid:resolveid 
                    });
                    WGPUCapture.consolelog ( name, "failed", reason, resolveid);
                    reject(reason); 
                });
            });
            return wrapp;
        } 
    }
},

InjectDevice : function(device, id, defaultqueueid) {
    WGPUCapture.InjectLabel(device);
    WGPUCapture.InjectQueue(device.queue, defaultqueueid);
    device.capture_id = id; 
    // create buffer is special: need to track mapped at creation
    device.capture_createBuffer = device.createBuffer;
    device.createBuffer = function (desc) {
        let bufferid = WGPUCapture.nextobjectid++;
        if ( desc.mappedAtCreation ) {
            console.assert(!WGPUCapture.mappedBuffers.hasOwnProperty(bufferid));
            WGPUCapture.mappedBuffers[bufferid] = { mappedArray : null, write : true, offset : 0 };
        }
        WGPUCapture.capturelog.push ( { time:performance.now(), 
            call: "createBuffer", 
            callobj: this.capture_id, 
            params: WGPUCapture.ToCapture([desc]),
            resobj: bufferid
        } );
        let buffer = this.capture_createBuffer(desc);
        WGPUCapture.InjectBuffer(buffer, bufferid);
        return buffer;
    }
    // shader module is special, put content of shader outside
    device.capture_createShaderModule = device.createShaderModule;
    device.createShaderModule = function ( desc ) {
        let r = this.capture_createShaderModule(desc);
        if ( !WGPUCapture.stopped ) {
            let resid = WGPUCapture.nextobjectid++;
            WGPUCapture.consolelog ( "createShaderModule", desc );
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call: "createShaderModule", 
                callobj: this.capture_id, 
                params: [{ code: "capture_datafillin_string" }],
                dataindex: WGPUCapture.CaptureBuffer(desc.code),
                resobj: resid
            } );
            WGPUCapture.InjectDefault(r,resid);
        }
        return r;
    }
    WGPUCapture.InjectCreateFunction(device, "createTexture", WGPUCapture.InjectTexture);
    WGPUCapture.InjectCreateFunction(device, "createSampler", WGPUCapture.InjectDefault); // desc is optional
    WGPUCapture.InjectCreateFunction(device, "createBindGroupLayout", WGPUCapture.InjectDefault);
    WGPUCapture.InjectCreateFunction(device, "createPipelineLayout", WGPUCapture.InjectDefault);
    WGPUCapture.InjectCreateFunction(device, "createBindGroup", WGPUCapture.InjectDefault);
    WGPUCapture.InjectCreateFunction(device, "createComputePipeline", WGPUCapture.InjectPipeline);
    WGPUCapture.InjectCreateFunction(device, "createRenderPipeline", WGPUCapture.InjectPipeline);
    WGPUCapture.InjectCreateFunction(device, "createCommandEncoder", WGPUCapture.InjectCommandEncoder);
    WGPUCapture.InjectCreateFunction(device, "createRenderBundleEncoder", WGPUCapture.InjectRenderBundleEncoder);
    WGPUCapture.InjectCreateFunction(device, "createQuerySet", WGPUCapture.InjectDefault);
    WGPUCapture.InjectCreateFunction(device, "importExternalTexture", WGPUCapture.InjectDefault);

    WGPUCapture.InjectAsyncCreate(device, "createComputePipelineAsync", WGPUCapture.InjectPipeline);
    WGPUCapture.InjectAsyncCreate(device, "createRenderPipelineAsync", WGPUCapture.InjectPipeline);

},

InjectAdapter : function (adapter, id) {
    //this.InjectAsyncCreate(adapter, "requestDevice", this.InjectDevice);
    adapter.capture_id = id;
    WGPUCapture.InjectLabel(adapter);
    adapter.capture_requestDevice = adapter.requestDevice; 
    adapter.requestDevice = function (desc) {
        WGPUCapture.consolelog ( "requestDevice", desc)
        let resolveid = WGPUCapture.nextresolveid++;
        WGPUCapture.capturelog.push ( { time:performance.now(), 
            callasync: "requestDevice", 
            callobj: adapter.capture_id, 
            params: WGPUCapture.ToCapture([desc]), 
            asyncid: resolveid 
        });
        let innnerp = this.capture_requestDevice(desc);
        let wrapp = new Promise((resolve, reject) => {
            innnerp.then(
                (device) => { 
                    let deviceid = WGPUCapture.nextobjectid++;
                    let defaultqueueid = WGPUCapture.nextobjectid++;
                    WGPUCapture.capturelog.push ( { time:performance.now(), 
                        resolve:"requestDevice", 
                        defaultqueueid:defaultqueueid,
                        asyncid:resolveid, 
                        resobj:deviceid 
                    });
                    WGPUCapture.consolelog ( "requestDevice resolved", device);
                    WGPUCapture.InjectDevice(device, deviceid, defaultqueueid);
                    resolve(device); 
                }
            ).catch(
                (reason) => { 
                    WGPUCapture.capturelog.push ( { time:performance.now(), 
                        reject:"requestDevice", 
                        asyncid:resolveid 
                    });
                    WGPUCapture.consolelog ( "requestDevice failed", reason);
                    reject(reason); 
                } 
            );
        });
        return wrapp;
    }
    
    // adapter.requestAdapterInfo() - not needed for playback  
},

InjectContext : function(ctx, id) {
    ctx.capture_id = id; 
    WGPUCapture.InjectLabel(ctx);
    ctx.capture_configure = ctx.configure;
    ctx.configure = function (config) {
        WGPUCapture.consolelog ( "configure", config );
        this.capture_configure(config);
        WGPUCapture.capturelog.push ( { time:performance.now(), 
            call: "configure", 
            callobj: ctx.capture_id, 
            params: WGPUCapture.ToCapture([config]) 
        });
    }
    WGPUCapture.InjectCreateFunction(ctx,"getCurrentTexture", WGPUCapture.InjectTexture, (ctx, texture) => {
        let can = ctx.capture_canvas;
        if ( can.width!=can.capture_width || can.height!=can.capture_height ) {
            WGPUCapture.consolelog ( "Canvas size changed", can.width, can.height );
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call:"capture_resizeCanvas", 
                callobj:can.capture_id, 
                params:WGPUCapture.ToCapture([{width:can.width, height:can.height}])
            });
            can.capture_width = can.width;
            can.capture_height = can.height; 
        }
    });
},

InjectCanvasClass : function(c) {
    c.prototype.capture_getContext = c.prototype.getContext;
    c.prototype.getContext = function (kind,opts) {
        WGPUCapture.consolelog ( "getContext", kind, opts);
        let ctx = this.capture_getContext(kind, opts);
        if ( kind!='webgpu' )
            return ctx;
        let canid;
        if ( this.hasOwnProperty("capture_id") ) {
            canid = this.capture_id;
        } else {
            canid = WGPUCapture.nextobjectid++;
            this.capture_id = canid;
            WGPUCapture.capturelog.push ( { time:performance.now(), 
                call: "capture_makeCanvas", 
                callobj: -1, 
                resobj: canid, 
                params: WGPUCapture.ToCapture([{width:this.width, height:this.height}])
            });
            this.capture_width = this.width;
            this.capture_height = this.height;
            ctx.capture_canvas = this;
        }
        let ctxid = WGPUCapture.nextobjectid++;
        WGPUCapture.InjectContext(ctx, ctxid);
        WGPUCapture.capturelog.push ( { time:performance.now(), 
            call: "getContext", 
            callobj: canid, 
            params: WGPUCapture.ToCapture(["webgpu",opts]), 
            resobj: ctxid 
        });
        return ctx;
    }
},

MarkRAF : function (executed) {
    if ( WGPUCapture.stopped )
        return;
    let t = performance.now();
    if ( WGPUCapture.capturelog.length>=1 && WGPUCapture.capturelog[WGPUCapture.capturelog.length-1].hasOwnProperty("rafmarker")) {
        let logentry = WGPUCapture.capturelog[WGPUCapture.capturelog.length-1];
        logentry.rafmarker = "multiple";
        logentry.count++;
        if ( executed ) {
            logentry.firstexec = Math.min(logentry.firstexec, t);
            logentry.lastexec = Math.max(logentry.lastexec, t);
        } else {
            logentry.firstreq = Math.min(logentry.firstreq, t);
            logentry.lastreq = Math.max(logentry.lastreq, t);
        }
    } else {
        WGPUCapture.capturelog.push ( { time:t, 
            rafmarker:"once", 
            firstexec:executed?t:Number.POSITIVE_INFINITY, 
            lastexec:executed?t:Number.NEGATIVE_INFINITY,
            firstreq:executed?Number.POSITIVE_INFINITY:t,
            lastreq:executed?Number.NEGATIVE_INFINITY:t,
            count:1, 
        });
        WGPUCapture.framecount++;
        if ( WGPUCapture.autostop!=-1 && WGPUCapture.framecount >= WGPUCapture.autostop ) {
            WGPUCapture.api.Stop();
            const fname = 'trace.json';
            if ( WGPUCapture.isworker ) {
                // can not download in a worker, send a message back to main instead
                // fixme: transfer as array buffer instead
                let blob = WGPUCapture.api.GetBlob();
                self.postMessage({msg:"capture_blob", blob:blob, fname:fname}, []);
            } else { 
                WGPUCapture.api.Download(fname);
            }
            if ( WGPUCapture.autostopf )
                WGPUCapture.autostopf (fname);
        }
    }
},

Base64Encode : function (data) {
    let binstring = "";
    for (let i = 0; i < data.length; i++)
        binstring += String.fromCharCode(data[i]);
    return btoa(binstring);
},

DownloadBlob : function (blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
},

capture_extid : "deonfghfkdlfcfklhgfefgoldkgmdffd",

InjectWorkerConstructor : function () {
    // this is a bit of a mess: in order to inject our capture code into the worker
    // we need to overwrite the new Worker() function.
    // then we can append our code before starting the worker.
    // to get our code, we must make an async fetch request (and the blob making is also async)
    // but the new Worker() function is sync! so it has to return a fake worker object, which records 
    // all calls made on it. once the async real worker is ready, it can replay all of those calls on it. 

    async function InjectFakeWorkerFromBlob(fakeworker, blob, fixupimports) {
        let f1 = await fetch(`chrome-extension://${WGPUCapture.capture_extid}/ext/wgpucapext.js`);
        let f2 = await fetch(`chrome-extension://${WGPUCapture.capture_extid}/startcapture.js`);
        let b1 = await f1.blob();
        let b2 = await f2.blob();
        let bt = await blob.text();
        let b3;
        if ( fixupimports ) {
            // here we have to fixup import statementsd if the worker is a module...
            // this is a bug with the module worker from blob api, as there is no way to specify a base url
            // for sub-imports
            const regex = /(import.+from.+["'])(.+)(["'])/g
            let bt2 = bt.replaceAll(regex, function (matched, c1, c2, c3) {
                let cated = c1 + fixupimports + c2 + c3;
                console.log ( "Fixed import. Was:", matched, "Now:", cated);
                return cated;
            });
            b3 = new Blob([b1,b2,bt2], {type:"application/javascript"} );
        } else {
            b3 = new Blob([b1,b2,blob], {type:"application/javascript"} );
        }

        let bloburl = URL.createObjectURL(b3);
        let realworker = new WGPUCapture.capture_worker(bloburl, fakeworker.orgopts);
        console.log ("Made a real worker", fakeworker.orgopts);
        fakeworker.realIsReal(realworker);
        // bug in Chrome? if i revoke here, only if {type='module'} nothing happens... 
        // URL.revokeObjectURL(bloburl); 
    }

    WGPUCapture.capture_worker = Worker;
    Worker = function (url, opts) {
        if ( WGPUCapture.stopped )
            return new (WGPUCapture.capture_worker, url, opts);

        console.log ("New worker for: ", url, opts);
        let ismodule = (opts && opts.type=='module');
        let fakeworker = {
            orgopts : opts,
            realworker : null,
            calllater : [],
            postMessage : function ( msg, transfer ) {
                if ( this.realworker )
                    this.realworker.postMessage(msg, transfer);
                else
                    this.calllater.push({call:"postMessage", args:[msg,transfer]});
            },
            addEventListener : function (a, b, c) {
                if ( this.realworker )
                    this.realworker.addEventListener(a,b,c);
                else
                    this.calllater.push({call:"addEventListener", args:[a,b,c]});
            },
            removeEventListener : function (a, b, c) {
                if ( this.realworker )
                    this.realworker.removeEventListener(a,b,c);
                else
                    this.calllater.push({call:"removeEventListener", args:[a,b,c]});
            },

            // etc..
            realIsReal(real) {
                console.log ("Crazy worker hack unwinding. ");
                this.realworker = real;
                real.onerror = function(evt) {
                    console.error ("The worker threw an error. This is most likely because of some module importing got broken.", evt.message);
                }
                for ( let i=0; i<this.calllater.length; i++ ) {
                    let e = this.calllater[i];
                    console.log ("Delay call:", real, e.call, e.args);
                    real[e.call].apply(real, e.args);
                }
                delete this.calllater;
                // also listen on the new worker for downloads
                real.addEventListener("message", function handleMessageFromWorker(msg) {
                    if ( msg.data.msg && msg.data.msg == "capture_blob") {
                        WGPUCapture.DownloadBlob(msg.data.blob, msg.data.fname);
                    }
                });
                console.log ("Crazy worker hack done! ");
            }
        }

        let baseurl = undefined;
        if ( url instanceof Blob ) {
            // no base url here? 
            InjectFakeWorkerFromBlob(fakeworker, url, baseurl);
        } else {
            fetch(url).then(function (f) {
                f.blob().then(function(b) {
                    if ( ismodule )
                        baseurl = f.url.substring(0, f.url.lastIndexOf('/')+1); // or import.meta.url 
                    let bt = b.text().then(function(bt) {
                        console.log ( "OG worker js as fetched: ", bt );
                    });
                    InjectFakeWorkerFromBlob(fakeworker, b, baseurl);
                })
            }, function(reason) {
                console.log ("Failed to fetch worker content:", url, reason);
            });
        }
        return fakeworker;
    }
},

// api functions below 
api : {

Init : function (opts) {
    WGPUCapture.isworker = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);
    WGPUCapture.framecount = 0;
    WGPUCapture.autostop = -1;
    WGPUCapture.injectworkerapi = true;

    if (opts) {
        if ( opts.hasOwnProperty("autostop") )
            WGPUCapture.autostop = opts.autostop;
        if ( opts.hasOwnProperty("handleautostop") )
            WGPUCapture.autostopf = opts.handleautostop;
        if ( opts.hasOwnProperty("console") ) {
            if ( opts.console ) WGPUCapture.consolelog = WGPUCapture.consolelogon;
            else WGPUCapture.consolelog = WGPUCapture.consolelogoff;
        }
        if ( opts.hasOwnProperty("worker") )
            WGPUCapture.injectworkerapi = opts.worker;
    }

    if (WGPUCapture.injectworkerapi)
        WGPUCapture.InjectWorkerConstructor();

    // canvas class for init
    WGPUCapture.InjectCanvasClass(OffscreenCanvas);
    if ( !WGPUCapture.isworker)
        WGPUCapture.InjectCanvasClass(HTMLCanvasElement);
    // raf for frame tagging
    let capture_requestAnimationFrame = requestAnimationFrame;
    requestAnimationFrame = function(f) {
        // coalesce those, if there was rafs without rendering, care only about the last one really
        WGPUCapture.MarkRAF(false);
        function rafwrapper(t) {
            WGPUCapture.MarkRAF(true);
            f(t);
        }
        capture_requestAnimationFrame(rafwrapper);
    }
    // overwrite entry point
    if ( navigator.gpu.capture_RequestAdapter )
        throw ( "WGPUCapture is already initialized." );
    navigator.gpu.capture_id = -1;
    WGPUCapture.InjectAsyncCreate(navigator.gpu, "requestAdapter", WGPUCapture.InjectAdapter);
},

Mark : function (mark) {
    if ( WGPUCapture.stopped )
        return;
    WGPUCapture.capturelog.push ( { time:performance.now(), 
        marker:mark, 
    });
},

Download : function (filename) {
    let blob = WGPUCapture.api.GetBlob();
    WGPUCapture.DownloadBlob(blob, filename);
},

GetBlob : function() {
    let fullobj = {
        version: 1,
        content: "WebGPU Capture",
        source: "Humane Hamster Trap",
        log : WGPUCapture.capturelog,
        buffers : [],
        labels : WGPUCapture.labelmap,
    };
    for ( let i=0; i<WGPUCapture.capturebuffers.length; i++ ) {
        let base64data = WGPUCapture.Base64Encode(WGPUCapture.capturebuffers[i].data);
        fullobj.buffers.push ( { 
            base64data: base64data, 
            hash: WGPUCapture.capturebuffers[i].hash,
            size: WGPUCapture.capturebuffers[i].size, 
            refcount: WGPUCapture.capturebuffers[i].refcount 
        });
    }
    return new Blob([JSON.stringify(fullobj,null,2)], {type: "text/json"});
},

Stop : function () {
    WGPUCapture.consolelog("stopped capturing")
    WGPUCapture.stopped = true;
}, 

SetAutoStop : function(x) {
    WGPUCapture.autostop =x;
},

SetConsole : function(on) {
    if ( on ) WGPUCapture.consolelog = WGPUCapture.consolelogon;
    else WGPUCapture.consolelog = WGPUCapture.consolelogoff;
}

} // api

}; // WGPUCapture

