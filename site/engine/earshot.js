// Earshot engine. Turns a colour-coded map into sound and back again.
// Pure functions, no browser or Node APIs, so the same file runs in the page,
// in the API server and in the MCP server.
//
// Pipeline:  pixels -> values (decode) -> 8 x N grid (toGrid) -> audio (sonify)
//            audio -> 8 x N grid (listenBack)   <- the proof step
//
// Written with AI assistance (Claude). See README, "Use of AI".

export const BANDS = 8;
export const DEFAULT_COLS = 72;

// Eight voices, south to north: A2 E3 A3 C#4 F#4 B4 E5 A5. Together they make a
// "six-nine" chord on A, tuned in whole-number ratios of 55 Hz (just intonation).
// No two voices are a semitone or a tritone apart, so any mix of them is
// consonant. Because the tuning is exact, an overtone of a low voice either
// lands exactly on a higher voice or at least 41 Hz away from one; listenBack()
// removes the exact overlaps by arithmetic.
export const VOICE_HZ = [110, 165, 220, 275, 371.25, 495, 660, 880];
// The four-voice setting merges the bands in pairs and uses A2 E3 C#4 B4. None of
// them is an overtone of the lowest voice (unlike A3 or E5 would be), which makes
// them less likely to melt into one sound.
export const SIMPLE_HZ = [110, 165, 275, 495];

// An instrument is a recipe of overtones: the loudness of the 2nd, 3rd, ...
// harmonic relative to the fundamental. Each record gets its own.
export const TIMBRES = {
  choir: [1, 0.3, 0.3, 0.2, 0.1],            // rounded, like a sung vowel
  glass: [1, 0.06],                          // nearly pure, for water
  reed: [1, 0, 0.6, 0, 0.3],                 // hollow, odd overtones only, for smoke
  string: [1, 0.7, 0.5, 0.35, 0.25, 0.15],   // bright and full, for haze
  brass: [1, 0.9, 0.7, 0.5, 0.3, 0.2],       // the brightest, for city lights
  flute: [1, 0.45, 0.08],                    // soft, mostly the octave above
};
const TIMBRE_NAMES = Object.keys(TIMBRES);

// Low notes sound quieter to the ear than high notes of the same strength.
// Each voice is lifted by 3 dB for every octave it sits below the top voice.
const earWeight = (hz) => Math.pow(10, (3 * Math.log2(880 / hz)) / 20);

// Voices that start together, hold together and share one tone colour tend to
// melt into a single sound. So each voice is given its own slow shimmer: its
// loudness dips by up to 30 percent, at a rate no other voice shares (2 Hz for
// the lowest voice, rising to about 8 Hz for the highest). The ear uses that
// difference to keep the voices apart. listenBack() knows the same pattern and
// removes it exactly.
// Loudness on its own is a weak way to carry a value (Neuhoff 2011; Flowers 2005),
// so the value is carried twice: a fuller voice is louder and also brighter. Its
// overtones run from 35 percent of their full strength at level 0 to all of it at level 1.
const brightAt = (level) => 0.35 + 0.65 * Math.min(1, Math.max(0, level));
const SHIMMER_DEPTH = 0.3;
function shimmerAt(b, rows, seconds) {
  const hz = 2 + b * (rows === 4 ? 1.8 : 0.9);
  return 1 - SHIMMER_DEPTH * (0.5 - 0.5 * Math.cos(2 * Math.PI * hz * seconds + b * 1.7));
}

export const BAND_NAMES = [
  'Antarctic', 'Southern Ocean', 'southern mid-latitudes', 'southern tropics',
  'northern tropics', 'northern mid-latitudes', 'northern high latitudes', 'Arctic',
];

// Latitude edges of the eight bands, south to north, in degrees.
export const BAND_EDGES = [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90];

const GAMMA = 0.6; // loudness curve: gain = level ^ GAMMA

// ---------------------------------------------------------------- colour scales

// Parse a NASA GIBS colour map (XML text) into entries {r,g,b,lo,hi,nodata}.
export function parseGibsColormap(xml) {
  const entries = [];
  const re = /<ColorMapEntry\s+([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attr = (name) => {
      const a = new RegExp(name + '="([^"]*)"').exec(m[1]);
      return a ? a[1] : null;
    };
    const rgb = attr('rgb');
    if (!rgb) continue;
    const [r, g, b] = rgb.split(',').map(Number);
    const nodata = attr('nodata') === 'true' || attr('transparent') === 'true';
    const range = attr('value') || attr('sourceValue') || '';
    const nums = range.replace(/[\[\]()]/g, '').split(',').map((s) => s.trim());
    let lo = parseFloat(nums[0]);
    let hi = parseFloat(nums.length > 1 ? nums[1] : nums[0]);
    if (!isFinite(lo) && isFinite(hi)) lo = hi;
    if (!isFinite(hi) && isFinite(lo)) hi = lo;
    if (!isFinite(lo)) continue;
    entries.push({ r, g, b, lo, hi, mid: (lo + hi) / 2, nodata });
  }
  return entries;
}

// Build a scale from colour stops sampled along a legend: [{r,g,b,value}].
export function scaleFromStops(stops) {
  return stops.map((s) => ({ r: s.r, g: s.g, b: s.b, lo: s.value, hi: s.value, mid: s.value, nodata: false }));
}

// ---------------------------------------------------------------- decode

// rgba: Uint8ClampedArray or Uint8Array of w*h*4. Returns {values, valid, exactShare}.
// opts.tolerance: largest colour distance (0..441) accepted as a match.
// opts.mode 'brightness' ignores the scale and reads luminance 0..1.
export function decode(rgba, w, h, scale, opts = {}) {
  const n = w * h;
  const values = new Float32Array(n);
  const valid = new Uint8Array(n);
  const tol = opts.tolerance ?? 40;
  const tol2 = tol * tol;
  let exact = 0;
  let matched = 0;

  if (opts.mode === 'brightness' || opts.mode === 'spark') {
    const south = opts.south ?? -90, north = opts.north ?? 90;
    for (let i = 0; i < n; i++) {
      const a = rgba[i * 4 + 3];
      if (a < 128) continue;
      const lat = 90 - ((Math.floor(i / w) + 0.5) / h) * 180;
      if (lat < south || lat > north) continue; // outside what the instrument can see
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      // 'spark' reads bright yellow marks on a dark picture (lightning flashes)
      values[i] = opts.mode === 'spark'
        ? Math.min(1, Math.max(0, (Math.min(r, g) - b - 60) / 140))
        : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      valid[i] = 1;
      matched++;
    }
    applyMask(valid, w, h, opts.mask);
    return { values, valid, exactShare: 0, matchedShare: matched / n };
  }

  const table = new Map();
  for (const e of scale) table.set((e.r << 16) | (e.g << 8) | e.b, e);
  const live = scale.filter((e) => !e.nodata);
  const cache = new Map();

  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (a < 128) continue;
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let e = table.get(key);
    if (e) {
      if (e.nodata) continue;
      exact++;
    } else {
      e = cache.get(key);
      if (e === undefined) {
        let best = null;
        let bestD = tol2;
        for (const c of live) {
          const dr = c.r - r, dg = c.g - g, db = c.b - b;
          const d = dr * dr + dg * dg + db * db;
          if (d <= bestD) { bestD = d; best = c; }
        }
        e = best;
        cache.set(key, e);
      }
      if (!e) continue;
    }
    values[i] = e.mid;
    valid[i] = 1;
    matched++;
  }
  if (opts.emptyIsZero) {
    // For records where "no colour" means "none" (dry sky), inside the covered latitudes.
    const south = opts.south ?? -90, north = opts.north ?? 90;
    for (let y = 0; y < h; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      if (lat < south || lat > north) continue;
      for (let x = 0; x < w; x++) { const i = y * w + x; if (!valid[i]) { values[i] = 0; valid[i] = 1; } }
    }
  }
  applyMask(valid, w, h, opts.mask);
  return { values, valid, exactShare: matched ? exact / matched : 0, matchedShare: matched / n };
}

