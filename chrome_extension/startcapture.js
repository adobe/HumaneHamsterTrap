
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

const capture_extid = "deonfghfkdlfcfklhgfefgoldkgmdffd";

console.log ( "WebGPUCapture: Start!");

// fixme: if chrome is not defined if we are in a worker, talk to the main thread instead  

WGPUCapture.isworker = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);

if ( WGPUCapture.isworker || !chrome.runtime ) {
    console.log ("Chrome runtime not defined.")
} else {
    // our extension id, might have to change when published
    chrome.runtime.sendMessage(capture_extid,
        {capture_ext:"getoptions"},
        function (request, sender, sendResponse) {
            if ( request && request.capture_ext=="options" ) {
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
}

WGPUCapture.api.Init({autostop:40, console:false, handleautostop:(fname) => {
        console.log ( "WebGPUCapture: Done!");
        if ( !WGPUCapture.isworker && chrome.runtime )
            chrome.runtime.sendMessage(capture_extid, {capture_ext:"done", value:fname });
    }
});


