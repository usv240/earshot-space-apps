// Shared by the HTTP API and the MCP server: fetch a live NASA map, decode it,
// and run the same engine the web page uses.
// Written with AI assistance (Claude). See README, "Use of AI".
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng } from './png.mjs';
import * as E from '../site/engine/earshot.js';
import { RECORDS, GIBS_COLORMAPS, gibsUrl, defaultDate } from '../site/data/records.js';
import { findCity, nearestCity, regionAt } from '../site/data/places.js';

export { E, RECORDS, defaultDate, regionAt };
const SAVED_DAY = '2026-11-13';
const shiftDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const here = dirname(fileURLToPath(import.meta.url));
const saved = (name) => join(here, '..', 'site', 'records', 'live', name);
const cache = new Map();

export const liveRecords = () => RECORDS.filter((r) => r.kind === 'live');
export function recordInfo(r) {
  return { id: r.id, title: r.title, measures: r.about, unit: r.unit, source: r.source, instrument: r.timbre, rhythm: r.rhythm || null, limits: r.limits };
}

async function get(url, as) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`NASA answered ${r.status}`);
  return as === 'text' ? r.text() : Buffer.from(await r.arrayBuffer());
}

// Returns everything known about one record on one day.
export async function loadLive(id, date = defaultDate()) {
  const rec = RECORDS.find((r) => r.id === id && r.kind === 'live');
  if (!rec) throw new Error(`unknown record "${id}". Use one of: ${liveRecords().map((r) => r.id).join(', ')}`);
  const day = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(day) || day.toISOString().slice(0, 10) !== date) throw new Error('date must be a real day written like 2026-11-13');
  if (day.getTime() > Date.now()) throw new Error('that day is in the future');
  const key = id + date;
  if (cache.has(key)) return cache.get(key);
  let img, scale, source, shown = date;
  try {
    scale = E.parseGibsColormap(await get(GIBS_COLORMAPS + rec.colormap, 'text'));
    // NASA answers with an empty picture for a day it has not published yet.
    // An empty picture must never be read as "nothing there": step back a day at a time.
    for (let tries = 0; ; tries++) {
      const png = await get(gibsUrl(rec.layer, shown));
      if (png[0] !== 137) throw new Error('NASA did not return a picture');
      img = decodePng(png);
      if (E.decode(img.rgba, img.width, img.height, scale, {}).matchedShare > 0.002) break;
      if (tries >= 4) throw new Error('NASA had no picture with data near that day');
      shown = shiftDay(shown, -1);
    }
    source = shown === date ? `${shown}, fetched from NASA GIBS` : `${shown}, fetched from NASA GIBS. NASA has not published ${date} for this record, so this is the newest day before it`;
  } catch (err) {
    img = decodePng(await readFile(saved(id + '.png')));
    scale = E.parseGibsColormap(await readFile(saved(id + '.xml'), 'utf8'));
    shown = SAVED_DAY;
    source = `${SAVED_DAY}, saved copy (${err.message})`;
  }
  const field = E.decode(img.rgba, img.width, img.height, scale, { emptyIsZero: rec.emptyIsZero, south: rec.south, north: rec.north });
  const grid = E.toGrid(field.values, field.valid, img.width, img.height);
  const levels = E.toLevels(grid, rec.lo, rec.hi, 0.08, rec.curve);
  const out = { rec, date: shown, asked: date, source, img, field, grid, levels };
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

export function resolvePlace(place) {
  if (place && typeof place === 'object' && isFinite(place.lat) && isFinite(place.lon)) {
    const c = nearestCity(place.lat, place.lon, 2.5);
    return { lat: +place.lat, lon: +place.lon, name: c ? `near ${c.name}` : regionAt(place.lat, place.lon) };
  }
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(place || ''));
  if (m) return resolvePlace({ lat: +m[1], lon: +m[2] });
  const c = findCity(String(place || ''));
  return c ? { lat: c.lat, lon: c.lon, name: c.name } : null;
}

export function readPlace(live, place) {
  const p = resolvePlace(place);
  if (!p) return { found: false, sentence: `"${place}" is not a place Earshot knows. Use a large city or "lat, lon".` };
  const { rec, field, img, levels } = live;
  const v = E.valueAt(field.values, field.valid, img.width, img.height, p.lat, p.lon).value;
  if (!isFinite(v)) return { found: true, ...p, value: null, sentence: `${p.name} has no reading on this map. A gap means this map has no data there.` };
  const level = E.valueToLevel(v, levels.lo, levels.hi, levels.curve);
  const word = rec.words ? E.wordFromTable(rec.words, v) : E.wordFor(level) + " on this record's scale";
  return { found: true, ...p, value: +v.toFixed(4), unit: rec.unit, word, sentence: `Over ${p.name}, ${rec.noun} is ${v.toFixed(2)} ${rec.unit}, which is ${word}.` };
}