// Blank out rectangles (logos, date stamps) given for a 1024 x 512 frame.
function applyMask(valid, w, h, mask) {
  if (!mask) return;
  for (const [x0, y0, x1, y1] of mask) {
    const ax = Math.floor((x0 / 1024) * w), bx = Math.ceil((x1 / 1024) * w);
    const ay = Math.floor((y0 / 512) * h), by = Math.ceil((y1 / 512) * h);
    for (let y = ay; y < by && y < h; y++) for (let x = ax; x < bx && x < w; x++) valid[y * w + x] = 0;
  }
}

// ---------------------------------------------------------------- grid

// Reduce a full-globe equirectangular field to 8 latitude bands x cols.
// extent = {west, east, south, north} in degrees; defaults to the whole globe.
// Each cell holds the area-weighted mean and the share of the cell that had data.
export function toGrid(values, valid, w, h, cols = DEFAULT_COLS, extent = { west: -180, east: 180, south: -90, north: 90 }) {
  const mean = Array.from({ length: BANDS }, () => new Float32Array(cols));
  const cover = Array.from({ length: BANDS }, () => new Float32Array(cols));
  const sum = Array.from({ length: BANDS }, () => new Float64Array(cols));
  const wsum = Array.from({ length: BANDS }, () => new Float64Array(cols));
  const wall = Array.from({ length: BANDS }, () => new Float64Array(cols));
  const latSpan = extent.north - extent.south;
  const lonSpan = extent.east - extent.west;
  for (let y = 0; y < h; y++) {
    const lat = extent.north - ((y + 0.5) / h) * latSpan;
    let band = Math.floor((lat + 90) / 22.5);
    if (band < 0) band = 0;
    if (band > BANDS - 1) band = BANDS - 1;
    const wgt = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < w; x++) {
      const lon = extent.west + ((x + 0.5) / w) * lonSpan;
      let c = Math.floor(((lon + 180) / 360) * cols);
      if (c < 0) c = 0;
      if (c > cols - 1) c = cols - 1;
      const i = y * w + x;
      wall[band][c] += wgt;
      if (valid[i]) {
        sum[band][c] += values[i] * wgt;
        wsum[band][c] += wgt;
      }
    }
  }
  for (let b = 0; b < BANDS; b++) {
    for (let c = 0; c < cols; c++) {
      cover[b][c] = wall[b][c] > 0 ? wsum[b][c] / wall[b][c] : 0;
      mean[b][c] = wsum[b][c] > 0 ? sum[b][c] / wsum[b][c] : NaN;
    }
  }
  return { mean, cover, cols };
}

// Build a grid from rows of {lat, lon, value}: bring-your-own-data path.
export function gridFromPoints(points, cols = DEFAULT_COLS) {
  const sum = Array.from({ length: BANDS }, () => new Float64Array(cols));
  const cnt = Array.from({ length: BANDS }, () => new Float64Array(cols));
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lon) || !isFinite(p.value)) continue;
    let lon = ((((p.lon + 180) % 360) + 360) % 360) - 180;
    let b = Math.min(BANDS - 1, Math.max(0, Math.floor((p.lat + 90) / 22.5)));
    let c = Math.min(cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * cols)));
    sum[b][c] += p.value;
    cnt[b][c] += 1;
  }
  const mean = Array.from({ length: BANDS }, () => new Float32Array(cols));
  const cover = Array.from({ length: BANDS }, () => new Float32Array(cols));
  for (let b = 0; b < BANDS; b++) {
    for (let c = 0; c < cols; c++) {
      mean[b][c] = cnt[b][c] ? sum[b][c] / cnt[b][c] : NaN;
      cover[b][c] = cnt[b][c] ? 1 : 0;
    }
  }
  return { mean, cover, cols };
}

// Map grid means to 0..1 levels using the record's range. Cells with too little
// data are silent (level 0) and flagged, so a gap is never heard as "clean".
export function toLevels(grid, lo, hi, minCover = 0.08, curve = 'linear') {
  const level = Array.from({ length: BANDS }, () => new Float32Array(grid.cols));
  const known = Array.from({ length: BANDS }, () => new Uint8Array(grid.cols));
  for (let b = 0; b < BANDS; b++) {
    for (let c = 0; c < grid.cols; c++) {
      const v = grid.mean[b][c];
      if (!isFinite(v) || grid.cover[b][c] < minCover) continue;
      level[b][c] = valueToLevel(v, lo, hi, curve);
      known[b][c] = 1;
    }
  }
  return { level, known, cols: grid.cols, lo, hi, curve };
}

