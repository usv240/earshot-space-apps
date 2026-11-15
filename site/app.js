// Earshot page logic. Written with AI assistance (Claude). See README, "Use of AI".
import * as E from './engine/earshot.js';
import { RECORDS, GIBS_COLORMAPS, gibsUrl, defaultDate } from './data/records.js';
import { EIC_RECORDS } from './data/eic.js';
import { findCity, nearestCity, regionAt, coordWords } from './data/places.js';
import { INFO } from './data/info.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const W = 1024, H = 512;

// ------------------------------------------------------------ the catalogue
// Earth Information Center visualizations come first: they are what the jukebox
// is for. A visualization with several frames becomes one record with "parts"
// (moments in time). The aerosol picture becomes one record whose parts are its
// four kinds of particle, each with its own instrument.
const EIC_SOUND = {
  nightlights: { timbre: 'brass', trend: 'growth', most: 'The brightest lights', plural: true },
  currents: { timbre: 'glass', trend: 'season', most: 'The warmest water', words: [[2, 'near freezing'], [10, 'cold'], [18, 'cool'], [24, 'mild'], [28, 'warm'], [Infinity, 'very warm']] },
  'lightning-year': { timbre: 'string', rhythm: 'crackle', trend: 'season', most: 'The most lightning' },
  'aerosol-dust': { timbre: 'reed' }, 'aerosol-smoke': { timbre: 'brass' }, 'aerosol-sulfate': { timbre: 'string' }, 'aerosol-salt': { timbre: 'glass' },
};
function buildCatalogue() {
  const out = [], groups = new Map();
  for (const r0 of EIC_RECORDS) {
    const r = { ...r0, ...EIC_SOUND[r0.id] };
    if (r.group) {
      let g = groups.get(r.group);
      if (!g) {
        g = { id: r.group, kind: 'picture', title: 'Aerosols, four kinds', svs: r.svs, page: r.page, credits: r.credits, listed: r.listed, image: r.image, describe: r.describe, parts: [], partsAre: 'layers', part: 0, field: r.field };
        groups.set(r.group, g); out.push(g);
      }
      g.parts.push({ ...r, label: r.title.replace(/^Aerosols: /, '') });
    } else {
      const frames = r.frames && r.frames.length ? r.frames : [r.image];
      const parts = frames.map((image, i) => ({ image, show: r.showFrames ? r.showFrames[i] : undefined, label: r.frameLabels ? r.frameLabels[i] : frames.length > 1 ? `moment ${i + 1} of ${frames.length}` : r.date }));
      out.push({ ...r, parts, partsAre: 'moments', part: Math.max(0, frames.indexOf(r.image)) });
    }
  }
  return [...out, ...RECORDS.filter((r) => r.kind === 'picture').map((r) => ({ ...r, timbre: r.timbre || 'flute' })), ...RECORDS.filter((r) => r.kind === 'live')];
}
const CATALOGUE = buildCatalogue();
// The record actually read and played: a top-level record, or one of its parts.
function viewOf(top, i = top.part || 0) {
  if (!top.parts) return top;
  const part = top.parts[i];
  if (top.partsAre === 'layers') return { ...part, top, date: part.date };
  return { ...top, image: part.image, show: part.show, date: top.parts.length > 1 ? part.label : top.date, top };
}

const state = {
  record: CATALOGUE[0], top: CATALOGUE[0], date: defaultDate(), source: '', image: null, coast: null,
  field: null, grid: null, levels: null, audio: null, proof: null, brief: null,
  place: null, cursor: null, playing: false, progress: 0, seconds: 12, custom: null,
  simple: true, sound: null, gains: {}, shownDate: null, voice: true, haptic: false,
};
const SAVED_DAY = '2026-11-13'; // the day of the saved copies in records/live/
// the instrument a record plays with: its own, unless the listener chose another
const timbreOf = (rec) => state.timbre || rec.timbre;
const shiftDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ------------------------------------------------------------ theme
const root = document.documentElement;
function setTheme(t, save) {
  root.dataset.theme = t;
  $('#theme').setAttribute('aria-pressed', String(t === 'dark'));
  $('#theme-label').textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  if (save) { try { localStorage.setItem('earshot-theme', t); } catch { /* private mode */ } }
  drawAll();
}
let savedTheme = null;
try { savedTheme = localStorage.getItem('earshot-theme'); } catch { /* private mode */ }
setTimeout(() => setTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false), 0);
$('#theme').addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', true));

const css = (name) => getComputedStyle(root).getPropertyValue(name).trim();

// ------------------------------------------------------------ loading images
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('could not load ' + src));
    im.src = src;
  });
}
async function fetchBitmap(url) {
  const r = await fetch(url, { cache: 'force-cache' });
  if (!r.ok || !String(r.headers.get('content-type')).includes('image')) throw new Error('NASA map service answered ' + r.status);
  const blob = await r.blob();
  return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function pixelsOf(img) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = img.width !== W;
  x.drawImage(img, 0, 0, W, H);
  return { canvas: c, data: x.getImageData(0, 0, W, H) };
}
const scaleCache = new Map();
async function gibsScale(file, fallback) {
  if (scaleCache.has(file)) return scaleCache.get(file);
  let xml;
  try {
    const r = await fetch(GIBS_COLORMAPS + file);
    if (!r.ok) throw new Error('colour table ' + r.status);
    xml = await r.text();
  } catch { xml = await (await fetch(fallback)).text(); }
  const s = E.parseGibsColormap(xml);
  scaleCache.set(file, s);
  return s;
}

// ------------------------------------------------------------ the pipeline
const niceDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Read one picture record into values, a grid and levels. Used by the player,
// the listening check and "play it through time".
async function readPicture(rec) {
  const scale = rec.stops ? E.scaleFromStops(rec.stops.map(([r, g, b, value]) => ({ r, g, b, value }))) : null;
  const px = pixelsOf(await loadImage(rec.image));
  const f = E.decode(px.data.data, W, H, scale, { mode: rec.mode, mask: rec.mask, tolerance: rec.tolerance, south: rec.south, north: rec.north });
  const grid = E.toGrid(f.values, f.valid, W, H);
  let lo = rec.lo, hi = rec.hi;
  if (rec.autoRange) { let mx = 0; for (const row of grid.mean) for (const v of row) if (isFinite(v) && v > mx) mx = v; lo = 0; hi = mx || 1; }
  // some frames are cleaned for reading; NASA's untouched frame is the one shown
  const canvas = rec.show ? pixelsOf(await loadImage(rec.show)).canvas : px.canvas;
  return { canvas, field: { ...f, w: W, h: H }, grid, levels: E.toLevels(grid, lo, hi, 0.08, rec.curve) };
}

async function loadRecord(top, opts = {}) {
  stop();
  const rec = viewOf(top);
  state.top = top;
  state.record = rec;
  setStatus('Reading the map', true);
  markRecordTabs();
  try {
    let img, scale = null, decodeOpts = {}, picture = null;
    if (rec.kind === 'live') {
      scale = await gibsScale(rec.colormap, `records/live/${rec.id}.xml`);
      decodeOpts = { emptyIsZero: rec.emptyIsZero, south: rec.south, north: rec.north };
      // NASA answers with an empty picture for a day it has not published yet.
      // An empty picture must never be read as "nothing there", so step back
      // a day at a time until a picture with data arrives.
      let date = state.date, note = '';
      for (let tries = 0; ; tries++) {
        try { img = await fetchBitmap(gibsUrl(rec.layer, date)); }
        catch { img = null; }
        if (img && E.decode(pixelsOf(img).data.data, W, H, scale, {}).matchedShare > 0.002) {
          state.source = `${niceDate(date)}, fetched from NASA just now${note}`;
          break;
        }
        if (!img || tries >= 4) {
          const reached = !!img;
          img = await loadImage(`records/live/${rec.id}.png`);
          date = SAVED_DAY;
          state.source = `${niceDate(SAVED_DAY)}, saved copy (NASA’s map service ${reached ? 'had no picture for the days near the one you chose' : 'could not be reached'})`;
          break;
        }
        note = `. NASA has not published ${niceDate(state.date)} for this record, so this is the newest day before it`;
        date = shiftDay(date, -1);
      }
      state.shownDate = date;
    } else if (rec.kind === 'picture') {
      picture = await readPicture(rec);
      state.source = rec.date + ', NASA Earth Information Center';
    } else {
      img = rec.bitmap; scale = rec.scale; decodeOpts = { mode: rec.mode, tolerance: 60 };
      state.source = 'your own file, read in this browser and sent nowhere';
    }
    if (!state.coast) {
      state.coast = await fetchBitmap(gibsUrl('Coastlines_15m', '2026-11-13')).catch(() => loadImage('records/live/coast.png')).catch(() => null);
    }
    await new Promise((r) => setTimeout(r, 30)); // let the status paint
    if (rec.kind === 'points') {
      state.image = null;
      state.field = null;
      state.grid = rec.grid;
    } else if (picture) {
      state.image = picture.canvas;
      state.field = picture.field;
      state.grid = picture.grid;
    } else {
      const px = pixelsOf(img);
      state.image = px.canvas;
      const f = E.decode(px.data.data, W, H, scale, decodeOpts);
      state.field = { ...f, w: W, h: H };
      state.grid = E.toGrid(f.values, f.valid, W, H);
    }
    let lo = rec.lo, hi = rec.hi;
    if (rec.autoRange) {
      let mx = 0;
      for (const row of state.grid.mean) for (const v of row) if (isFinite(v) && v > mx) mx = v;
      lo = 0; hi = mx || 1;
    }
    state.levels = E.toLevels(state.grid, lo, hi, rec.kind === 'points' ? 0 : 0.08, rec.curve);
    buildAudio();
    const f0 = E.facts(state.levels, state.grid);
    state.brief = E.brief(state.levels, {
      noun: rec.noun, unit: rec.unit, noValue: rec.mode === 'spark' || !!rec.noValue, grid: state.grid, words: rec.words,
      assumedZero: !!rec.emptyIsZero && rec.kind === 'live', placeName: regionAt, oceanCaveat: rec.oceanCaveat,
      peakLat: state.field && f0.peak.level >= 0 ? E.peakLat(state.field.values, state.field.valid, W, H, f0.peak.band, f0.peak.col, state.grid.cols) : undefined,
    });
    state.place = null; state.cursor = null;
    paintRecord();
    setStatus('', false);
    $('#area-play').disabled = !state.field;
    if (area.box) { area.box = null; $('#area-text').textContent = ''; drawArea(); }
    if (opts.keepChange !== true) $('#rec-change').textContent = '';
    if (opts.announce) say(`${rec.title}. ${state.brief.sentences[0]}`);
  } catch (err) {
    setStatus('', false);
    $('#rec-source').textContent = 'This record could not be loaded: ' + err.message + '. Check the connection and choose it again.';
  }
}