// The area around one place, cut from the same map: the levels for a sound, and plain sentences.
export function around(live, place) {
  const p = resolvePlace(place);
  if (!p) return null;
  const { rec, field, img, levels: whole } = live;
  const box = E.areaBox(p.lat, p.lon);
  const grid = E.areaGrid(field.values, field.valid, img.width, img.height, box);
  const levels = E.toLevels(grid, whole.lo, whole.hi, 0.08, whole.curve);
  const name = p.name.replace(/^near /, '');
  const near = E.nearby(levels, grid, { name, noun: rec.noun, unit: rec.unit, words: rec.words, most: rec.most, placeName: regionAt });
  return { place: p, name, box, levels, near, here: readPlace(live, place) };
}

export function describe(live) {
  const { rec, levels, field, grid, img, source } = live;
  const f0 = E.facts(levels, grid);
  const b = E.brief(levels, {
    noun: rec.noun, unit: rec.unit, grid, words: rec.words, assumedZero: !!rec.emptyIsZero, placeName: regionAt, oceanCaveat: rec.oceanCaveat,
    peakLat: f0.peak.level >= 0 ? E.peakLat(field.values, field.valid, img.width, img.height, f0.peak.band, f0.peak.col, grid.cols) : undefined,
  });
  return {
    record: rec.id, title: rec.title, date: live.date, source, nasaProduct: rec.source,
    whatThePictureLooksLike: rec.describe,
    briefing: b.text,
    coveragePercent: rec.emptyIsZero ? null : Math.round(b.facts.coverage * 100),
    coverageNote: rec.emptyIsZero ? 'On this record a blank patch is counted as none, although it can also mean no estimate, so coverage cannot be measured.' : 'Cells with no data are left out and marked by a hiss in the sound.',
    exactColourMatchPercent: +(field.exactShare * 100).toFixed(1),
    bandAverages: Object.fromEntries(E.BAND_NAMES.map((n, i) => [n, isFinite(b.facts.bandMean[i]) ? E.wordFor(b.facts.bandMean[i]) : 'no data'])),
    limits: rec.limits,
  };
}

// Sound plus the self-check. levels can come from a live record or from caller data.
export function makeSound(levels, seconds = 12, opts = {}) {
  const sound = opts.voices === 4 ? E.simplify(levels) : levels;
  const audio = E.sonify(sound, { seconds: Math.min(30, Math.max(4, seconds)), timbre: opts.timbre, rhythm: opts.rhythm, marker: opts.marker });
  const wav = E.toWav(audio, opts.note);
  const check = E.compare(sound, E.listenBack(E.fromWav(wav), sound.cols));
  return {
    wav, seconds: +audio.seconds.toFixed(2), instrument: audio.timbre, rhythm: audio.rhythm, voices: audio.voices,
    proof: { cells: check.cells, correlation: +check.r.toFixed(4), meanErrorPercent: +(check.meanError * 100).toFixed(2), method: 'A second program was given only the WAV. It measured each voice with the Goertzel algorithm and rebuilt the grid, which was compared cell by cell with the map.' },
  };
}

// Caller-supplied numbers: {points:[{lat,lon,value}]} or {grid:[8 rows south to north]}.
export function levelsFromBody(body) {
  let grid;
  if (Array.isArray(body.points)) grid = E.gridFromPoints(body.points);
  else if (Array.isArray(body.grid) && body.grid.length === E.BANDS) {
    const cols = body.grid[0].length;
    grid = { cols, mean: body.grid.map((r) => Float32Array.from(r.map((v) => (v === null ? NaN : +v)))), cover: body.grid.map((r) => Float32Array.from(r.map((v) => (v === null || !isFinite(+v) ? 0 : 1)))) };
  } else throw new Error('send "record", or "points" as [{lat, lon, value}], or "grid" as 8 rows from south to north');
  let lo = body.lo, hi = body.hi;
  if (!isFinite(lo) || !isFinite(hi)) {
    lo = Infinity; hi = -Infinity;
    for (const row of grid.mean) for (const v of row) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  if (!(hi > lo)) hi = lo + 1;
  const levels = E.toLevels(grid, +lo, +hi, 0, body.curve === 'log' ? 'log' : 'linear');
  levels.grid = grid;
  return levels;
}
