import {WGPUCapture} from "./../wgpucap.js"

/*
Copyright 2023 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it.
*/

// spinning triangle example
// test for manually instrumenting a capture 

const wgslsrc = `
struct VertexOutput {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
}

struct Uniforms {
    time : f32,
    scale : f32,
    _align2 : f32,
    _align3 : f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertMain(@builtin(vertex_index) vidx : u32) -> VertexOutput {
    var p : vec2<f32>;
    if ( vidx==0 ) {
        p = vec2<f32>(-.5,-.5);
    } else if ( vidx==1 ) {
        p = vec2<f32>(0.0,.5);
    } else {
        p = vec2<f32>(.5,-.5);
    }
    let r = uniforms.time;
    let rotmat : mat2x2<f32> = mat2x2<f32> (
        cos(r), -sin(r),
        sin(r), cos(r)
    );
    p = p * rotmat * uniforms.scale; 

    var output : VertexOutput;
    output.uv = p + vec2<f32>(.5);
    output.pos = vec4<f32>(p.x, p.y, 0.0, 1.0);
    return output;
}

@fragment
fn fragMain(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(uv.x, uv.y, 0.0, 1.0);
}
`

let canvas;
let adapter;
let context;
let device;
let bindgroup;
let pipeline;
let uniforms;
let framecount = 0;

function raf(t) {
    t/=1000.0;

    let cpuuniforms = new Float32Array(4);
    cpuuniforms[0] = t;
    cpuuniforms[1] = Math.sin(t)+1.5;

    device.queue.writeBuffer(uniforms, 0, cpuuniforms);

    let backbufferView = context.getCurrentTexture().createView();
    let encoder = device.createCommandEncoder();

    let pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: backbufferView,
            loadValue: {r: 0.0, g: 1.0, b: 0.0, a: 1.0},
            clearValue: {r: 0.0, g: 0.0, b: Math.abs(Math.sin(t)), a: 0.0},
            loadOp: "clear",
            storeOp: "store"
        }]
    });
    pass.setBindGroup(0, bindgroup);
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    let cmdbuf = encoder.finish();

    device.queue.submit([cmdbuf]);

    framecount++;
    requestAnimationFrame(raf);
}

async function init() {
    // device stuff
    canvas = document.getElementById("rendercanvas");
    adapter = await navigator.gpu.requestAdapter();

    device = await adapter.requestDevice({requiredFeatures: [], requiredLimits: {}});
    console.log ( adapter.limits );
    context = canvas.getContext("webgpu");
    let canformat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canformat,
        alphaMode: "opaque",
        usage: GPUTextureUsage.OUTPUT_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT
    });
    // scene stuff
    let shader = device.createShaderModule( {code: wgslsrc} );
    let pipedesc = {
        layout: 'auto', 
        vertex: {
            module: shader,
            entryPoint: "vertMain",
            buffers: []
        },
        fragment: {
            module: shader,
            entryPoint: "fragMain",
            targets: [{
                format: canformat
            }]
        },
        primitive: {
            topology: "triangle-list"
        }
    }

    const async = true;
    if ( async ) {
        pipeline = await device.createRenderPipelineAsync(pipedesc);
    } else {
        pipeline = device.createRenderPipeline(pipedesc);
    }
    
    uniforms = device.createBuffer({
        size: 4*4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    let mr = uniforms.getMappedRange();
    var f32view = new Float32Array(mr);
    f32view[0] = 0.0;
    f32view[1] = 1.3;
    uniforms.unmap();

    bindgroup = device.createBindGroup ({
        layout: pipeline.getBindGroupLayout(0), 
        entries: [ { binding: 0, resource: { buffer: uniforms } }, ]
    });
}

// toplevel entry point here

WGPUCapture.api.Init({autostop:20});

await init();
requestAnimationFrame(raf);