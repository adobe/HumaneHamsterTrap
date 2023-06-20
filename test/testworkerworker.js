import { init } from "./testworkermodule.js";

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

console.log ( "Starting toplevel in worker.");
if ( !this )
    console.log ( "Looks like we are in a module worker.");
else 
    console.log ( "Looks like we are in a classic worker.");

self.onmessage = async function handleMessageFromMain(msg) {
    if ( msg.data.msg == "init" ) {
        console.log ( "Got init message in worker.");
        await init(msg.data.canvas);
    }
}

