# FAAC SLH Seed Recovery (WebGPU)

Client-side brute-force seed recovery for FAAC SLH remote controls, running entirely in the browser via WebGPU compute shaders.

**Supported browsers:** Chromium-based only (Chrome, Edge, Brave, Opera). Firefox and Safari do not support WebGPU on this platform.

**Chrome flags required:** Open `chrome://flags` and enable:
- `#enable-unsafe-webgpu` — WebGPU support
- `#enable-vulkan` — Vulkan GPU backend (required on Linux/Android)

Then restart the browser.

## Human-written guide:

> [!IMPORTANT]
> **Please use a Chromium-based browser (Chrome, Opera, Edge, Brave, etc.). Firefox & Safari don't work.**

First, capture at least 2 presses from the same button (4 presses recommended) with your Flipper Zero.

In this example, I use 2 presses; 3+ presses will make bruteforcing faster.

<p align="center">
  <img width="512" height="256" alt="img1" src="https://github.com/user-attachments/assets/2ec6914a-3bba-4a66-985a-683b44d616db" />
</p>

Open each captured signal and type the `Key` into the `Frames` input field.

<table>
  <tr>
    <td><img width="512" height="256" alt="img2" src="https://github.com/user-attachments/assets/d0eb8557-ecf4-40d6-8fa1-8bb9b658ed57" /></td>
    <td><img width="512" height="256" alt="img3" src="https://github.com/user-attachments/assets/f8e380da-5f08-4cfe-94cb-b364271dbad3" /></td>
  </tr>
</table>

<p align="center">
<img width="456" height="453" alt="image" src="https://github.com/user-attachments/assets/4d718cfa-5b68-49a3-93a0-b7d28c405819" />
</p>

Then press `Recover Seed` and wait (took around 6 min on my laptop).

<p align="center">
<img width="1818" height="902" alt="image" src="https://github.com/user-attachments/assets/e56886e4-00de-499a-8433-d87bc1b8446a" />
</p>

For 2 presses, it will show the most likely seeds, then you can export the .sub file for that remote. (3+ presses will give a unique result.)

Note that you might need to press several times for the remote to sync with the receiver.

### Common problems:

> Don't see your question answered here? [Open an issue](https://github.com/HiennNek/kiisu-unlshd/issues).

<details>
<summary><b>It can't find any seeds for my remote!</b></summary>

1. Use Chrome/Chromium, then go to `chrome://flags` and enable these flags for WebGPU to work:

<p align="center">
<img width="770" height="241" alt="image" src="https://github.com/user-attachments/assets/dcbc136a-2f8f-446c-b942-6c1680d0201d" />
</p>
Then restart the browser.

Note that `#enable-vulkan` is only available for Linux/Android; other OSes still work without this flag.

2. Only enter captured frames from the same button, on the same remote. FAAC SLH uses a different seed for each button.

3. Make sure that all presses are consecutive (there can be some gap between each press, but the result might vary).
</details>

<details>
<summary><b>The exported .sub file doesn't work!</b></summary>

1. Try pressing it several times; the exported file might not be in sync.
2. Try 4 presses; this might give a better result than 2 or 3 presses.
3. Make sure the presses are from the same button.
</details>

<details>
<summary><b>Why is it so slow?</b></summary>

1. Use a better machine, or use the CUDA version instead: https://github.com/HiennNek/faac-slh-seed-recovery (requires NVIDIA GPU)
</details>

## Clanker-written guide (AI-written guide):

### Usage

1. Serve the directory with any static file server (see below).
2. Paste captured frames (hex, 16 digits each, one per line).
3. Click **Recover Seed**.
4. Results appear in the right panel.

**Frames:** At least 2 required. 3+ frames yields a unique seed.

**Manufacturer key:** Defaults to the standard FAAC SLH key (`53696C7669618C14`). Tick "Custom manufacturer key" to override.

### Run locally

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in Chrome or Edge.

### Deploy

Upload to any static host (GitHub Pages, Netlify, Vercel, etc.). No server-side processing required.

### How it works

All 2^32 seeds are tested against the provided frames using a WebGPU compute shader. The KeeLoq encryption/decryption and FAAC validation run entirely on the GPU using WGSL. Matched seeds are copied back to the CPU for final sorting and display.

For 3+ frames the result is unique. For 2 frames candidates are ranked by counter gap.
