# Humane Hamster Trap

The Humane Hamster Trap is a debugging tool for WebGPU command stream capture and replay.

## What's with the name?

It was initially called only "Hamster Trap", because it captures WebGPU commands, which are are both fast and elusive like a Hamster.
Later the "Humane" adjective was added to disuade any ideas that it might advocate for the mistreatment of Hamsters - or WebGPU commands.  

## Contact

https://matrix.to/#/#HumaneHamsterTrap:matrix.org

## What does it look like?

Scroll down to the bottom of this readme for some screen shots. 

## How to use

### Chrome Extension

The easiest way! See below. 

### Manually in code

In your WebGPU project, include the wgpucap.js file as a module (```import {WGPUCapture} from "./wgpucap.js"```) or include the 
wgpucap.js directly.
Then call ```WGPUCapture.api.Init``` before doing any WebGPU initialization. 
If you are running WebGPU on a worker, do this on the worker that will be using WebGPU, not on the main thread!

When you have captured enough data, call ```WGPUCapture.api.Download(filename)``` to download the capture json file. 
If running on a worker, you can instead call ```WGPUCapture.api.GetBlob``` and save that blob via the main thread in your own code. 

You might also want to call 
```WGPUCapture.api.Stop``` after you saved the capture.

The capture .json file has all the information needed to replay all WebGPU commands. It is also fairly human readable. 

Open ```index.html``` and click the Load button to load the json file. Now you can step through the replay using the play control buttons. 

To label objects (instead of number ids) use the builtin WebGPU label property on objects. 
Those will get captured and used for display. 

## Example demo

There is a test folder with a simple demo scene.
testindex.html (and testmain.js) demos using capture for a simple test case. 
Next to it is a testindexnocap.html that does the same, but without capture auto enabled, for testing the extension. 

## Use cases 

Debug your own WebGPU code. 

Create testable, easy replay test cases for WebGPU without sharing code. 
All you need to reproduce a bug is the Humane Hamster Trap json file. 
The basic replay code is less than 200loc. 

## How it works 

```WGPUCapture.api.Init``` instruments all root WebGPU functions (and requestAnimationFrame) with capture code.
When a new WebGPU object is created by an instumented function, it is also instrumented. 
That way all calls to WebGPU are logged. 

All objects are tracked and can be refered to by integer id (capture_id).  

Special care is taken to handle async functions. They record both the initial call and the resolve (or reject) in the log. That way replay can exactly match the order of events. 

Buffer sources are also captured, de-duplicated, and stored in the log, encoded as Base64. 
This works for both writeBuffer and mapAsync with write access. MappedAtCreation buffers are special cased and handled as well. 

## Limitations

Due to the nature of the WebGPU API there is no way to capture "just in time". Capture has to start at WebGPU init.

The extension is working in some Module/Worker combinations but not all. Notably not for code running in vite dev. 

## Chrome Extension

- Open the Chrome extensions page from the Chrome hamburger menu or go to ```chrome://extensions/```.
- Slide the "Developer Mode" slider to the right.
- Click "Load unpacked" and select the chrome_extension folder of this repo.
- For full functionality, you now need to adjust the extension id in the code: (optional but recommended)
- Find the line ```WGPUCapture.capture_extid = "iednipjajdnemnpfjnfgfpeecfmipjko"``` in chrome_extension/startcapture.js, and change it to the extension id assigned to you by chrome. It can be found on the ```chrome://extensions/``` page as well.
- Refresh the extension 
- Optionally pin the extension for easy access. 
- Select the extension and click the "Enable & Reload" button. 
- After n-frames a trace.json file will auto download. 
- Click the "Open viewer" button, and from there the "Load" button.  

One good thing about this Chrome extension is that it has no default content scripts, so there is zero overhead for having it installed and enabled. 

Note that extension capture currently does not work always for WebGPU running in a worker. 
It does try instrumenting workers, but it can be flaky.
Capturing in a worker does work when manually instrumenting capture. 

## Code guidelines 

- No frameworks or build systems. Keep things plain JS/HTML/CSS.
- Keep the JS as readable as possible, minimize async and advanced language costructs as far as possible. 
- Keep DRY as needed, but don't build abstratcions before they are useful. 

## TODO

- Fix device.getCurrentTexture(): need to emulate it for single stepping and reading
- Make things work with WASM and WebGPUProxy
- Pretty print usage flags
- Implement step back 
- Unmap with write should show source buffer in UI
- Workaround adapter/device limits for replay, at least try to! 
- Fix extension for worker case .. more. Especially for vite. 
- Fix Reject promises 
- Test and gracefully handle captures with errors
- Checkpoint capture for stepping back without full replay
- Compress buffer data 
- Icons for play/step buttons
- Readback depth24plus and depth24plus_stencil using shader
- Alpha channel display for textures 
- Support more texture formats (including compressed!)
- Fix scroll lists to handle very large number of elements
- Visualize timestamps
- Fix Non-RAF based capture (https://webgpu.github.io/webgpu-samples/samples/videoUploadingWebCodecs) and imported textures 
- Publish on Chrome extension web store

## Screen shots

Captures from the WebGPU samples:

![Screenshot](screenshots/shot3.png?raw=true "Capture with Chrome extension")
![Screenshot](screenshots/shot1.png?raw=true "Replay and inspect")
![Screenshot](screenshots/shot2.png?raw=true "Another replay")

  
  