// The master volume is fixed for each record, so that two days of one record
// can be compared by ear. A record with no fixed volume gets one from the first
// map played, with a quarter of headroom.
function buildAudio() {
  const rec = state.record;
  state.sound = state.simple ? E.simplify(state.levels) : state.levels;
  const key = rec.id + (state.simple ? '-4' : '');
  const opts = { seconds: state.seconds, timbre: timbreOf(rec), rhythm: rec.rhythm };
  let gain = state.gains[key] ?? (state.simple ? undefined : rec.gain);
  if (!gain) gain = E.sonify(state.sound, opts).gain * 0.75;
  state.gains[key] = gain;
  state.audio = E.sonify(state.sound, { ...opts, gain });
  const heard = E.listenBack(state.audio, state.sound.cols);
  state.proof = { ...E.compare(state.sound, heard), heard };
  // One band at a time: the far south first, then each band northwards, each on its own.
  state.played = state.solo
    ? E.joinAudio(state.sound.level.map((_, k) => E.sonify(E.onlyBand(state.sound, k), { ...opts, seconds: Math.max(4, state.seconds / 2), gain })))
    : state.audio;
}

function setStatus(text, busy) {
  for (const el of $$('[data-status]')) { el.textContent = text; el.hidden = !text; }
  for (const b of $$('[data-play]')) b.disabled = busy;
}

// ------------------------------------------------------------ painting text
function fmt(v) { return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2); }

function paintRecord() {
  const rec = state.record, p = state.proof, f = state.field;
  $('#rec-title').textContent = rec.title;
  $('#rec-about').textContent = rec.about;
  $('#rec-source').textContent = `${state.source}. Source: ${rec.source}.`;
  $('#hero-line').textContent = `${rec.title}, ${state.source.split(',')[0]}`;
  $('#hero-brief').textContent = state.brief.sentences.slice(0, 2).join(' ');
  $('#brief-text').textContent = state.brief.text;
  $('#rec-limits').replaceChildren(...rec.limits.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  $('#date').disabled = rec.kind !== 'live';
  $('#date-note').textContent = rec.kind === 'live' ? 'Any day NASA has published.' : 'This record has moments, not days.';
  const top = state.top, many = !!(top && top.parts && top.parts.length > 1);
  $('#frame-ctl').hidden = !many; $('#play-time').hidden = !many;
  $('#play-change').hidden = !(many && top.trend === 'growth');
  if (many) {
    $('#frame-ctl label').textContent = top.partsAre === 'layers' ? 'Layer' : 'Moment';
    const sel = $('#frame');
    if (sel.dataset.for !== top.id) {
      sel.dataset.for = top.id;
      sel.replaceChildren(...top.parts.map((pt, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: pt.label })));
    }
    sel.value = String(top.part || 0);
    $('#play-time').dataset.label = top.partsAre === 'layers' ? `Play all ${top.parts.length} layers` : `Play all ${top.parts.length} in order`;
    if (!state.playing) $('#play-time').textContent = $('#play-time').dataset.label;
  }
  const credit = $('#rec-credit');
  credit.replaceChildren();
  if (rec.credits) credit.append(rec.credits + ' ');
  if (rec.page) credit.append(Object.assign(document.createElement('a'), { href: rec.page, textContent: `NASA's page for this visualization (SVS ${rec.svs})` }));
  // the same layer and day in NASA Worldview, NASA's own map viewer
  if (rec.kind === 'live') credit.append(Object.assign(document.createElement('a'), { href: `https://worldview.earthdata.nasa.gov/?l=${rec.layer},Coastlines_15m&t=${state.shownDate || state.date}`, textContent: 'Open this map in NASA Worldview' }));
  $('#proof-r').textContent = isFinite(p.r) ? p.r.toFixed(4) : 'n/a';
  $('#proof-err').textContent = isFinite(p.meanError) ? (p.meanError * 100).toFixed(2) + ' percent' : 'n/a';
  $('#proof-cells').textContent = `${p.cells} of ${state.sound.level.length * state.grid.cols}`;
  const au = state.audio, inst = { choir: 'a soft choir', glass: 'a glass-like tone', reed: 'a hollow reed', string: 'bright strings', brass: 'warm brass', flute: 'an airy flute' }[au.timbre];
  $('#rec-sound').textContent = `You will hear ${au.voices === 4 ? 'four' : 'eight'} voices${state.solo ? ', one band at a time from the far south to the far north,' : ''} played as ${inst}${au.rhythm === 'crackle' ? ', with a crackle that speeds up where lightning clusters' : au.rhythm === 'patter' ? ', with a patter that speeds up where it is wet' : ''}. A soft hiss means no data.${au.turnedDownDb > 0.5 ? ` This map is louder than usual for this record, so it was turned down by ${au.turnedDownDb.toFixed(0)} decibels.` : ''}`;
  $('#rec-describe').textContent = rec.describe || '';
  $('#rec-describe-wrap').hidden = !rec.describe;
  $('#proof-exact').textContent = !f ? 'not applicable: you supplied numbers' : rec.kind === 'live' ? (f.exactShare * 100).toFixed(1) + ' percent matched NASA’s colour table exactly' : 'estimated from the picture’s legend, nearest colour';
  $('#proof-line').textContent = isFinite(p.r)
    ? `For "${rec.title}", a second program was given only the sound. It rebuilt ${p.cells} map cells, and its picture matches the original ${p.r.toFixed(4)} out of 1.`
    : 'There is too little data on this map to run the check.';
  $('#debate-text').replaceChildren();
  $('#answer').textContent = '';
  $('#place-result').textContent = 'Move over the map, or type a place, to hear one spot.';
  $('#how-img').src = state.image ? state.image.toDataURL('image/png') : '';
  drawAll();
}

function markRecordTabs() {
  for (const b of $$('#record-tabs button')) b.setAttribute('aria-pressed', String(b.dataset.id === state.top.id));
}

// ------------------------------------------------------------ drawing
function fitCanvas(c) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth * dpr)), h = Math.max(10, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c.getContext('2d');
}

function drawMap(c) {
  if (!c || !c.clientWidth) return;
  const x = fitCanvas(c), w = c.width, h = c.height;
  x.fillStyle = css('--map-sea'); x.fillRect(0, 0, w, h);
  // eight bands as quiet steps of tone: the lines of the score
  for (let b = 0; b < E.BANDS; b++) if (b % 2) { x.fillStyle = css('--map-band'); x.fillRect(0, h - ((b + 1) / E.BANDS) * h, w, h / E.BANDS); }
  if (state.image) x.drawImage(state.image, 0, 0, w, h);
  else if (state.levels) drawCells(x, 0, 0, w, h, state.levels.level, state.levels.known);
  if (state.coast && state.record.kind !== 'picture') { x.globalAlpha = 0.55; x.drawImage(state.coast, 0, 0, w, h); x.globalAlpha = 1; }
  if (state.playing) { x.fillStyle = css('--accent'); x.fillRect(state.progress * w - 2, 0, 4, h); }
  for (const [p, colour] of [[state.place, css('--accent')], [state.cursor, css('--map-cursor')]]) {
    if (!p) continue;
    const px = ((p.lon + 180) / 360) * w, py = ((90 - p.lat) / 180) * h;
    x.fillStyle = css('--map-ring'); x.beginPath(); x.arc(px, py, 11, 0, 7); x.fill();
    x.fillStyle = colour; x.beginPath(); x.arc(px, py, 7, 0, 7); x.fill();
  }
}

function tone(level, known) {
  if (!known) return css('--cell-none');
  const a = hex(css('--cell-lo')), z = hex(css('--cell-hi')), t = Math.pow(level, 0.6);
  return `rgb(${a.map((v, i) => Math.round(v + (z[i] - v) * t)).join(',')})`;
}
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));

function drawCells(x, ox, oy, w, h, level, known) {
  const cols = level[0].length, rows = level.length, cw = w / cols, ch = h / rows;
  for (let b = 0; b < rows; b++) for (let c = 0; c < cols; c++) {
    x.fillStyle = tone(level[b][c], known ? known[b][c] : 1);
    x.fillRect(ox + c * cw, oy + h - (b + 1) * ch, Math.ceil(cw), Math.ceil(ch));
  }
}
function drawStrip(c, level, known) {
  if (!c || !c.clientWidth || !level) return;
  const x = fitCanvas(c);
  drawCells(x, 0, 0, c.width, c.height, level, known);
}

