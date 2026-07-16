const KEELOQ_NLF = 0x3A5C742E;
const WG_X_GROUPS = 65535;
const WG_THREADS = 256;

function g5(x, a, b, c, d, e) {
    return ((x >> a) & 1) | (((x >> b) & 1) << 1) | (((x >> c) & 1) << 2) |
           (((x >> d) & 1) << 3) | (((x >> e) & 1) << 4);
}

function keeloqEncrypt(data, keyLo, keyHi) {
    let x = data >>> 0;
    for (let r = 0; r < 528; r++) {
        const kbit = ((r & 63) < 32) ? ((keyLo >>> (r & 31)) & 1) : ((keyHi >>> ((r & 31))) & 1);
        const nlfBit = (KEELOQ_NLF >>> g5(x, 1, 9, 20, 26, 31)) & 1;
        const fb = (x & 1) ^ ((x >>> 16) & 1) ^ kbit ^ nlfBit;
        x = (x >>> 1) | (fb << 31);
    }
    return x >>> 0;
}

function keeloqDecrypt(data, keyLo, keyHi) {
    let x = data >>> 0;
    for (let r = 0; r < 528; r++) {
        const ki = (15 - r) & 63;
        const kbit = (ki < 32) ? ((keyLo >>> ki) & 1) : ((keyHi >>> (ki - 32)) & 1);
        const nlfBit = (KEELOQ_NLF >>> g5(x, 0, 8, 19, 25, 30)) & 1;
        const fb = ((x >>> 31) & 1) ^ ((x >>> 15) & 1) ^ kbit ^ nlfBit;
        x = (x << 1) | fb;
    }
    return x >>> 0;
}

function faacLearning(seed, mfkeyLo, mfkeyHi) {
    const hs = seed >>> 16;
    const lsb = ((hs << 16) | 0x544D) >>> 0;
    const hi = keeloqEncrypt(seed, mfkeyLo, mfkeyHi);
    const lo = keeloqEncrypt(lsb, mfkeyLo, mfkeyHi);
    return { lo: lo >>> 0, hi: hi >>> 0 };
}

function parseFrames(text) {
    return text.trim().split('\n').filter(l => l.trim()).map(line => {
        const v = BigInt('0x' + line.trim());
        return { fix: Number(v >> 32n) >>> 0, hop: Number(v & 0xFFFFFFFFn) >>> 0 };
    });
}

function nibbleCheck(fix, even) {
    const n = [];
    for (let i = 7; i >= 0; i--)
        n[7 - i] = (fix >>> (i * 4)) & 0xF;
    if (even) return (n[6] << 8) | (n[7] << 4) | n[5];
    return (n[2] << 8) | (n[3] << 4) | n[4];
}

function validate(dec, fix) {
    const top = dec >>> 20;
    return top === nibbleCheck(fix, true) || top === nibbleCheck(fix, false);
}

function show(id) {
    document.getElementById(id).classList.remove('hidden');
}

function hide(id) {
    document.getElementById(id).classList.add('hidden');
}

let startTime = 0;
let progressMsg = '';
let ticker = null;

function elapsed() {
    const sec = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateProgress() {
    const el = document.getElementById('progress-text');
    if (el) el.textContent = `[${elapsed()}] ${progressMsg}`;
}

function setProgress(pct, text) {
    show('progress-area');
    progressMsg = text;
    document.getElementById('progress-fill').style.width = pct + '%';
    updateProgress();
}

function startTicker() {
    stopTicker();
    ticker = setInterval(updateProgress, 1000);
}

function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
}

function showResult(html) {
    show('result-area');
    document.getElementById('result-content').innerHTML = html;
}

function showError(msg) {
    show('error-area');
    document.getElementById('error-content').textContent = msg;
}

let lastExport = null;

