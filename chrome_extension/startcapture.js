
// (first line intentionally left blank)
// injected just after wgpucapext.js to start the capture process 
// note: this is in the web page, not in a content script
// so communication with the extension is special... 

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

console.log ( "WebGPUCapture: Start!");

// fixme: if chrome is not defined if we are in a worker, talk to the main thread instead  

WGPUCapture.isworker = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);

WGPUCapture.capture_extid = "iednipjajdnemnpfjnfgfpeecfmipjko";

if ( WGPUCapture.isworker || !chrome.runtime ) {
    console.log ("Chrome runtime not defined.")
} else {
    // our extension id, might have to change when published
    // because this is injected in the world and not isolated, need the extension id
    // there might be a better way? 
    try {
        chrome.runtime.sendMessage(WGPUCapture.capture_extid,
            {capture_ext:"getoptions"},
            function (request) {
                if ( !request ) {
                    console.warn( `WebGPUCapture: Get options could not be sent.`+
                        `This is probably a mismatching extension id: ${WGPUCapture.capture_extid}.`+
                        `You need to fix capture_extid in the source code to match your assigned extension id.`);
                } else if ( !request.capture_ext=="options" ) {
                    console.warn("WebGPUCapture: Get options did not return options. ");
                } else {
                    // it worked
                    if ( request.hasOwnProperty("numframes") ) {
                        console.log ( "WebGPUCapture: Set auto stop:", request.numframes );
                        WGPUCapture.api.SetAutoStop(request.numframes);
                    }
                    if ( request.hasOwnProperty("debug") ) {
                        console.log ( "WebGPUCapture: Set debug:", request.debug );
                        WGPUCapture.api.SetConsole(request.debug);
                    }
                }
            }
        )
    } catch(e) {
        console.warn( `WebGPUCapture: Failed to send runtime message.`+
            `This is probably a mismatching extension id: ${WGPUCapture.capture_extid}.`+
            `You need to fix capture_extid in the source code to match your assigned extension id.`);
    }
}

WGPUCapture.api.Init({autostop:40, console:false, handleautostop:(fname) => {
        console.log ( "WebGPUCapture: Done!");
        if ( !WGPUCapture.isworker && chrome.runtime )
            chrome.runtime.sendMessage(WGPUCapture.capture_extid, {capture_ext:"done", value:fname });
    }
});