// The record: eight bands as eight grooves, Antarctic at the centre, Arctic at the rim.
function drawDisc(c) {
  if (!c || !c.clientWidth || !state.levels) return;
  const x = fitCanvas(c), s = Math.min(c.width, c.height), cx = c.width / 2, cy = c.height / 2;
  x.clearRect(0, 0, c.width, c.height);
  const R = s * 0.49, r0 = s * 0.13, step = (R - r0) / E.BANDS, cols = state.levels.cols;
  x.fillStyle = css('--disc'); x.beginPath(); x.arc(cx, cy, R, 0, 7); x.fill();
  for (let b = 0; b < E.BANDS; b++) {
    for (let col = 0; col < cols; col++) {
      const a0 = (col / cols) * Math.PI * 2 - Math.PI / 2, a1 = ((col + 1) / cols) * Math.PI * 2 - Math.PI / 2 + 0.004;
      x.fillStyle = tone(state.levels.level[b][col], state.levels.known[b][col]);
      x.beginPath(); x.arc(cx, cy, r0 + (b + 1) * step - s * 0.004, a0, a1); x.arc(cx, cy, r0 + b * step + s * 0.004, a1, a0, true); x.closePath(); x.fill();
    }
  }
  x.fillStyle = css('--accent'); x.beginPath(); x.arc(cx, cy, r0 * 0.78, 0, 7); x.fill();
  x.fillStyle = css('--disc'); x.beginPath(); x.arc(cx, cy, r0 * 0.14, 0, 7); x.fill();
  const a = state.progress * Math.PI * 2 - Math.PI / 2;
  x.strokeStyle = css('--needle'); x.lineWidth = Math.max(3, s * 0.008); x.lineCap = 'round';
  x.beginPath(); x.moveTo(cx + Math.cos(a) * r0 * 0.9, cy + Math.sin(a) * r0 * 0.9); x.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.stroke();
}

// Eight bars for eight voices: height is pitch, so the picture reads like the sound.
let lit = -1;
function drawVoices(c) {
  if (!c || !c.clientWidth) return;
  const x = fitCanvas(c), w = c.width, h = c.height, gap = w * 0.02, bw = (w - gap * 9) / 8;
  x.fillStyle = css('--disc'); x.fillRect(0, 0, w, h);
  const top = Math.log(E.VOICE_HZ[7] / 80), base = h * 0.92;
  for (let b = 0; b < E.BANDS; b++) {
    const bh = (Math.log(E.VOICE_HZ[b] / 80) / top) * h * 0.84;
    x.fillStyle = b === lit ? css('--accent') : tone(0.25 + (b / 7) * 0.75, 1);
    x.fillRect(gap + b * (bw + gap), base - bh, bw, bh);
  }
}
$('#scale-demo').addEventListener('click', () => {
  stop(); speechSynthesis.cancel();
  const ac = audioCtx(), t0 = ac.currentTime + 0.05;
  E.VOICE_HZ.forEach((f, b) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = t0 + b * 0.42;
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.03); g.gain.setTargetAtTime(0, t + 0.3, 0.05);
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.6);
    setTimeout(() => { lit = b; drawVoices($('#how-voices')); }, (t - ac.currentTime) * 1000);
  });
  setTimeout(() => { lit = -1; drawVoices($('#how-voices')); }, 8 * 420 + 300);
});

function drawAll() {
  drawVoices($('#how-voices'));
  if (!state.levels) return;
  for (const c of $$('canvas[data-map]')) drawMap(c);
  drawDisc($('#disc'));
  drawStrip($('#how-grid'), state.levels.level, state.levels.known);
  drawStrip($('#proof-in'), state.sound.level, state.sound.known);
  drawStrip($('#proof-out'), state.proof.heard.level, null);
}
addEventListener('resize', drawAll);

// ------------------------------------------------------------ sound
let ctx = null, node = null, startedAt = 0, raf = 0, probe = null, seq = null;
function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function play() {
  if (!state.audio) return;
  stop();
  speechSynthesis.cancel();
  const ac = audioCtx(), a = state.played || state.audio;
  const buf = ac.createBuffer(2, a.left.length, a.sampleRate);
  buf.copyToChannel(a.left, 0); buf.copyToChannel(a.right, 1);
  node = ac.createBufferSource(); node.buffer = buf; node.connect(ac.destination);
  node.onended = () => { if (state.playing) stop(); if (tour && tour.next) tour.next(); };
  startedAt = ac.currentTime + 0.05; node.start(startedAt);
  state.playing = true; setPlayLabels(); vibrateSweep();
  const tick = () => {
    if (!state.playing) return;
    const now = ac.currentTime - startedAt;
    const part = a.parts ? [...a.parts].reverse().find((p) => now >= p.start) || a.parts[0] : { start: 0, lead: a.lead, sweep: a.sweep };
    state.progress = Math.min(1, Math.max(0, (now - part.start - part.lead) / part.sweep));
    for (const c of $$('canvas[data-map]')) drawMap(c);
    drawDisc($('#disc'));
    raf = requestAnimationFrame(tick);
  };
  tick();
}
function stop() {
  if (node) { node.onended = null; try { node.stop(); } catch { /* already stopped */ } node = null; }
  if (seq) { for (const n of seq.nodes) { n.onended = null; try { n.stop(); } catch { /* already stopped */ } } clearTimeout(seq.timer); seq = null; $('#play-time').textContent = $('#play-time').dataset.label || 'Play it through time'; }
  if (area.node) { area.node.onended = null; try { area.node.stop(); } catch { /* already stopped */ } area.node = null; area.progress = -1; drawArea(); $('#area-play').textContent = `Hear the area around ${area.place ? area.place.name : 'Charlotte'}`; if (area.text) $('#area-text').textContent = area.text; }
  cancelAnimationFrame(raf);
  if (state.haptic && navigator.vibrate) navigator.vibrate(0);
  if (state.playing) { state.playing = false; state.progress = 0; setPlayLabels(); drawAll(); }
  if (state.afterPlay) { const f = state.afterPlay; state.afterPlay = null; f(); }
}
function setPlayLabels() {
  for (const b of $$('[data-play]')) {
    b.removeAttribute('aria-pressed'); // the name changes between Play and Stop, which says it all
    $('.label', b).textContent = state.playing ? 'Stop' : b.dataset.play;
  }
}
for (const b of $$('[data-play]')) b.addEventListener('click', () => { endTour(); state.playing ? stop() : play(); });