function exportSub() {
    if (!lastExport) return;
    const frame = lastExport.frame;
    const seed = lastExport.seed;
    const keyBytes = [];
    for (let i = 7; i >= 0; i--) {
        keyBytes.push(((frame >> BigInt(i * 8)) & 0xFFn).toString(16).padStart(2, '0'));
    }
    const seedBytes = [];
    for (let i = 3; i >= 0; i--) {
        seedBytes.push(((seed >>> (i * 8)) & 0xFF).toString(16).padStart(2, '0'));
    }
    const content =
        'Filetype: Flipper SubGhz Key File\n' +
        'Version: 1\n' +
        'Frequency: 433920000\n' +
        'Preset: FuriHalSubGhzPresetOok650Async\n' +
        'Protocol: Faac SLH\n' +
        'Bit: 64\n' +
        'Key: ' + keyBytes.join(' ').toUpperCase() + '\n' +
        'Seed: ' + seedBytes.join(' ').toUpperCase() + '\n' +
        'AllowZeroSeed: true\n';
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'faac_slh_' + seedBytes.join('').toUpperCase() + '.sub';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Check if navigator.gpu exists (WebGPU support detection)
// Use a regular function — we detect support dynamically
function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'firefox';
    if (ua.includes('Edg')) return 'edge';
    if (ua.includes('Chrome') || ua.includes('Chromium')) return 'chrome';
    return 'other';
}

function webgpuMessage() {
    const browser = detectBrowser();
    if (browser === 'firefox') {
        return 'This browser does not support WebGPU. Try Chromium (Chrome/Edge), or on Firefox set dom.webgpu.enabled=true in about:config and ensure Vulkan drivers are installed.';
    }
    return 'WebGPU is not available in this browser. Use Chrome 113+, Edge 113+, or Firefox 127+.';
}

function webgpuAvailable() {
    return typeof navigator !== 'undefined' && navigator.gpu != null;
}

