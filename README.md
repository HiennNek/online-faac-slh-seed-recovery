# FAAC SLH Seed Recovery (WebGPU)

Client-side brute-force seed recovery for FAAC SLH remote controls, running entirely in the browser via WebGPU compute shaders.

**Supported browsers:** Chromium-based only (Chrome, Edge, Brave, Opera). Firefox and Safari do not support WebGPU on this platform.

**Chrome flags required:** Open `chrome://flags` and enable:
- `#enable-unsafe-webgpu` — WebGPU support
- `#enable-vulkan` — Vulkan GPU backend (required on Linux/Android)

Then restart the browser.

## Usage

1. Serve the directory with any static file server (see below).
2. Paste captured frames (hex, 16 digits each, one per line).
3. Click **Recover Seed**.
4. Results appear in the right panel.

**Frames:** At least 2 required. 3+ frames yields a unique seed.

**Manufacturer key:** Defaults to the standard FAAC SLH key (`53696C7669618C14`). Tick "Custom manufacturer key" to override.

## Run locally

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in Chrome or Edge.

## Deploy

Upload to any static host (GitHub Pages, Netlify, Vercel, etc.). No server-side processing required.

## How it works

All 2^32 seeds are tested against the provided frames using a WebGPU compute shader. The KeeLoq encryption/decryption and FAAC validation run entirely on the GPU using WGSL. Matched seeds are copied back to the CPU for final sorting and display.

For 3+ frames the result is unique. For 2 frames candidates are ranked by counter gap.