// Play the whole jukebox: every record in turn, round and round, until stopped.
// Made for a speaker beside a screen, such as a kiosk next to the Earth Information Center wall.
let tour = null;
function endTour() {
  if (!tour) return;
  const t = tour; tour = null;
  if (t.next) t.next();
  $('#play-all').textContent = 'Play the whole jukebox';
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function speakAndWait(text) {
  if (!state.voice || !('speechSynthesis' in window)) return pause(400);
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    u.onend = done; u.onerror = done;
    setTimeout(done, 6000);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}
async function playTour() {
  if (tour) { endTour(); stop(); return; }
  audioCtx();
  const mine = tour = { next: null };
  $('#play-all').textContent = 'Stop the jukebox';
  let i = Math.max(0, CATALOGUE.indexOf(state.top));
  while (tour === mine) {
    await loadRecord(CATALOGUE[i], { announce: false });
    if (tour !== mine) break;
    $('#rec-change').textContent = `Record ${i + 1} of ${CATALOGUE.length}: ${state.record.title}. ${state.brief.sentences[0]}`;
    await speakAndWait(state.record.title);
    if (tour !== mine) break;
    play();
    await new Promise((r) => { mine.next = r; });
    mine.next = null;
    if (tour !== mine) break;
    await pause(900);
    i = (i + 1) % CATALOGUE.length;
  }
}
$('#play-all').addEventListener('click', playTour);

// Play every part of a record in order: twelve years of night lights, a year of
// lightning, or the four kinds of aerosol in turn. All parts share one volume,
// so a part that sounds fuller really does hold more.
async function playThrough() {
  const top = state.top;
  if (!top || !top.parts || top.parts.length < 2) return;
  stop(); audioCtx();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setStatus('Getting every part ready', true);
  const items = [];
  try {
    for (let i = 0; i < top.parts.length; i++) {
      const rec = viewOf(top, i), read = await readPicture(rec);
      const lv = state.simple ? E.simplify(read.levels) : read.levels;
      items.push({ rec, read, label: top.parts[i].label, audio: E.sonify(lv, { seconds: 4, timbre: timbreOf(rec), rhythm: rec.rhythm, normalize: false, ticks: false }) });
      await new Promise((r) => setTimeout(r, 0));
    }
  } catch (err) { setStatus('', false); $('#rec-change').textContent = 'The parts could not be loaded: ' + err.message + '.'; return; }
  const peak = Math.max(...items.map((it) => it.audio.peak)) || 1;
  for (const it of items) E.scaleAudio(it.audio, 0.85 / peak);
  setStatus('', false);
  const ac = audioCtx();
  let t = ac.currentTime + 0.15;
  seq = { nodes: [], timer: 0 };
  for (const it of items) {
    const a = it.audio, buf = ac.createBuffer(2, a.left.length, a.sampleRate);
    buf.copyToChannel(a.left, 0); buf.copyToChannel(a.right, 1);
    const n = ac.createBufferSource(); n.buffer = buf; n.connect(ac.destination); n.start(t);
    it.at = t; t += a.seconds + 0.2; seq.nodes.push(n);
  }
  const end = t, mine = seq;
  state.playing = true; setPlayLabels(); $('#play-time').textContent = 'Stop';
  const line = top.partsAre === 'layers' ? `${items.length} layers, about four seconds each: ${items.map((it) => it.label).join(', ')}. Each begins with a short beep.` : `${items.length} moments, about four seconds each, from ${items[0].label} to ${items[items.length - 1].label}. Each begins with a short beep.`;
  $('#rec-change').textContent = line;
  let shown = -1;
  const tick = () => {
    if (seq !== mine) return;
    const now = ac.currentTime;
    let i = items.findIndex((it, k) => now < (items[k + 1] ? items[k + 1].at : end));
    if (i < 0) i = items.length - 1;
    const it = items[i];
    if (i !== shown) { shown = i; state.image = it.read.canvas; state.levels = it.read.levels; $('#frame').value = String(i); $('#hero-line').textContent = `${it.rec.title}, ${it.label}`; }
    state.progress = Math.min(1, Math.max(0, (now - it.at - it.audio.lead) / it.audio.sweep));
    for (const c of $$('canvas[data-map]')) drawMap(c);
    drawDisc($('#disc'));
    raf = requestAnimationFrame(tick);
  };
  tick();
  seq.timer = setTimeout(async () => {
    if (seq !== mine) return;
    const text = changeSentence(top, items);
    stop();
    await loadRecord(top, { keepChange: true });
    $('#rec-change').textContent = text;
    say(text);
  }, (end - ac.currentTime) * 1000 + 200);
}
// One or two plain sentences on what changed across the parts, worked out from the numbers.
function changeSentence(top, items) {
  const first = items[0], last = items[items.length - 1];
  const facts = items.map((it) => E.facts(it.read.levels, it.read.grid));
  if (top.partsAre === 'layers') {
    const order = items.map((it, i) => [it.label, facts[i].mean]).sort((a, b) => b[1] - a[1]);
    return `Of the ${items.length} layers, ${order[0][0]} covers the most of the map in this picture and ${order[order.length - 1][0]} the least.`;
  }
  if (top.trend === 'growth') {
    let up = null, down = null;
    const A = first.read.levels, Z = last.read.levels;
    for (let b = 0; b < E.BANDS; b++) for (let c = 0; c < A.cols; c++) {
      if (!A.known[b][c] || !Z.known[b][c]) continue;
      const d = Z.level[b][c] - A.level[b][c], lat = E.BAND_EDGES[b] + 11.25, lon = -180 + ((c + 0.5) / A.cols) * 360;
      if (!up || d > up.d) up = { d, b, c, lat, lon };
      if (!down || d < down.d) down = { d, b, c, lat, lon };
    }
    const name = (cell, read) => regionAt(E.peakLat(read.field.values, read.field.valid, W, H, cell.b, cell.c, A.cols), cell.lon);
    const rose = facts[facts.length - 1].mean >= facts[0].mean;
    let text = `From ${first.label} to ${last.label}, ${top.noun} ${rose ? 'rose' : 'fell'} across the map as a whole.`;
    if (rose && up && up.d > 0.03) text += ` The largest rise was over ${name(up, last.read)}.`;
    if (!rose && down && down.d < -0.03) text += ` The largest fall was over ${name(down, first.read)}.`;
    return text;
  }
  // a seasonal cycle: when was each half of the planet at its strongest
  const share = facts.map((f) => (isFinite(f.north) && isFinite(f.south) && f.north + f.south > 0 ? f.north / (f.north + f.south) : 0.5));
  const n = share.indexOf(Math.max(...share)), s2 = share.indexOf(Math.min(...share));
  return `Across these ${items.length} moments, the northern half of the planet was strongest in ${items[n].label} and the southern half in ${items[s2].label}.`;
}
$('#play-time').addEventListener('click', () => (state.playing ? stop() : playThrough()));

// Hear only what changed: the rise from the first moment to the last, as one sweep.
// A change too small to hear between two separate sweeps becomes the loudest thing here.
$('#play-change').addEventListener('click', async () => {
  if (state.playing) { stop(); return; }
  const top = state.top, rec = state.record;
  if (!top.parts || top.parts.length < 2) return;
  endTour(); stop();
  setStatus('Comparing the first and last moments', true);
  let first, last;
  try { [first, last] = await Promise.all([readPicture(viewOf(top, 0)), readPicture(viewOf(top, top.parts.length - 1))]); }
  catch (err) { setStatus('', false); $('#rec-change').textContent = 'The moments could not be loaded: ' + err.message + '.'; return; }
  setStatus('', false);
  const change = E.changeLevels(first.levels, last.levels);
  const keep = { audio: state.audio, played: state.played, image: state.image };
  state.audio = state.played = E.sonify(state.simple ? E.simplify(change) : change, { seconds: state.seconds, timbre: timbreOf(rec) });
  state.image = last.canvas;
  const sentence = changeSentence(top, [{ label: top.parts[0].label, read: first }, { label: top.parts[top.parts.length - 1].label, read: last }]);
  const text = `${sentence} In this sound, only the rise plays: the louder a voice, the more ${top.noun} grew there between ${top.parts[0].label} and ${top.parts[top.parts.length - 1].label}. A rise of a third of the scale or more plays at full strength, so a small change sounds quiet.`;
  $('#rec-change').textContent = `Playing only what changed between ${top.parts[0].label} and ${top.parts[top.parts.length - 1].label}.`;
  play(); // play() stops whatever was playing first, so the clean-up is set only after it starts
  $('#play-change').textContent = 'Stop';
  state.afterPlay = () => {
    Object.assign(state, keep);
    $('#play-change').textContent = 'Hear only what changed';
    drawAll();
    announce($('#rec-change'), text);
    say(text);
  };
});

// ------------------------------------------------------------ the area around one place
// A sound map of the area around the chosen place, cut from the same NASA picture,
// with a chime where the place is, and a sentence on how far away and which way the most is.
const area = { place: null, node: null, progress: -1, box: null, text: '' };
function setAreaPlace(p) {
  area.place = p;
  $('#area-play').textContent = `Hear the area around ${p.name}`;
  $('#area-feed').href = 'api/v1/feed.xml?place=' + encodeURIComponent(p.query);
  if (area.box) { area.box = null; area.text = ''; $('#area-text').textContent = ''; drawArea(); }
}
function drawArea() {
  const c = $('#area-map');
  if (!c || !c.clientWidth) return;
  const x = fitCanvas(c), w = c.width, h = c.height, box = area.box;
  x.fillStyle = css('--map-sea'); x.fillRect(0, 0, w, h);
  if (!box || !state.image) return;
  // draw a crop of a whole-world picture, wrapping across the date line
  const crop = (img) => {
    const iw = img.width, ih = img.height;
    const sy = ((90 - box.north) / 180) * ih, sh = ((box.north - box.south) / 180) * ih, sw = ((box.east - box.west) / 360) * iw;
    const sx = ((box.west + 180) / 360) * iw;
    for (const shift of [-iw, 0, iw]) {
      const a0 = Math.max(0, sx + shift), a1 = Math.min(iw, sx + shift + sw);
      if (a1 <= a0) continue;
      x.drawImage(img, a0, sy, a1 - a0, sh, ((a0 - (sx + shift)) / sw) * w, 0, ((a1 - a0) / sw) * w, h);
    }
  };
  x.imageSmoothingEnabled = true;
  crop(state.image);
  if (state.coast && state.record.kind !== 'picture') { x.globalAlpha = 0.7; crop(state.coast); x.globalAlpha = 1; }
  if (area.progress >= 0) { x.fillStyle = css('--accent'); x.fillRect(area.progress * w - 2, 0, 4, h); }
  const py = ((box.north - box.lat) / (box.north - box.south)) * h;
  const r = Math.max(9, h * 0.035);
  x.fillStyle = '#ffffff'; x.beginPath(); x.arc(w / 2, py, r, 0, 7); x.fill();
  x.fillStyle = '#141413'; x.beginPath(); x.arc(w / 2, py, r * 0.7, 0, 7); x.fill();
  x.fillStyle = '#ed4b44'; x.beginPath(); x.arc(w / 2, py, r * 0.45, 0, 7); x.fill();
  x.font = `600 ${Math.round(h * 0.06)}px Outfit, system-ui, sans-serif`; x.fillStyle = '#ffffff';
  x.fillText('N', w / 2 - h * 0.02, h * 0.08); x.fillText('W', h * 0.02, h / 2); x.fillText('E', w - h * 0.07, h / 2);
}
addEventListener('resize', drawArea);
function areaNow() {
  const rec = state.record, p = area.place;
  const box = E.areaBox(p.lat, p.lon);
  const grid = E.areaGrid(state.field.values, state.field.valid, W, H, box);
  const levels = E.toLevels(grid, state.levels.lo, state.levels.hi, 0.08, state.levels.curve);
  const near = E.nearby(levels, grid, { name: p.name, noun: rec.noun, unit: rec.unit, words: rec.words, most: rec.most, plural: rec.plural, noValue: rec.mode === 'spark' || !!rec.noValue, placeName: regionAt });
  return { box, grid, levels, near, here: placeSentence(p.name, readPlace(p.lat, p.lon)) };
}
$('#area-play').addEventListener('click', () => {
  if (area.node) { stop(); return; }
  endTour(); stop();
  if (!area.place) setAreaPlace({ ...findCity('Charlotte'), query: 'Charlotte' });
  const out = $('#area-text');
  if (!state.field) { out.textContent = 'This record has no picture to cut an area from. Choose a NASA record above.'; return; }
  const a = areaNow(), rec = state.record, p = area.place;
  area.box = a.box;
  const sound = state.simple ? E.simplify(a.levels) : a.levels;
  const key = rec.id + (state.simple ? '-4' : '');
  const audio = E.sonify(sound, { seconds: state.seconds, timbre: timbreOf(rec), rhythm: rec.rhythm, gain: state.gains[key], marker: { at: 0.5 } });
  const text = `${a.here} ${a.near.text}`;
  area.text = text;
  out.textContent = `Playing ${rec.title.toLowerCase()} in the area around ${p.name}. The chime is ${p.name}.`;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const ac = audioCtx(), buf = ac.createBuffer(2, audio.left.length, audio.sampleRate);
  buf.copyToChannel(audio.left, 0); buf.copyToChannel(audio.right, 1);
  const n = ac.createBufferSource(); n.buffer = buf; n.connect(ac.destination);
  const t0 = ac.currentTime + 0.05;
  n.onended = () => { area.node = null; area.progress = -1; drawArea(); $('#area-play').textContent = `Hear the area around ${p.name}`; announce(out, text); say(text); };
  n.start(t0); area.node = n;
  $('#area-play').textContent = 'Stop';
  const tick = () => {
    if (area.node !== n) return;
    area.progress = Math.min(1, Math.max(0, (ac.currentTime - t0 - audio.lead) / audio.sweep));
    drawArea();
    requestAnimationFrame(tick);
  };
  tick();
});

// one steady note while a finger or pointer explores the map
function probeTone(level) {
  if (!ctx) return;
  if (!probe) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; g.gain.value = 0; o.connect(g); g.connect(ctx.destination); o.start();
    probe = { o, g };
  }
  const t = ctx.currentTime;
  probe.g.gain.cancelScheduledValues(t);
  if (level === null) { probe.g.gain.setTargetAtTime(0, t, 0.04); return; }
  probe.o.frequency.setTargetAtTime(180 * Math.pow(5, level), t, 0.03);
  probe.g.gain.setTargetAtTime(0.16, t, 0.03);
  probe.g.gain.setTargetAtTime(0, t + 0.5, 0.15);
}

