/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

console.log ( "toplevel");

chrome.action.setBadgeText({
    text: "",
});

function CleanURL(url) {
    let end = url.indexOf("?");
    if ( end!=-1 )
       url = url.slice(0, end)+"*";
    end = url.indexOf("#");
    if (end != -1 )
        url = url.slice(0, end)+"*";
    return url;
}

let tab = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
if ( tab )
    document.getElementById("div_sitename").innerHTML = `${tab[0].title}<br><a href=${tab[0].url}>${CleanURL(tab[0].url)}</a>`;
else 
    document.getElementById("div_sitename").innerHTML = "No active tab found.";

document.getElementById("btn_openviewer").addEventListener("click", () => {
  chrome.tabs.create({url: chrome.runtime.getURL("ext/indexext.html")});
});

document.getElementById("btn_openreadme").addEventListener("click", () => {
    chrome.tabs.create({url: chrome.runtime.getURL("ext/readmeext.md")});
});

document.getElementById("btn_run").addEventListener("click", async () => {
    if ( !tab ) 
        return;
    await chrome.scripting.unregisterContentScripts();

    // this is key to register into the world MAIN and runAt document_start
    await chrome.scripting.registerContentScripts([{
        id : "Humane Hamster Trap",
        matches : [ CleanURL(tab[0].url) ],
        allFrames : true,
        runAt : "document_start",
        js : [ "ext/wgpucapext.js", "startcapture.js" ],
        world: "MAIN"
     }]);
    let nf = document.getElementById("in_numframes").value;
    let debugcheck = document.getElementById("in_debug").checked;

    function HandleMessage (request, sender, sendResponse) {
        if ( request.capture_ext=="done" ) {
            // show value of filename 
            document.getElementById("div_result").innerHTML = `Capture done. Saved as ${request.value}.`;
            chrome.scripting.unregisterContentScripts();
        } else if ( request.capture_ext=="getoptions" ) {
            sendResponse({capture_ext: "options", numframes:nf, debug:debugcheck});
        }
    }

    chrome.runtime.onMessage.addListener(HandleMessage);
    chrome.runtime.onMessageExternal.addListener(HandleMessage);
    await chrome.tabs.reload(tab[0].id);
});
