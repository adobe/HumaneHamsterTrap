// spinning triangle example
// testing capturing from a worker 

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

// toplevel entry point here

console.log ( "Starting toplevel testworker.js");

let canvas = document.getElementById("rendercanvas");
let offcan = canvas.transferControlToOffscreen();


function FixupImports(s, baseurl) {
    const regex = /(import.+from.+["'])(.+)(["'])/g
    return s.replaceAll(regex, function (matched, c1, c2, c3) {
        return c1 + baseurl + c2 + c3;
    });
}

let worker;
const launchfromblob = true;
if ( launchfromblob ) {
    let me = undefined;
    if ( this ) {
        console.log ("Running classic.");
    } else {
        let me = import.meta.url;
        console.log ("Running in module.", me);
    }

    let f = await fetch("testworkerworker.js");
    //let b = await f.blob();
    let bt = await f.text();
    let refpath = import.meta.url; // f.url.substring(0, f.url.lastIndexOf('/')+1);
    bt = FixupImports(bt, refpath);
    let b2 = new Blob([bt], {type:"application/javascript"});
    let bu = URL.createObjectURL(b2);
    worker = new Worker(bu, {type: 'module'});
    worker.onerror = console.error;
    //URL.revokeObjectURL(bu);
} else {
    worker = new Worker("testworkerworker.js", {type: 'module'});
    worker.onerror = console.error;

}


console.log ( "Worker created.");
worker.postMessage({ msg:"init", canvas: offcan }, [offcan]);