// 'log' suits quantities that span several powers of ten, such as rain rate.
export function valueToLevel(v, lo, hi, curve = 'linear') {
  if (curve === 'log') return v <= lo ? 0 : Math.min(1, Math.log(v / lo) / Math.log(hi / lo));
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

export function levelToValue(level, lo, hi, curve = 'linear') {
  if (curve === 'log') return level <= 0 ? 0 : lo * Math.pow(hi / lo, level);
  return lo + level * (hi - lo);
}

// ---------------------------------------------------------------- sonify

// levels: from toLevels(), or from simplify() for the four-voice setting.
//
// What you hear, in order:
//  1. A short tuning note. Its loudness is a fixed fraction of one full voice,
//     and its pitch says which instrument and how many voices follow. That is
//     what lets listenBack() work from the sound alone, at any volume.
//  2. The sweep, west to east, left ear to right ear. One voice per band;
//     louder means more.
//  3. Extra cues that are not part of the check: a rhythm whose speed follows
//     how much there is in each slice (opts.rhythm: 'crackle' or 'patter'),
//     and a soft hiss wherever the map has no data (opts.hush, on by default).
//
// opts.gain: a fixed master volume, so two days of one record can be compared
// by ear. Without it the sound is brought to a peak of 0.85.
export const PILOT_HZ = 1000;
const PILOT_SECONDS = 0.3;
const PILOT_AMP = 0.5; // the tuning note is half the strength of one full top voice
const LEAD_SECONDS = 0.45; // tuning note plus a short breath before the sweep
const HUSH = 0.9;

function pilotFor(timbre, rows, shimmer = true) {
  return PILOT_HZ + 100 * Math.max(0, TIMBRE_NAMES.indexOf(timbre)) + (rows === 4 ? 50 : 0) + (shimmer ? 0 : 25);
}

// A small repeatable random source, so the same map always makes the same sound.
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

export function sonify(levels, opts = {}) {
  const sampleRate = opts.sampleRate ?? 22050;
  const sweep = opts.seconds ?? 12;
  const cols = levels.cols;
  const rows = levels.level.length;
  const hz = rows === 4 ? SIMPLE_HZ : VOICE_HZ;
  const timbre = TIMBRES[opts.timbre] ? opts.timbre : 'choir';
  const H = TIMBRES[timbre];
  const lead = Math.floor(sampleRate * LEAD_SECONDS);
  const body = Math.floor(sampleRate * sweep);
  const total = lead + body;
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const mix = new Float32Array(body); // everything in the sweep, before it is placed between the ears
  const colSamples = body / cols;
  const TWO_PI = 2 * Math.PI;
  const colAt = (i) => {
    const pos = i / colSamples - 0.5;
    const c0 = Math.max(0, Math.min(cols - 1, Math.floor(pos)));
    return [c0, Math.max(0, Math.min(cols - 1, c0 + 1)), Math.max(0, Math.min(1, pos - c0))];
  };

  // 1. tuning note, centred
  const shimmer = opts.shimmer !== false;
  const pilotHz = pilotFor(timbre, rows, shimmer);
  const pilotN = Math.floor(sampleRate * PILOT_SECONDS);
  for (let i = 0; i < pilotN; i++) {
    const edge = Math.min(1, i / (sampleRate * 0.01), (pilotN - i) / (sampleRate * 0.01));
    const s = edge * PILOT_AMP * Math.sin((TWO_PI * pilotHz * i) / sampleRate) * Math.SQRT1_2;
    left[i] = s; right[i] = s;
  }

  // 2. the voices
  for (let b = 0; b < rows; b++) {
    const row = levels.level[b];
    const weight = earWeight(hz[b]);
    const step = (TWO_PI * hz[b]) / sampleRate;
    for (let i = 0; i < body; i++) {
      const [c0, c1, t] = colAt(i);
      const lvl = row[c0] * (1 - t) + row[c1] * t;
      if (lvl <= 0) continue;
      const ph = step * i;
      const bright = brightAt(lvl);
      let s = H[0] * Math.sin(ph);
      for (let h = 1; h < H.length; h++) if (H[h]) s += bright * H[h] * Math.sin((h + 1) * ph);
      mix[i] += Math.pow(lvl, GAMMA) * weight * s * (shimmer ? shimmerAt(b, rows, i / sampleRate) : 1);
    }
  }

  // 3a. hiss where there is no data: the more bands are missing, the more hiss.
  // The noise is shaped to sit between 3 and 8 kHz, well above the voices.
  if (opts.hush !== false) {
    const gap = new Float32Array(cols);
    let any = false;
    for (let c = 0; c < cols; c++) {
      let n = 0;
      for (let b = 0; b < rows; b++) if (!levels.known[b][c]) n++;
      gap[c] = n / rows;
      if (n) any = true;
    }
    if (any) {
      const rand = rng(7);
      const n = new Float32Array(5);
      for (let i = 0; i < body; i++) {
        n[4] = n[3]; n[3] = n[2]; n[2] = n[1]; n[1] = n[0]; n[0] = rand() * 2 - 1;
        const [c0, c1, t] = colAt(i);
        const share = gap[c0] * (1 - t) + gap[c1] * t;
        if (share > 0) mix[i] += HUSH * share * 0.35 * (n[0] - 2 * n[2] + n[4]);
      }
    }
  }

  // 3b. rhythm: the more there is in a slice, the faster it ticks.
  // 'crackle' is a sharp tick (lightning); 'patter' is a soft rising drop (rain).
  if (opts.rhythm === 'crackle' || opts.rhythm === 'patter') {
    const crackle = opts.rhythm === 'crackle';
    const rand = rng(crackle ? 11 : 23);
    const maxRate = crackle ? 36 : 48; // ticks per second in the fullest slice
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let b = 0; b < rows; b++) if (levels.known[b][c]) sum += levels.level[b][c];
      const strength = Math.min(1, sum / (rows / 4)); // two full bands of eight count as full
      const count = Math.round(Math.pow(strength, 0.8) * maxRate * (sweep / cols));
      for (let e = 0; e < count; e++) {
        const start = Math.floor((c + rand()) * colSamples);
        const f0 = crackle ? 3000 + rand() * 1500 : 1500 + rand() * 900;
        const len = Math.floor(sampleRate * (crackle ? 0.005 : 0.012));
        const decay = sampleRate * (crackle ? 0.0012 : 0.004);
        const amp = crackle ? 0.5 : 0.28;
        for (let i = 0; i < len && start + i < body; i++) {
          const f = crackle ? f0 : f0 * (1 + (0.5 * i) / len);
          mix[start + i] += amp * Math.exp(-i / decay) * Math.sin((TWO_PI * f * i) / sampleRate);
        }
      }
    }
  }

  // opts.marker: a soft two-note chime as the sweep passes one place (0 to 1 along
  // the sweep), so a listener hears where they are. It sits above 2 kHz, clear of the voices.
  if (opts.marker && isFinite(opts.marker.at)) {
    const start = Math.floor(Math.min(1, Math.max(0, opts.marker.at)) * body - sampleRate * 0.05);
    const len = Math.floor(sampleRate * 0.35);
    for (let i = 0; i < len; i++) {
      if (start + i < 0 || start + i >= body) continue;
      const tt = i / sampleRate, env = Math.min(1, i / (sampleRate * 0.004)) * Math.exp(-tt / 0.09);
      const second = tt > 0.12 ? Math.min(1, (tt - 0.12) / 0.004) * Math.exp(-(tt - 0.12) / 0.09) : 0;
      mix[start + i] += 0.32 * (env * Math.sin(TWO_PI * 2349.3 * tt) + second * Math.sin(TWO_PI * 3136 * tt));
    }
  }

  // a short soft click at each quarter of the way round, as a position cue
  if (opts.ticks ?? true) {
    for (let q = 1; q < 4; q++) {
      const start = Math.floor((q / 4) * body);
      const len = Math.floor(sampleRate * 0.012);
      for (let i = 0; i < len && start + i < body; i++) {
        mix[start + i] += 0.5 * Math.exp(-i / (sampleRate * 0.003)) * Math.sin((TWO_PI * 1800 * i) / sampleRate);
      }
    }
  }

  // place the sweep between the ears (equal power, west = left) and soften its two ends
  const fade = Math.floor(sampleRate * 0.015);
  for (let i = 0; i < body; i++) {
    const edge = Math.min(1, i / fade, (body - 1 - i) / fade);
    const pan = (i / body) * (Math.PI / 2);
    left[lead + i] = mix[i] * edge * Math.cos(pan);
    right[lead + i] = mix[i] * edge * Math.sin(pan);
  }

  // master volume
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  // opts.normalize === false leaves the samples as computed and reports the peak,
  // so a caller can bring several clips to one shared volume with scaleAudio().
  let gain = opts.normalize === false ? 1 : isFinite(opts.gain) && opts.gain > 0 ? opts.gain : peak > 0 ? 0.85 / peak : 1;
  let turnedDownDb = 0;
  if (opts.normalize !== false && peak * gain > 0.98) {
    turnedDownDb = 20 * Math.log10((peak * gain) / 0.98);
    gain = 0.98 / peak;
  }
  for (let i = 0; i < total; i++) { left[i] *= gain; right[i] *= gain; }

  return {
    left, right, sampleRate, seconds: total / sampleRate, lead: lead / sampleRate, sweep, colSeconds: sweep / cols,
    gain, peak: peak * gain, turnedDownDb, timbre, voices: rows, rhythm: opts.rhythm || null, shimmer,
  };
}