async function startRecovery() {
    const btn = document.getElementById('recover-btn');
    btn.disabled = true;
    btn.textContent = 'Working...';
        hide('error-area');
        hide('result-area');

    startTime = Date.now();
    startTicker();
    try {
        const useCustom = document.getElementById('custom-mfkey-check').checked;
        let mfkeyHex;
        if (useCustom) {
            mfkeyHex = document.getElementById('mfkey').value.trim();
            if (mfkeyHex.length !== 16 || !/^[0-9a-fA-F]+$/.test(mfkeyHex)) {
                throw new Error('Invalid manufacturer key: must be 16 hex digits');
            }
        } else {
            mfkeyHex = '53696C7669618C14';
        }
        const mfkey = BigInt('0x' + mfkeyHex);
        const mfkeyLo = Number(mfkey & 0xFFFFFFFFn) >>> 0;
        const mfkeyHi = Number(mfkey >> 32n) >>> 0;

        const frames = parseFrames(document.getElementById('frames').value);
        if (frames.length < 2) throw new Error('Enter at least 2 frames (3+ recommended).');
        if (frames.length > 16) throw new Error('Maximum 16 frames.');

        setProgress(5, 'Initializing WebGPU...');

        if (!webgpuAvailable()) {
            throw new Error(webgpuMessage());
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No WebGPU adapter found.');

        const device = await adapter.requestDevice();

        // WGSL compute shader
        const shaderCode = `
struct Params {
    mfkey_lo: u32,
    mfkey_hi: u32,
    fix0: u32,
    hop0: u32,
    fix1: u32,
    hop1: u32,
    fix2: u32,
    hop2: u32,
    num_frames: u32,
    seed_start: u32,
    seed_count: u32,
};

struct Result {
    counter: atomic<u32>,
    seeds: array<u32, 524288>,
};

const X_STRIDE: u32 = 16776960u; // 65535 * 256

@group(0) @binding(0) var<storage, read> params: Params;
@group(0) @binding(1) var<storage, read_write> result: Result;

const KEELOQ_NLF: u32 = 0x3A5C742Eu;

fn g5_e(x: u32) -> u32 {
    return ((x >> 1u) & 1u) | (((x >> 9u) & 1u) << 1u) | (((x >> 20u) & 1u) << 2u) |
           (((x >> 26u) & 1u) << 3u) | (((x >> 31u) & 1u) << 4u);
}

fn g5_d(x: u32) -> u32 {
    return ((x >> 0u) & 1u) | (((x >> 8u) & 1u) << 1u) | (((x >> 19u) & 1u) << 2u) |
           (((x >> 25u) & 1u) << 3u) | (((x >> 30u) & 1u) << 4u);
}

fn keeloq_encrypt(data: u32, key_lo: u32, key_hi: u32) -> u32 {
    var x: u32 = data;
    for (var r: u32 = 0u; r < 528u; r++) {
        let ki: u32 = r & 63u;
        var kbit: u32;
        if (ki < 32u) {
            kbit = (key_lo >> ki) & 1u;
        } else {
            kbit = (key_hi >> (ki - 32u)) & 1u;
        }
        let nlf_bit: u32 = (KEELOQ_NLF >> g5_e(x)) & 1u;
        let fb: u32 = (x & 1u) ^ ((x >> 16u) & 1u) ^ kbit ^ nlf_bit;
        x = (x >> 1u) | (fb << 31u);
    }
    return x;
}

fn keeloq_decrypt(data: u32, key_lo: u32, key_hi: u32) -> u32 {
    var x: u32 = data;
    for (var r: u32 = 0u; r < 528u; r++) {
        let ki: u32 = (15u - r) & 63u;
        var kbit: u32;
        if (ki < 32u) {
            kbit = (key_lo >> ki) & 1u;
        } else {
            kbit = (key_hi >> (ki - 32u)) & 1u;
        }
        let nlf_bit: u32 = (KEELOQ_NLF >> g5_d(x)) & 1u;
        let fb: u32 = ((x >> 31u) & 1u) ^ ((x >> 15u) & 1u) ^ kbit ^ nlf_bit;
        x = (x << 1u) | fb;
    }
    return x;
}

fn nibble_check(fix: u32, even: u32) -> u32 {
    var n: array<u32, 8>;
    for (var i: u32 = 0u; i < 8u; i++) {
        n[7u - i] = (fix >> (i * 4u)) & 0xFu;
    }
    if (even != 0u) {
        return (n[6u] << 8u) | (n[7u] << 4u) | n[5u];
    } else {
        return (n[2u] << 8u) | (n[3u] << 4u) | n[4u];
    }
}

fn validate(dec: u32, fix: u32) -> u32 {
    let top: u32 = dec >> 20u;
    if (top == nibble_check(fix, 1u)) { return 1u; }
    if (top == nibble_check(fix, 0u)) { return 1u; }
    return 0u;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let offset: u32 = id.x + id.y * X_STRIDE;
    if (offset >= params.seed_count) { return; }
    let seed: u32 = params.seed_start + offset;

    // Early exit if already found enough
    let found_cnt: u32 = atomicLoad(&result.counter);
    if (found_cnt >= 1048576u) { return; }

    let dk_hi: u32 = keeloq_encrypt(seed, params.mfkey_lo, params.mfkey_hi);
    let lsb: u32 = ((seed >> 16u) << 16u) | 0x544Du;
    let dk_lo: u32 = keeloq_encrypt(lsb, params.mfkey_lo, params.mfkey_hi);

    // Check frame 0
    let dec0: u32 = keeloq_decrypt(params.hop0, dk_lo, dk_hi);
    if (validate(dec0, params.fix0) == 0u) { return; }

    // Check additional frames
    if (params.num_frames >= 2u) {
        let dec1: u32 = keeloq_decrypt(params.hop1, dk_lo, dk_hi);
        if (validate(dec1, params.fix1) == 0u) { return; }
    }
    if (params.num_frames >= 3u) {
        let dec2: u32 = keeloq_decrypt(params.hop2, dk_lo, dk_hi);
        if (validate(dec2, params.fix2) == 0u) { return; }
    }

    // Seed matches all frames — store it
    let idx: u32 = atomicAdd(&result.counter, 1u);
    if (idx < 1048576u) {
        result.seeds[idx] = seed;
    }
}
`;

        setProgress(10, 'Compiling shader...');
        const shaderModule = device.createShaderModule({ code: shaderCode });

        const pipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });

        // Prepare params buffer
        const nf = frames.length;
        const paramsData = new Uint32Array([
            mfkeyLo, mfkeyHi,
            frames[0].fix, frames[0].hop,
            nf >= 2 ? frames[1].fix : 0, nf >= 2 ? frames[1].hop : 0,
            nf >= 3 ? frames[2].fix : 0, nf >= 3 ? frames[2].hop : 0,
            Math.min(nf, 3),  // num_frames (max 3 for shader)
            0, 0, // seed_start, seed_count (set per chunk)
        ]);

        // Buffer sizes
        const paramsBufSize = 11 * 4; // 11 u32s
        const resultBufSize = 4 + 524288 * 4; // counter + seeds

        const paramsBuf = device.createBuffer({
            size: paramsBufSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        const resultBuf = device.createBuffer({
            size: resultBufSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });

        const readBuf = device.createBuffer({
            size: resultBufSize,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: paramsBuf } },
                { binding: 1, resource: { buffer: resultBuf } },
            ],
        });

        // Process in chunks for progress reporting
        const CHUNKS = 16;
        const SEEDS_PER_CHUNK = Math.ceil(0x100000000 / CHUNKS);
        const searchAll = document.getElementById('search-all-check').checked;
        const uniqueResult = nf >= 3 && !searchAll;

        // Reset result counter
        device.queue.writeBuffer(resultBuf, 0, new Uint32Array([0]));

        for (let ch = 0; ch < CHUNKS; ch++) {
            const start = ch * SEEDS_PER_CHUNK;
            const count = Math.min(SEEDS_PER_CHUNK, 0x100000000 - start);

            setProgress(10 + (ch / CHUNKS) * 85,
                `Searching ${((start) / 0x1000000).toFixed(0)}M-${((start + count) / 0x1000000).toFixed(0)}M seeds...`);

            paramsData[9] = start;
            paramsData[10] = count;
            device.queue.writeBuffer(paramsBuf, 0, paramsData);

            const threadsPerX = WG_X_GROUPS * WG_THREADS;
            const groupsY = Math.ceil(count / threadsPerX);

            const encoder = device.createCommandEncoder();
            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(WG_X_GROUPS, groupsY, 1);
            pass.end();
            encoder.copyBufferToBuffer(resultBuf, 0, readBuf, 0, 4);
            device.queue.submit([encoder.finish()]);

            await device.queue.onSubmittedWorkDone();

            // For unique results (3+ frames), stop at first chunk with a match
            if (uniqueResult) {
                await readBuf.mapAsync(GPUMapMode.READ);
                const found = new Uint32Array(readBuf.getMappedRange(0, 4))[0];
                readBuf.unmap();
                if (found > 0) break;
            }
        }

        setProgress(95, 'Reading results...');

        // Copy full result
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(resultBuf, 0, readBuf, 0, resultBufSize);
        device.queue.submit([enc.finish()]);
        await device.queue.onSubmittedWorkDone();

        await readBuf.mapAsync(GPUMapMode.READ);
        const resultView = new Uint32Array(readBuf.getMappedRange());
        const foundCount = resultView[0];
        const seeds = new Uint32Array(resultView.buffer, 4, Math.min(foundCount, 524288));
        // Copy seeds data to a plain array BEFORE unmapping (unmap detaches the buffer)
        const seedsCopy = new Uint32Array(seeds);
        readBuf.unmap();

        device.destroy();

        if (foundCount === 0) {
            showError('No matching seed found. Verify the frame data or try a custom manufacturer key.');
            setProgress(0, 'Failed');
            btn.disabled = false;
            btn.textContent = 'Recover Seed';
            return;
        }

        function progDetails(fix, seed, cnt) {
            const serial = (fix >>> 4).toString(16).padStart(8, '0').toUpperCase();
            const button = (fix & 0xF).toString(16).padStart(2, '0').toUpperCase();
            const counter = cnt.toString(16).padStart(8, '0').toUpperCase();
            const seedHex = seed.toString(16).padStart(8, '0').toUpperCase();
            let h = '<div class="result-row seed-found"><div class="result-label">Seed</div><div class="result-value">' + seedHex + '</div></div>';
            h += '<div class="result-row"><div class="result-label">Serial</div><div class="result-value">' + serial + '</div></div>';
            h += '<div class="result-row"><div class="result-label">Button</div><div class="result-value">' + button + '</div></div>';
            h += '<div class="result-row"><div class="result-label">Counter</div><div class="result-value">' + counter + '</div></div>';
            return h;
        }

        // Post-process with JS for additional frames and sorting
        const nFrame = frames.length;
        if (nFrame >= 3) {
            const s = seedsCopy[0];
            const dev = faacLearning(s, mfkeyLo, mfkeyHi);
            const dec0 = keeloqDecrypt(frames[0].hop, dev.lo, dev.hi);
            let html = progDetails(frames[0].fix, s, dec0 & 0xFFFFF);
            html += `<div class="result-row"><div class="result-label">Device Key</div><div class="result-value">0x${dev.hi.toString(16).padStart(8, '0').toUpperCase()}${dev.lo.toString(16).padStart(8, '0').toUpperCase()}</div></div>`;
            if (foundCount <= 10 && !searchAll) {
                html += `<div class="result-row"><div class="result-label">Confidence</div><div class="result-value">100% — unique result</div></div>`;
            } else {
                html += `<div class="result-row"><div class="result-label">Candidates</div><div class="result-value">${foundCount} found</div></div>`;
                const shown = Math.min(foundCount, 6);
                for (let i = 1; i < shown; i++) {
                    const altSeed = seedsCopy[i];
                    const altDev = faacLearning(altSeed, mfkeyLo, mfkeyHi);
                    const altDec = keeloqDecrypt(frames[0].hop, altDev.lo, altDev.hi);
                    html += `<div class="candidate">0x${altSeed.toString(16).padStart(8, '0').toUpperCase()} cnt=0x${(altDec & 0xFFFFF).toString(16).padStart(5, '0').toUpperCase()}</div>`;
                }
                if (foundCount > 6) {
                    html += `<div class="candidate-more">… and ${foundCount - 6} more</div>`;
                }
            }
            lastExport = { frame: (BigInt(frames[0].fix) << 32n) | BigInt(frames[0].hop), seed: s };
            html += '<button class="btn export-btn" onclick="exportSub()">Export .sub</button>';
            html += '<span class="export-note">You may need to press it a few times for the receiver to recognise it</span>';
            showResult(html);
        } else {
            // 2 frames: filter and sort by counter gap
            const sameBtn = ((frames[0].fix & 0xF) === (frames[1].fix & 0xF));
            const scored = [];
            for (let i = 0; i < Math.min(seedsCopy.length, 1048576); i++) {
                const seed = seedsCopy[i];
                const dev = faacLearning(seed, mfkeyLo, mfkeyHi);
                const dec0 = keeloqDecrypt(frames[0].hop, dev.lo, dev.hi);
                const dec1 = keeloqDecrypt(frames[1].hop, dev.lo, dev.hi);
                if (!validate(dec0, frames[0].fix) || !validate(dec1, frames[1].fix)) continue;
                const cnt = dec0 & 0xFFFFF;
                const gap = sameBtn ? Math.abs(cnt - (dec1 & 0xFFFFF)) : -1;
                scored.push({ seed, gap, cnt });
            }
            if (sameBtn) {
                scored.sort((a, b) => a.gap - b.gap);
            } else {
                scored.sort((a, b) => a.seed - b.seed);
            }

            if (scored.length === 0) {
                showError('No matching seed found after full verification.');
            } else {
                let html = progDetails(frames[0].fix, scored[0].seed, scored[0].cnt);
                if (sameBtn) {
                    html += `<div class="result-row"><div class="result-label">Counter Gap</div><div class="result-value">${scored[0].gap}</div></div>`;
                }
                html += `<div class="result-row"><div class="result-label">Total</div><div class="result-value">${scored.length} candidates</div></div>`;
                const showCount = Math.min(scored.length, 5);
                for (let i = 0; i < showCount; i++) {
                    html += `<div class="candidate">0x${scored[i].seed.toString(16).padStart(8, '0').toUpperCase()} cnt=0x${scored[i].cnt.toString(16).padStart(5, '0').toUpperCase()}`;
                    if (sameBtn) html += ` gap=${scored[i].gap}`;
                    html += `</div>`;
                }
                if (scored.length > 5) {
                    html += `<div class="candidate-more">… and ${scored.length - 5} more candidates</div>`;
                }
                lastExport = { frame: (BigInt(frames[0].fix) << 32n) | BigInt(frames[0].hop), seed: scored[0].seed };
                html += '<button class="btn export-btn" onclick="exportSub()">Export .sub</button>';
                html += '<span class="export-note">You may need to press it a few times for the receiver to recognise it</span>';
                showResult(html);
            }
        }

        setProgress(100, 'Done');
    } catch (e) {
        showError(e.message || String(e));
        setProgress(0, 'Failed');
    } finally {
        stopTicker();
        btn.disabled = false;
        btn.textContent = 'Recover Seed';
    }
}

document.getElementById('custom-mfkey-check').addEventListener('change', function () {
    document.getElementById('custom-mfkey-field').style.display = this.checked ? 'block' : 'none';
});

document.getElementById('frames').addEventListener('input', function () {
    const lines = this.value.trim().split('\n').filter(l => l.trim());
    document.getElementById('search-all-section').style.display = lines.length >= 3 ? 'block' : 'none';
});