// ------------------------------------------------------------ speech
function say(text, opts = {}) {
  if ((!state.voice && !opts.force) || !('speechSynthesis' in window)) return;
  if (!opts.queue) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1; u.pitch = opts.pitch ?? 1;
  if (opts.voice) u.voice = opts.voice;
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------ one place
function readPlace(lat, lon) {
  const rec = state.record, lv = state.levels;
  let value = NaN;
  if (state.field) value = E.valueAt(state.field.values, state.field.valid, W, H, lat, lon).value;
  else {
    const b = Math.min(E.BANDS - 1, Math.max(0, Math.floor((lat + 90) / 22.5)));
    const c = Math.min(lv.cols - 1, Math.max(0, Math.floor(((lon + 180) / 360) * lv.cols)));
    if (lv.known[b][c]) value = state.grid.mean[b][c];
  }
  const level = isFinite(value) ? E.valueToLevel(value, lv.lo, lv.hi, lv.curve) : null;
  return { lat, lon, value, level };
}
function placeSentence(name, r) {
  if (state.record.kind === 'points' && r.level !== null) {
    const rows = state.levels.level.length, cols = state.levels.cols;
    return `The patch of this map that contains ${name} averages ${fmt(r.value)}${state.record.unit ? ' ' + state.record.unit : ''}. Each patch is ${(180 / rows).toFixed(1)} degrees of latitude by ${(360 / cols).toFixed(0)} of longitude, so this is not a reading at ${name} itself.`;
  }
  const rec = state.record;
  if (r.level === null) return `${name} has no reading on this map. A gap means this map has no data there.`;
  if (rec.mode === 'spark' || rec.noValue) return `Over ${name}, ${rec.noun} is ${E.wordFor(r.level)} on this map.`;
  const word = rec.words ? E.wordFromTable(rec.words, r.value) : E.wordFor(r.level) + ' on this record’s scale';
  return `Over ${name}, ${rec.noun} is ${fmt(r.value)} ${rec.unit}, which is ${word}.`;
}
function announce(el, text) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); }
function goPlace(lat, lon, name, speak) {
  const r = readPlace(lat, lon);
  state.place = { lat, lon, name };
  setAreaPlace({ lat, lon, name: name.replace(/^your location near /, ''), query: findCity(name) ? name : `${lat.toFixed(2)}, ${lon.toFixed(2)}` });
  const text = placeSentence(name, r);
  announce($('#place-result'), text);
  drawAll();
  if (speak) say(text);
  return text;
}
$('#place-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = $('#place').value.trim();
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) return goPlace(+m[1], +m[2], coordWords(+m[1], +m[2]), true);
  const c = findCity(q);
  if (c) return goPlace(c.lat, c.lon, c.name, true);
  const text = `I do not know "${q}" yet. Try a large city such as Charlotte, Delhi or Lagos, or type a latitude and longitude such as 35.2, -80.8.`;
  $('#place-result').textContent = text; say(text);
});
$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) { $('#place-result').textContent = 'This browser cannot share a location. Type a city instead.'; return; }
  $('#place-result').textContent = 'Asking your browser for your location';
  navigator.geolocation.getCurrentPosition(
    (p) => { const { latitude: la, longitude: lo } = p.coords; const c = nearestCity(la, lo, 1.5); goPlace(la, lo, c ? 'your location near ' + c.name : 'your location', true); },
    () => { $('#place-result').textContent = 'Location was not shared. Type a city instead.'; },
    { maximumAge: 600000, timeout: 8000 },
  );
});

// pointer and keyboard exploring on every map
let lastSpoken = 0;
function exploreAt(lat, lon, speak, sound = true) {
  lat = Math.max(-89, Math.min(89, lat)); lon = ((lon + 540) % 360) - 180;
  state.cursor = { lat, lon };
  const r = readPlace(lat, lon);
  const c = nearestCity(lat, lon, 2.5);
  const where = c ? `near ${c.name}` : regionAt(lat, lon);
  const text = placeSentence(where, r);
  if (speak) announce($('#place-result'), text); else $('#place-result').textContent = text;
  if (ctx && sound !== false) probeTone(r.level);
  if (sound === 'touch' && state.haptic && navigator.vibrate && r.level !== null) navigator.vibrate(Math.round(6 + r.level * 34));
  for (const m of $$('canvas[data-map]')) drawMap(m);
  if (speak && Date.now() - lastSpoken > 300) { lastSpoken = Date.now(); say(text); }
}
for (const c of $$('canvas[data-map]')) {
  const at = (ev) => { const b = c.getBoundingClientRect(); return [90 - ((ev.clientY - b.top) / b.height) * 180, ((ev.clientX - b.left) / b.width) * 360 - 180]; };
  const kind = (ev) => (ev.pointerType === 'mouse' ? true : 'touch');
  c.addEventListener('pointerdown', (ev) => { audioCtx(); try { c.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ } exploreAt(...at(ev), false, kind(ev)); });
  // a mouse that only hovers updates the text and makes no sound; press and drag to hear the tone
  c.addEventListener('pointermove', (ev) => { if (ev.buttons) exploreAt(...at(ev), false, kind(ev)); else if (ev.pointerType === 'mouse') exploreAt(...at(ev), false, false); });
  c.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') exploreAt(...at(ev), true); });
  c.addEventListener('dblclick', (ev) => exploreAt(...at(ev), true));
  c.addEventListener('pointerleave', () => { if (ctx) probeTone(null); });
  c.addEventListener('keydown', (ev) => {
    const cur = state.cursor || state.place || { lat: 35.2, lon: -80.8 };
    const step = ev.shiftKey ? 1 : 5;
    const move = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] }[ev.key];
    if (move) { ev.preventDefault(); audioCtx(); exploreAt(cur.lat + move[0], cur.lon + move[1], false); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); audioCtx(); exploreAt(cur.lat, cur.lon, true); }
  });
}

// ------------------------------------------------------------ ask
function answer(q) {
  const s = q.toLowerCase(), rec = state.record, f = state.brief.facts, lv = state.levels;
  if (/\b(play|listen|start)\b/.test(s)) { play(); return 'Playing the map.'; }
  if (/\b(stop|pause|quiet)\b/.test(s)) { stop(); return 'Stopped.'; }
  if (/\b(here|my (location|place|city|town|home)|where i (live|am))\b/.test(s)) { $('#locate').click(); return 'Checking your location.'; }
  const city = findCity(s);
  if (city) return goPlace(city.lat, city.lon, city.name, false);
  if (/(worst|highest|most|peak|strongest|heaviest|hottest|warmest)/.test(s)) return state.brief.sentences[2];
  if (/(best|lowest|least|clean|clear|coolest|coldest|driest)/.test(s)) {
    let lo = null;
    for (let b = 0; b < E.BANDS; b++) if (isFinite(f.bandMean[b]) && (lo === null || f.bandMean[b] < f.bandMean[lo])) lo = b;
    return lo === null ? 'This map has too little data to say.' : `The quietest voice is the ${E.BAND_NAMES[lo]}, where ${rec.noun} is ${E.wordFor(f.bandMean[lo])} on this record’s scale, on average.`;
  }
  if (/(right now|today|current|live|how old|what day|which day|when)/.test(s)) return `This is ${state.source}. It is not a forecast and it is not this minute.`;
  if (/(north|south|hemisphere|half)/.test(s)) {
    if (!isFinite(f.north) || !isFinite(f.south)) return 'One half of the planet has no data on this map.';
    const more = f.north > f.south ? 'northern' : 'southern', less = f.north > f.south ? 'southern' : 'northern';
    const ratio = Math.max(f.north, f.south) / Math.max(1e-6, Math.min(f.north, f.south));
    if (ratio < 1.1) return `The two halves of the planet are about level on this map. The ${more} half is ahead by less than a tenth.`;
    return `The ${more} half of the planet has more. On this record’s scale it averages ${ratio >= 2 ? 'more than twice' : 'about ' + ratio.toFixed(1) + ' times'} the ${less} half.`;
  }
  if (/(coverage|how much|has data|gap|missing|silent|hiss)/.test(s)) return rec.emptyIsZero && rec.kind === 'live' ? 'On this record a blank patch is counted as none, although it can also mean no estimate, so every cell has a value.' : `${Math.round(f.coverage * 100)} percent of the map has data. The hiss in the sound marks the gaps. They are not zero.`;
  if (/(look like|picture|describe the (map|picture)|what would i see)/.test(s) && rec.describe) return rec.describe;
  if (/(sure|trust|accura|proof|right|correct|reliab)/.test(s)) {
    const how = rec.kind === 'live' ? 'Every colour was matched exactly in NASA’s own colour table, so each number is the middle of the range NASA gives for that colour.' : rec.kind === 'picture' ? 'The numbers are estimates read from the colours of a picture.' : 'The numbers are the ones in your file.';
    return `${how} ${rec.limits[0]} The sound itself loses almost nothing: a second program rebuilt the map from the audio with a match of ${isFinite(state.proof.r) ? state.proof.r.toFixed(3) : 'unknown'}.`;
  }
  if (/(what is this|what am i|explain|about)/.test(s)) return rec.about;
  if (/(describe|summary|brief|overview|tell me)/.test(s)) return state.brief.text;
  return 'I can answer questions like: where is it worst, how is it in Delhi, which half has more, how much of the map has data, and how sure are you.';
}
$('#ask-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const q = $('#ask').value.trim();
  if (!q) return;
  const a = answer(q);
  $('#answer').textContent = a;
  if (!/^Playing/.test(a)) say(a);
});
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const mic = $('#mic');
  mic.hidden = false;
  mic.addEventListener('click', () => {
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false;
    mic.setAttribute('aria-pressed', 'true');
    r.onresult = (ev) => { $('#ask').value = ev.results[0][0].transcript; $('#ask-form').requestSubmit(); };
    r.onend = () => mic.setAttribute('aria-pressed', 'false');
    r.onerror = () => { $('#answer').textContent = 'The microphone did not pick anything up. Type the question instead.'; };
    r.start();
  });
}
$('#speak-brief').addEventListener('click', () => say(state.brief.text, { force: true }));