// Multiply a clip's volume by k, in place.
export function scaleAudio(audio, k) {
  for (let i = 0; i < audio.left.length; i++) { audio.left[i] *= k; audio.right[i] *= k; }
  audio.gain *= k; audio.peak *= k;
  return audio;
}

// Where a value grew between two maps of the same record: the rise in each cell,
// on a fixed scale, so that a small change sounds small and a large one loud. A
// rise of `full` (a third of the record's scale, by default) or more plays at full
// strength. Falls, and rises under a tenth of the largest, are silent. Cells
// missing from either map stay unknown. A change too small to hear between two
// separate sweeps stands out here, because everything that did not change is silent.
export function changeLevels(a, b, full = 1 / 3) {
  const rise = a.level.map((row, r) => Float32Array.from(row, (v, c) => (a.known[r][c] && b.known[r][c] ? Math.max(0, b.level[r][c] - v) : 0)));
  let max = 0;
  for (const row of rise) for (const v of row) if (v > max) max = v;
  const level = rise.map((row) => Float32Array.from(row, (v) => (max > 0 && v >= 0.1 * max ? Math.min(1, v / full) : 0)));
  const known = a.known.map((row, r) => Uint8Array.from(row, (k, c) => (k && b.known[r][c] ? 1 : 0)));
  return { level, known, cols: a.cols, lo: 0, hi: max, curve: 'linear', change: true, full, largest: max };
}

// The same map with only one band sounding: the others are silent and count as
// known, so they add no hiss. Used to play the bands one at a time.
export function onlyBand(levels, band) {
  return {
    ...levels,
    level: levels.level.map((row, r) => (r === band ? row : new Float32Array(row.length))),
    known: levels.known.map((row, r) => (r === band ? row : new Uint8Array(row.length).fill(1))),
  };
}

// Join several clips one after another with a short pause between them.
export function joinAudio(clips, gapSeconds = 0.5) {
  const sr = clips[0].sampleRate, gap = Math.floor(sr * gapSeconds);
  const n = clips.reduce((t, a) => t + a.left.length, 0) + gap * (clips.length - 1);
  const left = new Float32Array(n), right = new Float32Array(n), parts = [];
  let at = 0;
  for (const a of clips) {
    left.set(a.left, at); right.set(a.right, at);
    parts.push({ start: at / sr, lead: a.lead, sweep: a.sweep });
    at += a.left.length + gap;
  }
  return { left, right, sampleRate: sr, seconds: n / sr, lead: clips[0].lead, sweep: clips[0].sweep, parts, timbre: clips[0].timbre, voices: clips[0].voices, rhythm: clips[0].rhythm, gain: clips[0].gain, turnedDownDb: Math.max(...clips.map((a) => a.turnedDownDb || 0)) };
}

// Merge the eight bands in pairs for the four-voice setting.
export function simplify(levels) {
  const cols = levels.cols, level = [], known = [];
  for (let b = 0; b < levels.level.length; b += 2) {
    const l = new Float32Array(cols), k = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      const k0 = levels.known[b][c], k1 = levels.known[b + 1][c];
      if (!k0 && !k1) continue;
      l[c] = k0 && k1 ? (levels.level[b][c] + levels.level[b + 1][c]) / 2 : k0 ? levels.level[b][c] : levels.level[b + 1][c];
      k[c] = 1;
    }
    level.push(l); known.push(k);
  }
  return { ...levels, level, known };
}

