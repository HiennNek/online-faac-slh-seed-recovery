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

function setProgress(pct, text) {
    document.getElementById('progress-area').style.display = 'block';
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = text;
}

function showResult(html) {
    document.getElementById('result-area').style.display = 'block';
    document.getElementById('result-content').innerHTML = html;
}

function showError(msg) {
    document.getElementById('error-area').style.display = 'block';
    document.getElementById('error-content').textContent = msg;
}

// Check if navigator.gpu exists (WebGPU support detection)
// Use a regular function — we detect support dynamically
function webgpuAvailable() {
    return typeof navigator !== 'undefined' && navigator.gpu != null;
}

async function startRecovery() {
    const btn = document.getElementById('recover-btn');
    btn.disabled = true;
    btn.textContent = 'Working...';
    document.getElementById('error-area').style.display = 'none';
    document.getElementById('result-area').style.display = 'none';

    try {
        const mfkeyHex = document.getElementById('mfkey').value.trim();
        if (mfkeyHex.length !== 16 || !/^[0-9a-fA-F]+$/.test(mfkeyHex)) {
            throw new Error('Invalid mfkey: must be 16 hex digits');
        }
        const mfkey = BigInt('0x' + mfkeyHex);
        const mfkeyLo = Number(mfkey & 0xFFFFFFFFn) >>> 0;
        const mfkeyHi = Number(mfkey >> 32n) >>> 0;

        const frames = parseFrames(document.getElementById('frames').value);
        if (frames.length < 2) throw new Error('Enter at least 2 frames (3+ recommended).');
        if (frames.length > 16) throw new Error('Maximum 16 frames.');

        setProgress(5, 'Initializing WebGPU...');

        if (!webgpuAvailable()) {
            throw new Error('WebGPU not supported. Use Chrome 113+, Edge 113+, or enable WebGPU in Firefox Nightly.');
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
    let seed: u32 = id.x + id.y * X_STRIDE;
    if (seed >= params.seed_start + params.seed_count) { return; }

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
        const uniqueResult = nf >= 3;

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
        readBuf.unmap();

        device.destroy();

        if (foundCount === 0) {
            showError('No matching seed found. Check mfkey or try with more frames.');
            setProgress(0, 'Failed');
            btn.disabled = false;
            btn.textContent = 'Recover Seed';
            return;
        }

        // Post-process with JS for additional frames and sorting
        const nFrame = frames.length;
        if (nFrame >= 3) {
            // Only need the first few seeds (should be unique with 3+ frames)
            const s = seeds[0];
            const dev = faacLearning(s, mfkeyLo, mfkeyHi);
            let html = `<div class="seed-found">Seed: 0x${s.toString(16).padStart(8, '0').toUpperCase()}</div>`;
            html += `<div>Device Key: 0x${dev.hi.toString(16).padStart(8, '0').toUpperCase()}${dev.lo.toString(16).padStart(8, '0').toUpperCase()}</div>`;
            if (foundCount <= 10) {
                html += `<div>Confidence: 100% (unique result)</div>`;
            } else {
                html += `<div>Found ${foundCount} candidates (expected unique with 3+ frames, try more frames)</div>`;
            }
            if (foundCount > 1) {
                html += `<div class="toggle-list" onclick="this.nextElementSibling.style.display='block';this.style.display='none'">Show alternate candidates (${foundCount - 1})</div>`;
                html += `<div class="seed-list" style="display:none">`;
                for (let i = 1; i < Math.min(foundCount, 50); i++) {
                    html += `<div class="candidate">0x${seeds[i].toString(16).padStart(8, '0').toUpperCase()}</div>`;
                }
                if (foundCount > 50) html += `<div>... and ${foundCount - 50} more</div>`;
                html += `</div>`;
            }
            showResult(html);
        } else {
            // 2 frames: filter and sort by counter gap
            const sameBtn = ((frames[0].fix & 0xF) === (frames[1].fix & 0xF));
            const scored = [];
            for (let i = 0; i < Math.min(seeds.length, 1048576); i++) {
                const seed = seeds[i];
                const dev = faacLearning(seed, mfkeyLo, mfkeyHi);
                const dec0 = keeloqDecrypt(frames[0].hop, dev.lo, dev.hi);
                const dec1 = keeloqDecrypt(frames[1].hop, dev.lo, dev.hi);
                if (!validate(dec0, frames[0].fix) || !validate(dec1, frames[1].fix)) continue;
                const gap = sameBtn ? Math.abs((dec0 & 0xFFFFF) - (dec1 & 0xFFFFF)) : -1;
                scored.push({ seed, gap });
            }
            if (sameBtn) {
                scored.sort((a, b) => a.gap - b.gap);
            } else {
                scored.sort((a, b) => a.seed - b.seed);
            }

            if (scored.length === 0) {
                showError('No matching seed found after full verification.');
            } else {
                let html = `<div class="seed-found">Top candidate: 0x${scored[0].seed.toString(16).padStart(8, '0').toUpperCase()}</div>`;
                if (sameBtn) {
                    html += `<div>Counter gap: ${scored[0].gap}</div>`;
                }
                html += `<div>Total candidates: ${scored.length}</div>`;
                html += `<div class="toggle-list" onclick="this.nextElementSibling.style.display='block';this.style.display='none'">Show all candidates</div>`;
                html += `<div class="seed-list" style="display:none">`;
                for (const c of scored) {
                    html += `<div class="candidate">0x${c.seed.toString(16).padStart(8, '0').toUpperCase()}`;
                    if (sameBtn) html += ` gap=${c.gap}`;
                    html += `</div>`;
                }
                html += `</div>`;
                showResult(html);
            }
        }

        setProgress(100, 'Done');
    } catch (e) {
        showError(e.message || String(e));
        setProgress(0, 'Failed');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Recover Seed';
    }
}