// ------------------------------------------------------------ two readings
function twoReadings() {
  const rec = state.record, f = state.brief.facts, p = state.proof;
  const pairs = [
    ['Reading', state.brief.sentences[2]],
    ['Caution', rec.limits[0]],
    ['Reading', state.brief.sentences[1] + (state.brief.sentences[3] ? ' ' + state.brief.sentences[3] : '')],
    ['Caution', rec.emptyIsZero ? rec.limits[1] : `${Math.round((1 - f.coverage) * 100)} percent of the map has no data on this record. ${rec.limits[1]}`],
    ['Reading', isFinite(p.r) ? `The sound is faithful. A program rebuilt the map from the audio alone with a match of ${p.r.toFixed(3)}.` : 'There is too little data to check the sound.'],
    ['Caution', 'That check covers the voices, not your ears. Take the listening check on this page to find out what you can pick out yourself. And this is information, not a health warning.'],
  ];
  return pairs;
}
$('#debate').addEventListener('click', () => {
  const pairs = twoReadings();
  const voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  $('#debate-text').replaceChildren(...pairs.map(([who, text]) => {
    const li = document.createElement('li');
    const b = document.createElement('strong'); b.textContent = who + ': ';
    li.append(b, text); li.dataset.who = who;
    return li;
  }));
  speechSynthesis.cancel();
  pairs.forEach(([who, text]) => say(text, { force: true, queue: true, pitch: who === 'Reading' ? 1.1 : 0.8, voice: voices.length > 1 ? voices[who === 'Reading' ? 0 : 1] : undefined }));
});

// ------------------------------------------------------------ records, date, speed
const tabFor = (r) => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.id = r.id; b.textContent = r.title; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => { endTour(); loadRecord(r, { announce: false }); });
  return b;
};
const tabLabel = (text) => Object.assign(document.createElement('span'), { className: 'tabs-label', textContent: text });
$('#record-tabs').replaceChildren(
  tabLabel('From NASA’s Earth Information Center'), ...CATALOGUE.filter((r) => r.kind === 'picture').map(tabFor),
  tabLabel('Day by day, from NASA’s satellites'), ...CATALOGUE.filter((r) => r.kind === 'live').map(tabFor),
);
$('#frame').addEventListener('change', (ev) => { state.top.part = +ev.target.value; loadRecord(state.top); });

// the gallery, the footer links and the stack line are built from the catalogue, so they never fall out of step
{
  const eic = CATALOGUE.filter((r) => r.kind === 'picture');
  $('#shots').prepend(...eic.map((r) => {
    const fig = document.createElement('figure'), box = Object.assign(document.createElement('div'), { className: 'shot f-ink' });
    const v = viewOf(r);
    box.append(Object.assign(document.createElement('img'), { src: v.show || v.image, alt: r.describe || r.title, width: 1024, height: 512 }));
    const cap = document.createElement('figcaption');
    cap.append(Object.assign(document.createElement('span'), { className: 'strong', textContent: r.title }), ` Earth Information Center, SVS ${r.svs}`);
    fig.append(box, cap);
    return fig;
  }));
  $('#foot-svs').append(...eic.map((r) => {
    const li = document.createElement('li');
    li.append(Object.assign(document.createElement('a'), { href: r.page || `https://svs.gsfc.nasa.gov/${r.svs}/`, textContent: `${r.title}, SVS ${r.svs}` }));
    return li;
  }));
  $('#stack-eic').textContent = `${eic.length} visualizations from NASA's Scientific Visualization Studio: ${eic.map((r) => r.title.toLowerCase()).join(', ')}.`;
}
const dateInput = $('#date');
dateInput.value = state.date; dateInput.max = new Date(Date.now() - 12 * 3600 * 1000).toISOString().slice(0, 10); dateInput.min = '2023-01-01';
dateInput.addEventListener('change', () => { if (dateInput.value) { state.date = dateInput.value; loadRecord(state.top); } });
$('#speed').addEventListener('change', (ev) => { state.seconds = +ev.target.value; stop(); buildAudio(); paintRecord(); });
$('#timbre').addEventListener('change', (ev) => { state.timbre = ev.target.value || null; stop(); buildAudio(); paintRecord(); });
$('#voices').addEventListener('change', (ev) => { state.simple = ev.target.value !== '8'; state.solo = ev.target.value === 'solo'; stop(); buildAudio(); paintRecord(); });

// page voice: off for people whose screen reader already speaks every answer
function setVoice(on, save) {
  state.voice = on;
  if (!on && 'speechSynthesis' in window) speechSynthesis.cancel();
  $('#voice').setAttribute('aria-pressed', String(on));
  $('#voice-label').textContent = on ? 'Page voice: on' : 'Page voice: off';
  if (save) { try { localStorage.setItem('earshot-voice', on ? 'on' : 'off'); } catch { /* private mode */ } }
}
let savedVoice = null;
try { savedVoice = localStorage.getItem('earshot-voice'); } catch { /* private mode */ }
// Off by default: most blind visitors arrive with a screen reader that already reads
// every answer, and two voices at once is worse than one. Sighted visitors turn it on.
setVoice(savedVoice === 'on', false);
$('#voice').addEventListener('click', () => setVoice(!state.voice, true));

// vibration, on phones that have it: feel the sweep while it plays, and feel a spot under your finger
const hapticBox = $('#haptic');
if (navigator.vibrate && matchMedia('(pointer: coarse)').matches) {
  hapticBox.closest('.ctl').hidden = false;
  hapticBox.addEventListener('change', () => { state.haptic = hapticBox.checked; navigator.vibrate(state.haptic ? 30 : 0); });
}
function vibrateSweep() {
  if (!state.haptic || !navigator.vibrate) return;
  const lv = state.sound, ms = (state.audio.sweep * 1000) / lv.cols, pattern = [0, Math.round(state.audio.lead * 1000 + 50)];
  for (let c = 0; c < lv.cols; c++) {
    let sum = 0;
    for (let b = 0; b < lv.level.length; b++) if (lv.known[b][c]) sum += lv.level[b][c];
    const on = Math.round(Math.min(1, sum / (lv.level.length / 4)) * ms * 0.9);
    pattern.push(on, Math.round(ms - on));
  }
  navigator.vibrate(pattern);
}

// ------------------------------------------------------------ downloads
function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stem = () => `earshot-${state.record.id}-${state.record.kind === 'live' ? state.date : 'frame'}`;
// The note stored inside every sound file Earshot writes. It lets the file be turned
// back into a labelled map, and it records the source, as the challenge rules ask of audio.
function soundNote() {
  const rec = state.record, lv = state.levels;
  return {
    app: 'Earshot', title: rec.title, noun: rec.noun, unit: rec.mode === 'spark' || rec.noValue ? '' : rec.unit,
    lo: lv.lo, hi: lv.hi, curve: lv.curve, when: state.source, source: rec.source, gaps: E.gapsToText(state.sound),
    made: 'Computed from NASA data by a fixed formula in Earshot. No generative AI made this sound. The code was written with AI assistance.',
  };
}
const downloads = {
  wav: () => save(stem() + '.wav', E.toWav(state.audio, soundNote()), 'audio/wav'),
  csv: () => save(stem() + '-bands.csv', E.gridToCsv(state.grid, state.levels), 'text/csv'),
  points: () => {
    const rows = ['lat,lon,value'];
    for (let b = 0; b < E.BANDS; b++) for (let c = 0; c < state.grid.cols; c++) if (state.levels.known[b][c]) rows.push(`${E.BAND_EDGES[b] + 11.25},${(-180 + ((c + 0.5) / state.grid.cols) * 360).toFixed(1)},${+state.grid.mean[b][c].toFixed(4)}`);
    save(stem() + '-points.csv', rows.join('\n') + '\n', 'text/csv');
  },
  png: () => state.image && state.image.toBlob((b) => save(stem() + '.png', b, 'image/png')),
  brief: () => save(stem() + '-briefing.txt', `${state.record.title}\n${state.source}\nSource: ${state.record.source}\n\n${state.brief.text}\n\nLimits:\n- ${state.record.limits.join('\n- ')}\n`, 'text/plain'),
  proof: () => save(stem() + '-proof.json', JSON.stringify({ record: state.record.id, title: state.record.title, source: state.source, method: 'audio decoded with the Goertzel algorithm, compared cell by cell with the map levels', cells: state.proof.cells, correlation: state.proof.r, meanError: state.proof.meanError, worstError: state.proof.maxError, exactColourShare: state.field ? state.field.exactShare : null }, null, 2), 'application/json'),
};
for (const b of $$('[data-download]')) b.addEventListener('click', () => state.audio && downloads[b.dataset.download]());