// ---------------------------------------------------------------- listen back (the check)

// Recover the level grid from audio alone. It is given the samples only and
// never sees the map.
//  1. Find the tuning note. Its pitch tells which instrument and how many
//     voices were used; its loudness is the yardstick for everything else.
//  2. In each time slice, measure the strength of each voice's pitch with the
//     Goertzel algorithm (a one-frequency Fourier measurement).
//  3. Where an overtone of a lower voice lands exactly on a higher voice,
//     subtract it, working from the lowest voice up.
//  4. Undo the ear weighting and the loudness curve.
export function listenBack(audio, cols = DEFAULT_COLS) {
  const { left, right, sampleRate } = audio;
  const lead = Math.floor(sampleRate * LEAD_SECONDS);
  const body = left.length - lead;
  const pilotA = Math.floor(sampleRate * 0.03);
  const pilotN = Math.floor(sampleRate * (PILOT_SECONDS - 0.06));
  let found = { amp: 0, timbre: 'choir', rows: BANDS, shimmer: true };
  for (const timbre of TIMBRE_NAMES) {
    for (const rows of [BANDS, 4]) {
      for (const shimmer of [true, false]) {
        const f = pilotFor(timbre, rows, shimmer);
        const amp = Math.hypot(goertzel(left, pilotA, pilotN, f, sampleRate), goertzel(right, pilotA, pilotN, f, sampleRate));
        if (amp > found.amp) found = { amp, timbre, rows, shimmer };
      }
    }
  }
  const pilot = found.amp || 1;
  const rows = found.rows;
  const hz = rows === 4 ? SIMPLE_HZ : VOICE_HZ;
  const H = TIMBRES[found.timbre];
  const weight = hz.map(earWeight);
  // overlap[b][k]: how much of voice k's sound arrives at voice b's pitch
  const overlap = hz.map((fb, b) => hz.map((fk, k) => {
    if (k >= b) return 0;
    let s = 0;
    for (let h = 1; h < H.length; h++) if (Math.abs((h + 1) * fk - fb) < 0.5) s += H[h];
    return s * weight[k];
  }));
  const colSamples = body / cols;
  const level = Array.from({ length: rows }, () => new Float32Array(cols));
  // If the two channels are identical the file was folded to one channel on the way.
  // The sweep's position between the ears is known for every slice, so the fold can be undone.
  let mono = !!audio.mono;
  if (!mono) { mono = true; for (let i = lead; i < left.length; i += 97) if (Math.abs(left[i] - right[i]) > 1e-4) { mono = false; break; } }
  const heardAmount = new Float64Array(rows); // each voice's strength in this slice, shimmer included
  const heardBright = new Float64Array(rows); // how bright each voice was, worked out from its level
  for (let c = 0; c < cols; c++) {
    // the middle 60 percent of the slice, where each voice is closest to its value for this slice
    const a = lead + Math.floor((c + 0.2) * colSamples);
    const n = lead + Math.floor((c + 0.8) * colSamples) - a;
    for (let b = 0; b < rows; b++) {
      let y = (Math.hypot(goertzel(left, a, n, hz[b], sampleRate), goertzel(right, a, n, hz[b], sampleRate)) * PILOT_AMP) / pilot;
      if (mono) { const pan = ((c + 0.5) / cols) * (Math.PI / 2); y /= (Math.cos(pan) + Math.sin(pan)) / Math.SQRT2; }
      for (let k = 0; k < b; k++) y -= overlap[b][k] * heardAmount[k] * heardBright[k];
      heardAmount[b] = Math.max(0, y / (weight[b] * H[0]));
      // the average of this voice's shimmer over the same windowed slice
      let dip = 1;
      if (found.shimmer) {
        let sw = 0, sm = 0;
        for (let i = 0; i < n; i += 4) {
          const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
          sw += win; sm += win * shimmerAt(b, rows, (a - lead + i) / sampleRate);
        }
        dip = sw ? sm / sw : 1;
      }
      level[b][c] = Math.min(1, Math.pow(heardAmount[b] / dip, 1 / GAMMA));
      heardBright[b] = brightAt(level[b][c]);
    }
  }
  return { level, cols, pilot, timbre: found.timbre, voices: rows, shimmer: found.shimmer, mono };
}

function goertzel(x, start, n, freq, sampleRate) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    // Hann window keeps neighbouring voices from leaking into each other
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    s0 = x[start + i] * win + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / (n * 0.5); // 0.5 = Hann coherent gain
}

// Compare what went in with what was heard back. Only cells that had data count.
export function compare(levels, heard) {
  const a = [], b = [];
  for (let r = 0; r < levels.level.length; r++) {
    for (let c = 0; c < levels.cols; c++) {
      if (!levels.known[r][c]) continue;
      a.push(levels.level[r][c]);
      b.push(heard.level[r] ? heard.level[r][c] : 0);
    }
  }
  const n = a.length;
  if (n < 3) return { cells: n, r: NaN, meanError: NaN, maxError: NaN };
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0, err = 0, maxErr = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
    const e = Math.abs(a[i] - b[i]);
    err += e;
    if (e > maxErr) maxErr = e;
  }
  return { cells: n, r: saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN, meanError: err / n, maxError: maxErr };
}

// ---------------------------------------------------------------- briefing

const SECTORS = [
  [-180, -120, 'the eastern Pacific'], [-120, -60, 'the Americas'], [-60, -20, 'the Atlantic'],
  [-20, 60, 'Europe and Africa'], [60, 120, 'Asia'], [120, 180, 'the western Pacific'],
];

export function sectorName(lon) {
  for (const [a, z, name] of SECTORS) if (lon >= a && lon < z) return name;
  return 'the western Pacific';
}

// A word for a position on a record's own scale (0 = bottom, 1 = top).
export function wordFor(level) {
  if (level < 0.08) return 'very low';
  if (level < 0.25) return 'low';
  if (level < 0.5) return 'moderate';
  if (level < 0.75) return 'high';
  return 'very high';
}

// A word for a real value, from a record's own table: [[upTo, word], ...].
export function wordFromTable(table, value) {
  for (const [upTo, word] of table) if (value < upTo) return word;
  return table[table.length - 1][1];
}

