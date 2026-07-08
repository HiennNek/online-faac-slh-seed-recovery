// Change these for your deployment:
const GH_OWNER = 'HiennNek';
const GH_REPO = 'online-faac-slh-seed-recovery-bucket';
const GH_RELEASE = 'v1.0';
const GH_BASE = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${GH_RELEASE}`;

const NUM_TAGS = 4096;
const PART_SIZE = 1900 * 1024 * 1024; // 1.9 GB per part

let offsetCache = null;

async function getOffsetTable() {
    if (offsetCache) return offsetCache;
    const url = `${GH_BASE}/faac_index_part_0.bin`;
    const resp = await fetch(url, { headers: { Range: 'bytes=0-32775' } });
    if (!resp.ok) throw new Error(`Failed to load index (${resp.status})`);
    const buf = await resp.arrayBuffer();
    const dv = new DataView(buf);
    const offsets = [];
    for (let i = 0; i <= NUM_TAGS; i++) {
        offsets[i] = Number(dv.getBigUint64(i * 8, true));
    }
    offsetCache = offsets;
    return offsets;
}

function g5(x, a, b, c, d, e) {
    return ((x >> a) & 1) | (((x >> b) & 1) << 1) | (((x >> c) & 1) << 2) |
           (((x >> d) & 1) << 3) | (((x >> e) & 1) << 4);
}

function keeloqEncrypt(data, keyLo, keyHi) {
    const nlf = 0x3A5C742E;
    let x = data >>> 0;
    for (let r = 0; r < 528; r++) {
        const kbit = ((r & 63) < 32) ? ((keyLo >>> (r & 31)) & 1) : ((keyHi >>> ((r & 31))) & 1);
        const g = g5(x, 1, 9, 20, 26, 31);
        const nlfBit = (nlf >>> g) & 1;
        const fb = (x & 1) ^ ((x >>> 16) & 1) ^ kbit ^ nlfBit;
        x = (x >>> 1) | (fb << 31);
    }
    return x >>> 0;
}

function keeloqDecrypt(data, keyLo, keyHi) {
    const nlf = 0x3A5C742E;
    let x = data >>> 0;
    for (let r = 0; r < 528; r++) {
        const ki = (15 - r) & 63;
        const kbit = (ki < 32) ? ((keyLo >>> ki) & 1) : ((keyHi >>> (ki - 32)) & 1);
        const g = g5(x, 0, 8, 19, 25, 30);
        const nlfBit = (nlf >>> g) & 1;
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

// Decompress a bucket file: delta+varint encoded sorted uint32 seeds
function decompressBucket(buf) {
    const dv = new DataView(buf);
    const count = dv.getUint32(0, true);
    const seeds = new Uint32Array(count);
    let seed = dv.getUint32(4, true);
    seeds[0] = seed;
    let off = 8;
    for (let i = 1; i < count; i++) {
        let delta = 0, shift = 0;
        while (true) {
            const b = dv.getUint8(off++);
            delta |= (b & 0x7F) << shift;
            if (!(b & 0x80)) break;
            shift += 7;
        }
        seed += delta + 1;
        seeds[i] = seed;
    }
    return seeds;
}

async function fetchBucket(tag) {
    const offsets = await getOffsetTable();
    const start = offsets[tag];
    const end = offsets[tag + 1];
    const length = end - start;

    const partNum = Math.floor(start / PART_SIZE);
    const partStart = start - partNum * PART_SIZE;

    const url = `${GH_BASE}/faac_index_part_${partNum}.bin`;
    const resp = await fetch(url, { headers: { Range: `bytes=${partStart}-${partStart + length - 1}` } });
    if (!resp.ok) throw new Error(`Failed to fetch tag ${tag} (${resp.status})`);
    const buf = await resp.arrayBuffer();
    return decompressBucket(buf);
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

async function startRecovery() {
    const btn = document.getElementById('recover-btn');
    btn.disabled = true;
    btn.textContent = 'Working...';

    try {
        const mfkeyHex = document.getElementById('mfkey').value.trim();
        if (mfkeyHex.length !== 16 || !/^[0-9a-fA-F]+$/.test(mfkeyHex)) {
            throw new Error('Invalid mfkey: must be 16 hex digits');
        }
        const mfkey = BigInt('0x' + mfkeyHex);
        const mfkeyLo = Number(mfkey & 0xFFFFFFFFn) >>> 0;
        const mfkeyHi = Number(mfkey >> 32n) >>> 0;

        const frames = parseFrames(document.getElementById('frames').value);
        if (frames.length < 1) throw new Error('Enter at least 2 frames (3+ recommended).');
        if (frames.length > 16) throw new Error('Maximum 16 frames.');

        // Compute expected tags (even and odd parity)
        const tagEven = nibbleCheck(frames[0].fix, true);
        const tagOdd = nibbleCheck(frames[0].fix, false);

        setProgress(5, 'Fetching index buckets...');

        // Fetch both buckets in parallel
        const [bucketA, bucketB] = await Promise.all([
            fetchBucket(tagEven),
            fetchBucket(tagOdd)
        ]);

        // Merge and deduplicate seeds
        const seen = new Set();
        const seeds = [];
        for (const s of bucketA) { if (!seen.has(s)) { seen.add(s); seeds.push(s); } }
        for (const s of bucketB) { if (!seen.has(s)) { seen.add(s); seeds.push(s); } }
        const total = seeds.length;
        const nf = frames.length;

        setProgress(10, `Verifying ${total.toLocaleString()} candidates against ${nf} frame(s)...`);

        const survivors = [];
        const report = 100000;
        for (let i = 0; i < total; i++) {
            const seed = seeds[i];
            const dev = faacLearning(seed, mfkeyLo, mfkeyHi);
            const dec = keeloqDecrypt(frames[0].hop, dev.lo, dev.hi);
            if (validate(dec, frames[0].fix)) {
                let ok = true;
                for (let j = 1; j < nf; j++) {
                    const d = keeloqDecrypt(frames[j].hop, dev.lo, dev.hi);
                    if (!validate(d, frames[j].fix)) { ok = false; break; }
                }
                if (ok) survivors.push(seed);
            }
            if ((i + 1) % report === 0 || i === total - 1) {
                const pct = 10 + ((i + 1) / total) * 85;
                setProgress(pct, `Verified ${(i + 1).toLocaleString()} / ${total.toLocaleString()}... ${survivors.length} candidate(s) found`);
                await new Promise(r => setTimeout(r, 0)); // yield for UI
            }
        }

        setProgress(95, 'Finalizing...');

        if (survivors.length === 0) {
            showError('No matching seed found. Check mfkey or try with more frames.');
        } else if (nf >= 3 && survivors.length <= 10) {
            const s = survivors[0];
            const dev = faacLearning(s, mfkeyLo, mfkeyHi);
            let html = `<div class="seed-found">Seed: 0x${s.toString(16).padStart(8, '0').toUpperCase()}</div>`;
            html += `<div>Device Key: 0x${dev.hi.toString(16).padStart(8, '0').toUpperCase()}${dev.lo.toString(16).padStart(8, '0').toUpperCase()}</div>`;
            html += `<div>Confidence: 100% (unique result)</div>`;
            if (survivors.length > 1) {
                html += `<div class="toggle-list" onclick="this.nextElementSibling.style.display='block';this.style.display='none'">Show alternate candidates (${survivors.length - 1})</div>`;
                html += `<div class="seed-list" style="display:none">`;
                for (let i = 1; i < survivors.length; i++) {
                    html += `<div class="candidate">0x${survivors[i].toString(16).padStart(8, '0').toUpperCase()}</div>`;
                }
                html += `</div>`;
            }
            showResult(html);
        } else if (nf >= 2) {
            // 2 frames: show top + list
            const sameBtn = ((frames[0].fix & 0xF) === (frames[1].fix & 0xF));
            // Compute decrypted counters for sorting
            const scored = survivors.map(seed => {
                const dev = faacLearning(seed, mfkeyLo, mfkeyHi);
                const counters = frames.map(f => keeloqDecrypt(f.hop, dev.lo, dev.hi) & 0xFFFFF);
                const gap = sameBtn ? Math.abs(counters[0] - counters[1]) : -1;
                return { seed, gap, counters };
            });
            if (sameBtn) {
                scored.sort((a, b) => a.gap - b.gap);
            } else {
                scored.sort((a, b) => a.seed - b.seed);
            }
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
        } else {
            showError(`1 frame: ${survivors.length.toLocaleString()} candidate(s). Capture 1-2 more frames.`);
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