// ------------------------------------------------------------ bring your own
$('#byo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const file = $('#byo-file').files[0], out = $('#byo-status');
  if (!file) { out.textContent = 'Choose a map picture or a CSV file first.'; return; }
  const unit = $('#byo-unit').value.trim() || 'units', noun = $('#byo-noun').value.trim() || 'the value';
  const base = { id: 'yours', title: file.name, noun, unit, curve: 'linear', source: 'your file', about: 'Your own data, read by the same eight voices.', limits: ['Earshot assumes your picture is a whole-world map with north at the top and the date line at the edges.', 'Values are only as good as the colour scale you chose.'], field: 'coral' };
  try {
    if (/\.wav$|audio\//i.test(file.name + file.type)) {
      // A sound file becomes a map again: the levels are measured from the audio, and
      // the name, unit and scale come from the note Earshot stores inside the file.
      const audio = E.fromWav(new Uint8Array(await file.arrayBuffer()));
      const heard = E.listenBack(audio);
      const note = audio.meta || {}, rows = heard.level.length, cols = heard.cols;
      const lo = isFinite(note.lo) ? note.lo : 0, hi = isFinite(note.hi) && note.hi > lo ? note.hi : 1, curve = note.curve === 'log' ? 'log' : 'linear';
      const grid = { cols, mean: [], cover: [] };
      for (let b = 0; b < E.BANDS; b++) {
        const from = heard.level[rows === 4 ? Math.floor(b / 2) : b];
        const row = rows === 4 ? Math.floor(b / 2) : b;
        grid.mean.push(Float32Array.from(from, (lv, c) => (E.gapAt(note.gaps, rows, cols, row, c) ? NaN : E.levelToValue(lv, lo, hi, curve))));
        grid.cover.push(Float32Array.from(from, (lv, c) => (E.gapAt(note.gaps, rows, cols, row, c) ? 0 : 1)));
      }
      state.custom = {
        ...base, kind: 'points', grid, lo, hi, curve, timbre: heard.timbre,
        title: note.title ? `${note.title}, rebuilt from its sound` : file.name,
        noun: note.noun || noun, unit: note.unit || (note.app ? '' : unit), noValue: !!note.app && !note.unit,
        source: note.source ? `a sound file made from: ${note.source}` : 'a sound file',
        about: 'This map was rebuilt from a sound file. A program measured each voice in the audio and drew the map from that.',
        limits: ['The map has the detail the sound carries: eight bands by 72 slices, or four bands if it was made with four voices.', 'The values come from the sound. Which cells had no data comes from the note Earshot stores inside the file; a recording without that note treats silence as the bottom of the scale.'],
      };
      out.textContent = `Rebuilt a map of ${rows * cols} cells from the sound${heard.mono ? ', which had been folded to one channel' : ''}.${note.when ? ' It was made from: ' + note.when + '.' : ''}`;
    } else if (/\.csv$|text\/csv/i.test(file.name + file.type)) {
      const pts = E.parsePointsCsv(await file.text());
      if (pts.length < 3) throw new Error('no rows with lat, lon and value were found');
      let lo = Infinity, hi = -Infinity;
      for (const p of pts) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
      state.custom = { ...base, kind: 'points', grid: E.gridFromPoints(pts), lo, hi: hi > lo ? hi : lo + 1 };
      out.textContent = `Read ${pts.length} rows${pts.valueName ? `, using the column "${pts.valueName}" as the value` : ''}. Scale runs from ${fmt(lo)} to ${fmt(hi)} ${unit}.`;
    } else {
      const bitmap = await createImageBitmap(file);
      const mode = $('#byo-scale').value;
      const lo = parseFloat($('#byo-lo').value), hi = parseFloat($('#byo-hi').value);
      const rec = { ...base, kind: 'custom', bitmap, lo: isFinite(lo) ? lo : 0, hi: isFinite(hi) && hi > lo ? hi : 1 };
      if (mode === 'brightness') { rec.mode = 'brightness'; rec.lo = 0; rec.hi = 1; rec.unit = 'brightness'; }
      else if (mode === 'pm25') { const pm = RECORDS.find((r) => r.id === 'pm25'); rec.scale = E.scaleFromStops(pm.stops.map(([r, g, b, value]) => ({ r, g, b, value }))); rec.lo = pm.lo; rec.hi = pm.hi; rec.curve = 'log'; rec.unit = pm.unit; }
      else {
        const a = hex($('#byo-c1').value), z = hex($('#byo-c2').value), stops = [];
        for (let i = 0; i < 32; i++) { const t = i / 31; stops.push({ r: Math.round(a[0] + (z[0] - a[0]) * t), g: Math.round(a[1] + (z[1] - a[1]) * t), b: Math.round(a[2] + (z[2] - a[2]) * t), value: rec.lo + t * (rec.hi - rec.lo) }); }
        rec.scale = E.scaleFromStops(stops);
      }
      state.custom = rec;
      out.textContent = `Read ${file.name} in this browser. Nothing was uploaded.`;
    }
    await loadRecord(state.custom, { announce: true });
    $('#jukebox').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } catch (err) { out.textContent = 'That file could not be read: ' + err.message + '.'; }
});
$('#byo-scale').addEventListener('change', (ev) => { $('#byo-two').hidden = ev.target.value !== 'two'; });

// ------------------------------------------------------------ builders: tabs and the live API
$('#api-tabs').addEventListener('keydown', (ev) => {
  const tabs = $$('#api-tabs button'), i = tabs.indexOf(document.activeElement);
  const j = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? i + 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
  if (i < 0 || j === null) return;
  ev.preventDefault();
  const next = tabs[(j + tabs.length) % tabs.length];
  next.focus(); next.click();
});
for (const t of $$('#api-tabs button')) t.addEventListener('click', () => {
  for (const b of $$('#api-tabs button')) { b.setAttribute('aria-selected', String(b === t)); b.tabIndex = b === t ? 0 : -1; }
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== t.dataset.tab;
});
let apiKey = null;
const api = (path, init = {}) => fetch('api/v1/' + path, { ...init, signal: AbortSignal.timeout(20000) });
api('health').then((r) => r.ok ? r.json() : Promise.reject()).then(() => {
  $('#api-state').textContent = 'The Earshot API is running on this server. Ask for a key and run a real call.';
  $('#api-key').disabled = false;
}).catch(() => { $('#api-state').textContent = 'This copy of the site is static, so the API is not running here. Start it with "node server/server.mjs" and the buttons below go live.'; });
$('#api-key').addEventListener('click', async () => {
  try { const j = await (await api('keys', { method: 'POST' })).json(); apiKey = j.key; $('#api-key-out').textContent = j.key; $('#api-run').disabled = false; }
  catch { $('#api-key-out').textContent = 'The server did not answer.'; }
});
$('#api-run').addEventListener('click', async () => {
  const body = { record: state.record.kind === 'live' ? state.record.id : 'smoke', date: state.shownDate || state.date, place: $('#place').value.trim() || 'Charlotte' };
  $('#api-out').textContent = 'Calling POST /api/v1/brief';
  try { const r = await api('brief', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey }, body: JSON.stringify(body) }); $('#api-out').textContent = JSON.stringify(await r.json(), null, 2); }
  catch (e) { $('#api-out').textContent = 'The call failed: ' + e.message; }
});

// ------------------------------------------------------------ the i buttons
const pop = $('#info-pop');
let popFor = null, warm = 0, openedAt = 0, infoCount = 0;
function showInfo(btn) {
  const info = INFO[btn.dataset.info];
  if (!info) return;
  $('#info-title').textContent = info[0];
  $('#info-body').textContent = info[1];
  pop.hidden = false;
  pop.toggleAttribute('data-instant', Date.now() - warm < 600); // no delay once one is open
  const b = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(innerWidth - pw - 12, Math.max(12, b.left + b.width / 2 - pw / 2));
  let top = b.bottom + 10, below = true;
  if (top + ph > innerHeight - 12 && b.top - ph - 10 > 12) { top = b.top - ph - 10; below = false; }
  pop.style.left = left + scrollX + 'px'; pop.style.top = top + scrollY + 'px';
  pop.style.transformOrigin = `${b.left + b.width / 2 - left}px ${below ? '0' : '100%'}`;
  requestAnimationFrame(() => pop.setAttribute('data-open', ''));
  if (popFor) popFor.setAttribute('aria-expanded', 'false');
  popFor = btn; btn.setAttribute('aria-expanded', 'true');
  openedAt = Date.now();
}
function hideInfo() {
  if (!popFor) return;
  popFor.setAttribute('aria-expanded', 'false'); popFor = null; warm = Date.now();
  pop.removeAttribute('data-open'); pop.hidden = true;
}
for (const b of $$('button.info')) {
  b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'info-pop');
  // the full text is also attached to the button itself, so a screen reader reads it without opening anything
  const info = INFO[b.dataset.info];
  if (info) {
    const d = Object.assign(document.createElement('span'), { id: 'info-text-' + (infoCount++), className: 'sr', textContent: info[1] });
    b.after(d); b.setAttribute('aria-describedby', d.id);
  }
  // a tap focuses the button and then clicks it: do not let that click close what the focus just opened
  b.addEventListener('click', (ev) => { ev.stopPropagation(); if (popFor === b) { if (Date.now() - openedAt > 350) hideInfo(); } else showInfo(b); });
  b.addEventListener('pointerenter', (ev) => { if (ev.pointerType === 'mouse') showInfo(b); });
  b.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hideInfo(); });
  b.addEventListener('focus', () => showInfo(b));
  b.addEventListener('blur', hideInfo);
}
addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideInfo(); });
addEventListener('click', hideInfo);
addEventListener('scroll', hideInfo, { passive: true });

// ------------------------------------------------------------ entrances
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); seen.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px' });
for (const el of $$('[data-rise]')) seen.observe(el);
// safety net: nothing stays hidden if an entrance never fires
setTimeout(() => { for (const el of $$('[data-rise]')) el.classList.add('in'); }, 5000);

// ------------------------------------------------------------ the listening check
// Plays real maps the listener is not shown and asks what they heard. The right
// answers are worked out from the data, so nobody marks their own homework.
const ears = { clips: [], clip: 0, q: 0, answers: [], node: null, busy: false };
const EAR_CHANCE = { half: 0.5, third: 1 / 3, gaps: 0.5 };