// Facts about a level grid, as plain data. brief() turns them into sentences.
// With the grid of real values, the peak and the average are reported in real
// units and are not cut off at the top of the scale.
export function facts(levels, grid) {
  const cols = levels.cols;
  const rows = levels.level.length;
  const bandMean = [];
  let known = 0, cells = rows * cols, peak = { level: -1 }, total = 0, vsum = 0, wsum = 0;
  for (let b = 0; b < rows; b++) {
    let s = 0, n = 0;
    const lat = BAND_EDGES[b] + 11.25, w = Math.cos((lat * Math.PI) / 180);
    for (let c = 0; c < cols; c++) {
      if (!levels.known[b][c]) continue;
      const v = levels.level[b][c];
      const real = grid ? grid.mean[b][c] : NaN;
      s += v; n++; known++; total += v;
      if (isFinite(real)) { vsum += real * w; wsum += w; }
      // rank by the real value when there is one, so two cells at the top of the scale are told apart
      const rank = isFinite(real) ? real : v;
      if (peak.level < 0 || rank > peak.rank) {
        peak = { level: v, rank, value: real, band: b, col: c, lon: -180 + ((c + 0.5) / cols) * 360, lat };
      }
    }
    bandMean.push(n ? s / n : NaN);
  }
  let loudest = -1;
  for (let b = 0; b < rows; b++) if (isFinite(bandMean[b]) && (loudest < 0 || bandMean[b] > bandMean[loudest])) loudest = b;
  const half = rows / 2;
  const north = avg(bandMean.slice(half)), south = avg(bandMean.slice(0, half));
  // where in the sweep the most is: thirds of the way round, by the sum over bands
  const third = [0, 0, 0];
  for (let c = 0; c < cols; c++) for (let b = 0; b < rows; b++) if (levels.known[b][c]) third[Math.min(2, Math.floor((c / cols) * 3))] += levels.level[b][c];
  return {
    coverage: known / cells, mean: known ? total / known : NaN, meanValue: wsum ? vsum / wsum : NaN,
    bandMean, loudestBand: loudest, peak, north, south, third,
  };
}