async function quietLevels(rec) {
  let img, scale = null, o = {};
  if (rec.kind === 'live') {
    scale = await gibsScale(rec.colormap, `records/live/${rec.id}.xml`);
    img = await loadImage(`records/live/${rec.id}.png`);
    o = { emptyIsZero: rec.emptyIsZero };
  } else return (await readPicture(rec)).levels;
  const f = E.decode(pixelsOf(img).data.data, W, H, scale, o);
  const grid = E.toGrid(f.values, f.valid, W, H);
  let lo = rec.lo, hi = rec.hi;
  if (rec.autoRange) { let mx = 0; for (const row of grid.mean) for (const v of row) if (isFinite(v) && v > mx) mx = v; lo = 0; hi = mx || 1; }
  return E.toLevels(grid, lo, hi, 0.08, rec.curve);
}
function earQuestions(levels) {
  const f = E.facts(levels), qs = [];
  if (isFinite(f.north) && isFinite(f.south) && Math.abs(f.north - f.south) >= 0.06) {
    qs.push({ q: 'half', text: 'Which half of the planet had more: the south, in the low notes, or the north, in the high notes?', options: ['South', 'North'], answer: f.north > f.south ? 'North' : 'South' });
  }
  const order = [0, 1, 2].sort((a, b) => f.third[b] - f.third[a]);
  if (f.third[order[0]] > 0 && f.third[order[0]] >= f.third[order[1]] * 1.2) {
    qs.push({ q: 'third', text: 'When was the sound fullest: early in the sweep, in the middle, or late?', options: ['Early', 'Middle', 'Late'], answer: ['Early', 'Middle', 'Late'][order[0]] });
  }
  // the hiss plays in every slice of the sweep that has a missing band: ask only when the answer is clear
  let hissing = 0;
  for (let c = 0; c < levels.cols; c++) if (levels.known.some((row) => !row[c])) hissing++;
  const share = hissing / levels.cols;
  if (share >= 0.3 || share === 0) {
    qs.push({ q: 'gaps', text: 'Did you hear a hiss? A hiss marks places with no data.', options: ['Yes, a hiss', 'No hiss'], answer: share > 0 ? 'Yes, a hiss' : 'No hiss' });
  }
  return qs;
}
function earPlay(then) {
  const a = ears.clips[ears.clip].audio, ac = audioCtx();
  clearTimeout(ears.timer);
  if (ears.node) { ears.node.onended = null; try { ears.node.stop(); } catch { /* done */ } }
  const buf = ac.createBuffer(2, a.left.length, a.sampleRate);
  buf.copyToChannel(a.left, 0); buf.copyToChannel(a.right, 1);
  ears.node = ac.createBufferSource(); ears.node.buffer = buf; ears.node.connect(ac.destination);
  // move on when the clip ends; the timer is a safety net in case the browser never reports the end
  clearTimeout(ears.timer);
  let moved = false;
  const next = () => { if (moved || !then) return; moved = true; clearTimeout(ears.timer); then(); };
  ears.node.onended = next;
  ears.timer = setTimeout(next, (a.seconds + 1.2) * 1000);
  ears.node.start(ac.currentTime + 0.4);
}
function earAsk() {
  const clip = ears.clips[ears.clip], q = clip.questions[ears.q];
  $('#ears-step').textContent = `Clip ${ears.clip + 1} of ${ears.clips.length}, question ${ears.q + 1} of ${clip.questions.length}.`;
  $('#ears-question').textContent = q.text;
  $('#ears-options').replaceChildren(...q.options.map((o) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: o });
    b.addEventListener('click', () => earAnswer(o));
    return b;
  }));
  $('#ears-q').hidden = false; $('#ears-replay').hidden = false;
  say(q.text);
  const first = $('#ears-options button'); if (first) first.focus();
}
function earAnswer(choice) {
  const clip = ears.clips[ears.clip], q = clip.questions[ears.q], correct = choice === q.answer;
  ears.answers.push({ record: clip.rec.id, q: q.q, choice, answer: q.answer, correct });
  const text = correct ? `Right: ${q.answer}.` : `Not this time. It was: ${q.answer}.`;
  $('#ears-feedback').textContent = text;
  $('#ears-q').hidden = true;
  if (++ears.q < clip.questions.length) { say(text); return setTimeout(earAsk, state.voice ? 1800 : 700); }
  ears.q = 0;
  if (++ears.clip < ears.clips.length) {
    say(text + ' Next clip.');
    $('#ears-step').textContent = `Clip ${ears.clip + 1} of ${ears.clips.length} is playing. Listen with your eyes closed.`;
    $('#ears-replay').hidden = true;
    return setTimeout(() => earPlay(earAsk), state.voice ? 2600 : 900);
  }
  earDone(text);
}
function earDone(last) {
  const n = ears.answers.length, right = ears.answers.filter((a) => a.correct).length;
  const chance = ears.answers.reduce((s2, a) => s2 + EAR_CHANCE[a.q], 0);
  const text = `${last} You got ${right} of ${n} by ear. Guessing would get about ${chance.toFixed(1)}.`;
  $('#ears-step').textContent = 'Done. The maps you heard: ' + ears.clips.map((c) => c.rec.title).join(', ') + '.';
  $('#ears-feedback').textContent = text; say(text);
  $('#ears-replay').hidden = true; $('#ears-share').hidden = false; $('#ears-start').hidden = false;
  $('#ears-feedback').focus();
  $('#ears-start').textContent = 'Try three more clips'; ears.busy = false;
  try {
    const mine = JSON.parse(localStorage.getItem('earshot-ears') || '{"sessions":0,"answers":0,"correct":0,"byChance":0}');
    mine.sessions++; mine.answers += n; mine.correct += right; mine.byChance += chance;
    localStorage.setItem('earshot-ears', JSON.stringify(mine));
  } catch { /* private mode */ }
  earTally();
}
$('#ears-start').addEventListener('click', async () => {
  if (ears.busy) return;
  ears.busy = true; stop(); audioCtx();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('#ears-share').hidden = true; $('#ears-q').hidden = true; $('#ears-feedback').textContent = '';
  $('#ears-step').focus(); // move focus before the button goes, so it is never dropped to the top of the page
  $('#ears-start').hidden = true;
  $('#ears-step').textContent = 'Getting three maps ready';
  const pool = CATALOGUE.map((r) => viewOf(r)).sort(() => Math.random() - 0.5);
  ears.clips = []; ears.clip = 0; ears.q = 0; ears.answers = [];
  for (const rec of pool) {
    if (ears.clips.length === 3) break;
    try {
      const levels = await quietLevels(rec);
      const heardAs = state.simple ? E.simplify(levels) : levels; // ask about exactly what will be played
      const questions = earQuestions(heardAs).sort(() => Math.random() - 0.5).slice(0, 2);
      if (!questions.length) continue;
      ears.clips.push({ rec, questions, audio: E.sonify(heardAs, { seconds: 12, timbre: timbreOf(rec), rhythm: rec.rhythm }) });
    } catch { /* skip a record that will not load */ }
  }
  if (!ears.clips.length) { $('#ears-step').textContent = 'The maps could not be loaded. Check the connection and try again.'; $('#ears-start').hidden = false; ears.busy = false; return; }
  $('#ears-step').textContent = `Clip 1 of ${ears.clips.length} is playing. Listen with your eyes closed.`;
  earPlay(earAsk);
});
$('#ears-replay').addEventListener('click', () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); earPlay(null); });
$('#ears-save').addEventListener('click', () => save('earshot-listening-check.json', JSON.stringify({ taken: new Date().toISOString(), eyesClosed: $('#ears-eyes').checked, blindOrLowVision: $('#ears-blv').checked, answers: ears.answers }, null, 2), 'application/json'));
$('#ears-send').addEventListener('click', async () => {
  const body = { answers: ears.answers.map((a) => ({ q: a.q, correct: a.correct, record: a.record })), eyesClosed: $('#ears-eyes').checked, blindOrLowVision: $('#ears-blv').checked };
  try {
    const r = await api('listening', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error || 'the server said no');
    $('#ears-feedback').textContent = 'Added. Thank you.'; $('#ears-share').hidden = true;
    earTally();
  } catch (e) { $('#ears-feedback').textContent = 'Your score could not be added here (' + e.message + '). Use "Save my answers" to keep a copy.'; }
});
// what listeners have scored so far: from the server when it is running, else from this device
async function earTally() {
  const line = (t, who) => `${who} answered ${t.answers} questions by ear and got ${t.correct} right, which is ${Math.round((t.correct / t.answers) * 100)} percent. Guessing would get ${Math.round((t.byChance / t.answers) * 100)} percent.`;
  let text = '', hero = null, score = null;
  try {
    const t = await (await api('listening')).json();
    if (t.all && t.all.answers) {
      score = t.all;
      text = line(t.all, `So far ${t.all.sessions} ${t.all.sessions === 1 ? 'listener has' : 'listeners have'}`);
      if (t.blindOrLowVision && t.blindOrLowVision.answers) text += ' ' + line(t.blindOrLowVision, `Of those, ${t.blindOrLowVision.sessions} who said they are blind or have low vision`);
      if (t.all.answers >= 20) hero = `${Math.round((t.all.correct / t.all.answers) * 100)} percent of ${t.all.answers} answers given by ear were right, from ${t.all.sessions} listeners. `;
    }
  } catch {
    try { const m = JSON.parse(localStorage.getItem('earshot-ears') || 'null'); if (m && m.answers) { text = line(m, 'On this device, people have'); score = { ...m, local: true }; } } catch { /* private mode */ }
  }
  $('#ears-tally').textContent = text;
  $('.ears-score').hidden = !score;
  if (score) {
    $('#es-n').textContent = String(score.sessions) + (score.local ? ' on this device' : '');
    $('#es-right').textContent = `${Math.round((score.correct / score.answers) * 100)} percent of ${score.answers}`;
    $('#es-chance').textContent = `${Math.round((score.byChance / score.answers) * 100)} percent`;
  }
  if (hero) $('#hero-ears').replaceChildren(hero, Object.assign(document.createElement('a'), { href: '#ears', textContent: 'Take the one-minute listening check.' }));
}
earTally();

// ------------------------------------------------------------ go
loadRecord(CATALOGUE[0]);