function avg(xs) {
  const v = xs.filter((x) => isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

// Turn facts into two to five short spoken sentences. Written by rules, no language model.
// meta: noun, unit, noValue, grid (real values), words ([[upTo, word]] in real units),
// placeName(lat, lon) for the peak, assumedZero (true when blank means none),
// oceanCaveat (a sentence added when the peak is over open ocean).
export function brief(levels, meta = {}) {
  const f = facts(levels, meta.grid);
  const what = meta.noun || 'the value';
  const unit = meta.unit ? ' ' + meta.unit : '';
  const out = [];
  if (f.peak.level < 0) {
    return { facts: f, sentences: ['This map has almost no data to read.'], text: 'This map has almost no data to read.' };
  }
  const real = (lvl) => levelToValue(lvl, levels.lo, levels.hi, levels.curve);
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const word = (value, level) => (meta.words ? wordFromTable(meta.words, value) : wordFor(level) + ' on this record’s scale');
  const meanValue = isFinite(f.meanValue) ? f.meanValue : real(f.mean);
  const peakValue = isFinite(f.peak.value) ? f.peak.value : real(f.peak.level);
  const where = meta.placeName ? meta.placeName(meta.peakLat ?? f.peak.lat, f.peak.lon) : sectorName(f.peak.lon);

  out.push(meta.noValue
    ? `Across the map, ${what} is ${wordFor(f.mean)} on average.`
    : `Across the map, ${what} averages ${fmt(meanValue)}${unit}, which is ${word(meanValue, f.mean)}.`);
  out.push(`The strongest voice is the ${BAND_NAMES[f.loudestBand]}.`);
  if (meta.noValue) out.push(`The peak is over ${where}, in the ${BAND_NAMES[f.peak.band]}.`);
  else if (peakValue > levels.hi * 1.0001) out.push(`The peak is over ${where}, in the ${BAND_NAMES[f.peak.band]}, at about ${fmt(peakValue)}${unit}. That is above the top of this record’s scale, which stops at ${fmt(levels.hi)}.`);
  else out.push(`The peak is over ${where}, in the ${BAND_NAMES[f.peak.band]}, at about ${fmt(peakValue)}${unit}, which is ${word(peakValue, f.peak.level)}.`);
  // some instruments are fooled over open water; the record supplies the warning
  if (meta.oceanCaveat && /Pacific|Atlantic|Indian Ocean/.test(where)) out.push(meta.oceanCaveat);
  if (isFinite(f.north) && isFinite(f.south) && Math.abs(f.north - f.south) > 0.03) {
    out.push(`The ${f.north > f.south ? 'northern' : 'southern'} half of the planet carries more than the ${f.north > f.south ? 'southern' : 'northern'} half.`);
  }
  if (meta.assumedZero) out.push('On this record a blank patch is counted as none, although it can also mean no estimate.');
  else if (f.coverage < 0.6) out.push(`Only ${Math.round(f.coverage * 100)} percent of the map has data. A hiss in the sound marks the gaps; they are not zero.`);
  return { facts: f, sentences: out, text: out.join(' ') };
}

// The latitude inside one grid cell where the values are highest, so the peak
// can be named by place more closely than "somewhere in this band".
export function peakLat(values, valid, w, h, band, col, cols = DEFAULT_COLS) {
  const x0 = Math.floor((col / cols) * w), x1 = Math.floor(((col + 1) / cols) * w);
  const y0 = Math.floor(((90 - BAND_EDGES[band + 1]) / 180) * h), y1 = Math.floor(((90 - BAND_EDGES[band]) / 180) * h);
  let best = -Infinity, bestY = (y0 + y1) / 2;
  for (let y = y0; y < y1; y++) {
    let s = 0, n = 0;
    for (let x = x0; x < x1; x++) { const i = y * w + x; if (valid[i]) { s += values[i]; n++; } }
    if (n && s / n > best) { best = s / n; bestY = y; }
  }
  return 90 - ((bestY + 0.5) / h) * 180;
}

// ---------------------------------------------------------------- the area around one place

// A box around one place: 60 degrees of longitude by 30 of latitude by default,
// with the place in the middle (moved inside the map near the poles).
export function areaBox(lat, lon, wide = 60, tall = 30) {
  const south = Math.max(-90, Math.min(90 - tall, lat - tall / 2));
  return { west: lon - wide / 2, east: lon + wide / 2, south, north: south + tall, lat, lon };
}

// The grid for a box cut from a whole-world field (equirectangular, w by h). The
// eight bands run south to north inside the box, the columns west to east,
// wrapping across the date line. Each pixel is weighted by the cosine of its latitude.
export function areaGrid(values, valid, w, h, box, cols = 48) {
  const mean = [], cover = [];
  const latSpan = box.north - box.south, lonSpan = box.east - box.west;
  for (let b = 0; b < BANDS; b++) {
    const m = new Float32Array(cols), cv = new Float32Array(cols);
    const lat0 = box.south + (b / BANDS) * latSpan, lat1 = box.south + ((b + 1) / BANDS) * latSpan;
    const y0 = Math.max(0, Math.floor(((90 - lat1) / 180) * h));
    const y1 = Math.min(h, Math.max(y0 + 1, Math.ceil(((90 - lat0) / 180) * h)));
    for (let c = 0; c < cols; c++) {
      const lon0 = box.west + (c / cols) * lonSpan, lon1 = box.west + ((c + 1) / cols) * lonSpan;
      const x0 = Math.floor(((lon0 + 180) / 360) * w), x1 = Math.max(x0 + 1, Math.ceil(((lon1 + 180) / 360) * w));
      let sum = 0, ws = 0, all = 0;
      for (let y = y0; y < y1; y++) {
        const wg = Math.cos(((90 - ((y + 0.5) / h) * 180) * Math.PI) / 180);
        for (let xx = x0; xx < x1; xx++) {
          const i = y * w + (((xx % w) + w) % w);
          all += wg;
          if (valid[i]) { sum += values[i] * wg; ws += wg; }
        }
      }
      cv[c] = all ? ws / all : 0;
      m[c] = ws ? sum / ws : NaN;
    }
    mean.push(m); cover.push(cv);
  }
  return { mean, cover, cols, extent: box };
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export function directionWord(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  const deg = ((Math.atan2(y, x) / r) + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

// Plain sentences about the area around one place: where the most is, how far
// away and in which direction, and which side of the place has more. Written by
// rules from the numbers. meta: name, noun, unit, words, noValue, most (for example
// 'The warmest water'), placeName(lat, lon).
export function nearby(levels, grid, meta = {}) {
  const box = grid.extent, rows = levels.level.length, cols = levels.cols;
  const name = meta.name || 'this place', what = meta.noun || 'the value', unit = meta.unit ? ' ' + meta.unit : '';
  const most = meta.most || `The most ${what}`, is = meta.plural ? 'are' : 'is';
  const latSpan = box.north - box.south, lonSpan = box.east - box.west;
  const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  const word = (v, lvl) => (meta.words && isFinite(v) ? wordFromTable(meta.words, v) : wordFor(lvl) + ' on this record’s scale');
  let peak = null, known = 0;
  const side = { north: [0, 0], south: [0, 0], east: [0, 0], west: [0, 0] };
  for (let b = 0; b < rows; b++) {
    const lat = box.south + ((b + 0.5) / rows) * latSpan;
    for (let c = 0; c < cols; c++) {
      if (!levels.known[b][c]) continue;
      known++;
      const lon = (((box.west + ((c + 0.5) / cols) * lonSpan + 540) % 360) - 180);
      const lvl = levels.level[b][c], real = grid.mean[b] ? grid.mean[b][c] : NaN;
      const rank = isFinite(real) ? real : lvl;
      if (!peak || rank > peak.rank) peak = { rank, level: lvl, value: real, lat, lon, b, c };
      const ns = lat >= box.lat ? 'north' : 'south', ew = c >= cols / 2 ? 'east' : 'west';
      side[ns][0] += lvl; side[ns][1]++; side[ew][0] += lvl; side[ew][1]++;
    }
  }
  if (!peak) {
    const text = `This map has no data in the area around ${name}.`;
    return { peak: null, sentences: [text], text };
  }
  const out = [];
  const km = distanceKm(box.lat, box.lon, peak.lat, peak.lon);
  const where = meta.placeName ? meta.placeName(peak.lat, peak.lon) : '';
  const amount = meta.noValue ? '' : `, at about ${fmt(isFinite(peak.value) ? peak.value : peak.level)}${unit}, which is ${word(peak.value, peak.level)}`;
  if (peak.level < 0.04) out.push(`There is very little ${what} anywhere in the area around ${name}.`);
  else if (km < 250) out.push(`${most} in the area around ${name} ${is} close to ${name} itself${amount}.`);
  else {
    const dist = `${Math.round(km / 50) * 50} kilometres (${Math.round((km * 0.621371) / 25) * 25} miles)`;
    out.push(`${most} in the area around ${name} ${is} about ${dist} to the ${directionWord(box.lat, box.lon, peak.lat, peak.lon)}${where ? ', near ' + where : ''}${amount}.`);
  }
  const avg = (k) => (side[k][1] ? side[k][0] / side[k][1] : NaN);
  const ns = avg('north') - avg('south'), ew = avg('east') - avg('west');
  const pick = [];
  if (isFinite(ns) && Math.abs(ns) > 0.04) pick.push(ns > 0 ? 'north' : 'south');
  if (isFinite(ew) && Math.abs(ew) > 0.04) pick.push(ew > 0 ? 'east' : 'west');
  if (peak.level >= 0.04) out.push(pick.length ? `On average across the area, there is more to the ${pick.join('-')} of ${name}.` : `On average it is spread fairly evenly around ${name}.`);
  const coverage = known / (rows * cols);
  if (coverage < 0.6) out.push(`Only ${Math.round(coverage * 100)} percent of this area has data. A hiss marks the gaps.`);
  return { peak: { ...peak, km }, sentences: out, text: out.join(' ') };
}

// ---------------------------------------------------------------- point lookup

// Value at one place from a decoded field. Averages a small window so one stray pixel does not decide.
export function valueAt(values, valid, w, h, lat, lon, radius = 2, extent = { west: -180, east: 180, south: -90, north: 90 }) {
  const x0 = Math.round(((lon - extent.west) / (extent.east - extent.west)) * w - 0.5);
  const y0 = Math.round(((extent.north - lat) / (extent.north - extent.south)) * h - 0.5);
  let s = 0, n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = ((x0 + dx) % w + w) % w, y = y0 + dy;
      if (y < 0 || y >= h) continue;
      const i = y * w + x;
      if (valid[i]) { s += values[i]; n++; }
    }
  }
  return n ? { value: s / n, samples: n } : { value: NaN, samples: 0 };
}

// ---------------------------------------------------------------- WAV

// 16-bit stereo WAV as a Uint8Array.
// meta: an optional plain object stored inside the file as a small note (title,
// unit, scale, NASA source). The note lets the file be turned back into a
// labelled map later, and records where the sound came from.
export function toWav(audio, meta) {
  const { left, right, sampleRate } = audio;
  const n = left.length;
  let note = meta ? unescape(encodeURIComponent(JSON.stringify(meta))) : '';
  if (note.length % 2) note += ' ';
  const extra = note ? 8 + note.length : 0;
  const buf = new ArrayBuffer(44 + n * 4 + extra);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4 + extra, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  if (note) { const o = 44 + n * 4; str(o, 'eart'); v.setUint32(o + 4, note.length, true); str(o + 8, note); }
  return new Uint8Array(buf);
}

// Read a 16-bit PCM WAV back into {left, right, sampleRate, meta}. Walks the
// file's chunks, so files saved by other programs (with extra chunks) work too.
export function fromWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('this is not a WAV sound file');
  let channels = 2, sampleRate = 22050, bits = 16, dataAt = -1, dataLen = 0, meta = null;
  for (let o = 12; o + 8 <= bytes.byteLength;) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') { channels = v.getUint16(o + 10, true); sampleRate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    else if (id === 'data') { dataAt = o + 8; dataLen = Math.min(len, bytes.byteLength - dataAt); }
    else if (id === 'eart') {
      let t = '';
      for (let i = 0; i < len && o + 8 + i < bytes.byteLength; i++) t += String.fromCharCode(v.getUint8(o + 8 + i));
      try { meta = JSON.parse(decodeURIComponent(escape(t))); } catch { meta = null; }
    }
    o += 8 + len + (len % 2);
  }
  if (dataAt < 0 || bits !== 16) throw new Error('only 16-bit WAV files can be read');
  const n = Math.floor(dataLen / (2 * channels));
  const left = new Float32Array(n), right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = v.getInt16(dataAt + i * 2 * channels, true) / 32767;
    right[i] = channels > 1 ? v.getInt16(dataAt + 2 + i * 2 * channels, true) / 32767 : left[i];
  }
  return { left, right, sampleRate, seconds: n / sampleRate, meta, mono: channels === 1 };
}

// Which cells had no data, packed as text for the note inside a sound file.
// The sound carries the values; it cannot say which silent cells were gaps, so the note does.
export function gapsToText(levels) {
  let out = '';
  for (let b = 0; b < levels.level.length; b++) for (let c = 0; c < levels.cols; c += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) if (c + k < levels.cols && !levels.known[b][c + k]) n |= 1 << k;
    out += n.toString(16);
  }
  return out;
}
export function gapAt(text, rows, cols, b, c) {
  const per = Math.ceil(cols / 4);
  if (!text || text.length !== rows * per) return false;
  return ((parseInt(text[b * per + Math.floor(c / 4)], 16) >> (c % 4)) & 1) === 1;
}

// ---------------------------------------------------------------- CSV

export function gridToCsv(grid, levels) {
  const cols = grid.cols;
  const head = ['band', 'south_edge', 'north_edge'];
  for (let c = 0; c < cols; c++) head.push('lon_' + (-180 + ((c + 0.5) / cols) * 360).toFixed(1));
  const lines = [head.join(',')];
  for (let b = BANDS - 1; b >= 0; b--) {
    const row = [JSON.stringify(BAND_NAMES[b]), BAND_EDGES[b], BAND_EDGES[b + 1]];
    for (let c = 0; c < cols; c++) row.push(levels && !levels.known[b][c] ? '' : isFinite(grid.mean[b][c]) ? +grid.mean[b][c].toFixed(4) : '');
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

// Parse "lat,lon,value" rows (header optional). Returns points for gridFromPoints().
// opts.value: the name of the column to read as the value. Without it, a column
// with a common value name is used, else the first numeric column that is not
// latitude or longitude. The returned array also carries .columns (numeric
// columns that could be the value) and .valueName (the one that was read).
export function parsePointsCsv(text, opts = {}) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pts = [];
  pts.columns = []; pts.valueName = '';
  if (!rows.length) return pts;
  const sep = [',', ';', '\t'].map((s) => [s, splitCsvRow(rows[0], s).length]).sort((a, b) => b[1] - a[1])[0][0];
  let li = 0, lo = 1, vi = 2;
  if (/[a-z]/i.test(rows[0])) {
    const names = splitCsvRow(rows.shift(), sep);
    const h = names.map((s) => s.toLowerCase());
    const find = (re) => h.findIndex((x) => re.test(x));
    li = find(/^(lat|latitude|y)$/); if (li < 0) li = find(/^lat/); if (li < 0) li = 0;
    lo = find(/^(lon|lng|long|longitude|x)$/); if (lo < 0) lo = find(/^(lon|lng)/); if (lo < 0) lo = 1;
    const first = rows.length ? splitCsvRow(rows[0], sep) : [];
    const numeric = h.map((_, i) => i).filter((i) => i !== li && i !== lo && first[i] !== '' && isFinite(Number(first[i])));
    pts.columns = numeric.map((i) => names[i]);
    const want = (opts.value || '').toLowerCase();
    vi = want ? h.indexOf(want) : -1;
    if (vi < 0) vi = numeric.find((i) => /^(val|value|z|data|mag|frp|pm|aod|temp|t2m|sst|precip|rain|count|conc|index)/.test(h[i])) ?? -1;
    if (vi < 0) vi = numeric.length ? numeric[0] : 2;
    pts.valueName = names[vi] || '';
  }
  for (const r of rows) {
    const p = splitCsvRow(r, sep);
    const lat = Number(p[li]), value = Number(p[vi]);
    const lon = Number(p[lo]);
    if (p[li] === '' || p[lo] === '' || p[vi] === '' || p[vi] === undefined) continue;
    if (isFinite(lat) && isFinite(lon) && isFinite(value) && Math.abs(lat) <= 90) pts.push({ lat, lon, value });
  }
  return pts;
}

// Split one CSV row, respecting double-quoted fields.
function splitCsvRow(row, sep) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
