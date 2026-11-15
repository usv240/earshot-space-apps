// Earshot server: serves the site and the HTTP API. No packages needed.
//   node server/server.mjs            then open http://localhost:8790
// Written with AI assistance (Claude). See README, "Use of AI".
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { E, liveRecords, recordInfo, loadLive, readPlace, describe, makeSound, levelsFromBody, defaultDate, regionAt, around, resolvePlace } from './core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = join(here, '..', 'site');
const KEYFILE = join(here, 'keys.json');
const PORT = Number(process.env.PORT || 8790);
const PER_HOUR = 120;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'text/xml', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.csv': 'text/csv', '.txt': 'text/plain; charset=utf-8' };

let keys = {};
try { keys = JSON.parse(await readFile(KEYFILE, 'utf8')); } catch { /* first run */ }
const saveKeys = () => writeFile(KEYFILE, JSON.stringify(keys)).catch(() => {});

// Per-address limits that reset every hour. Behind a host's proxy the visitor's
// address arrives in x-forwarded-for. That header can be forged, so it is only
// believed when the host says there is a proxy in front: set TRUST_PROXY=1.
const perIp = new Map();
function tooMany(req, what, limit) {
  // the last entry is the one the proxy itself added; earlier entries come from the visitor and can be forged
  const forwarded = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() : '';
  const ip = forwarded || req.socket.remoteAddress || 'x';
  const key = `${what}|${ip}|${Math.floor(Date.now() / 3600000)}`;
  if (perIp.size > 5000) perIp.clear();
  const n = (perIp.get(key) || 0) + 1;
  perIp.set(key, n);
  return n > limit;
}

// The listening check: anonymous tallies of what people got right by ear.
// Only counts are kept. byChance is the score that guessing would have earned.
const EARFILE = join(here, 'listening.json');
const EAR_QUESTIONS = { half: 0.5, third: 1 / 3, gaps: 0.5 };
let ears = { all: {}, eyesClosed: {}, blindOrLowVision: {}, byQuestion: {}, note: 'Self-reported and unmoderated. Counts only; no personal data.' };
try { ears = { ...ears, ...JSON.parse(await readFile(EARFILE, 'utf8')) }; } catch { /* first run */ }

function send(res, status, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body, null, 2) : body;
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'cache-control': 'no-store' });
  res.end(data);
}
async function readJson(req) {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > 2_000_000) throw new Error('request body is larger than 2 MB'); parts.push(c); }
  if (!parts.length) return {};
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Error('the request body is not valid JSON'); }
}
function checkKey(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  const k = m && keys[m[1]];
  if (!k) return 'Send your key as "Authorization: Bearer <key>". Get one with POST /api/v1/keys.';
  const hour = Math.floor(Date.now() / 3600000);
  if (k.hour !== hour) { k.hour = hour; k.used = 0; }
  if (++k.used > PER_HOUR) return `This key has used its ${PER_HOUR} calls for the hour.`;
  return null;
}

// One sound clip per record per day, made once and kept in memory.
const clips = new Map();
async function dailyClip(id, place, day) {
  const live = await loadLive(id, day || defaultDate());
  if (place) return areaClip(live, place);
  const key = id + live.date;
  if (!clips.has(key)) {
    const about = describe(live);
    const snd = makeSound(live.levels, 12, {
      timbre: live.rec.timbre, rhythm: live.rec.rhythm, voices: 4,
      note: { gaps: E.gapsToText(E.simplify(live.levels)), app: 'Earshot', title: live.rec.title, noun: live.rec.noun, unit: live.rec.unit, lo: live.levels.lo, hi: live.levels.hi, curve: live.levels.curve, when: about.source, source: live.rec.source, made: 'Computed from NASA data by a fixed formula in Earshot. No generative AI made this sound. The code was written with AI assistance.' },
    });
    if (clips.size > 16) clips.delete(clips.keys().next().value);
    clips.set(key, { wav: Buffer.from(snd.wav), about, date: live.date, rec: live.rec });
  }
  return clips.get(key);
}
// The area around one place for one record's newest day, with a chime where the place is.
function areaClip(live, place) {
  const key = `${live.rec.id}|${live.date}|${String(place).toLowerCase().trim()}`;
  if (!clips.has(key)) {
    const a = around(live, place);
    if (!a) throw Object.assign(new Error(`"${place}" is not a place Earshot knows. Use a large city or "lat, lon".`), { status: 400 });
    const about = describe(live);
    const snd = makeSound(a.levels, 12, {
      timbre: live.rec.timbre, rhythm: live.rec.rhythm, voices: 4, marker: { at: 0.5 },
      note: { app: 'Earshot', title: `${live.rec.title} around ${a.name}`, area: a.box, when: about.source, source: live.rec.source, made: 'Computed from NASA data by a fixed formula in Earshot. No generative AI made this sound. The code was written with AI assistance.' },
    });
    if (clips.size > 200) clips.delete(clips.keys().next().value);
    clips.set(key, { wav: Buffer.from(snd.wav), about, date: live.date, rec: live.rec, around: a });
  }
  return clips.get(key);
}
const xml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// A podcast-style feed: the newest day of every satellite record, as sound with its briefing.
async function feed(req, place) {
  const base = (process.env.PUBLIC_URL || `http://${req.headers.host}`).replace(/\/$/, '');
  if (place && !resolvePlace(place)) throw Object.assign(new Error(`"${place}" is not a place Earshot knows. Use a large city or "lat, lon".`), { status: 400 });
  const items = [];
  let placeName = '';
  for (const r of liveRecords()) {
    try {
      const c = await dailyClip(r.id, place);
      const day = new Date(c.date + 'T12:00:00Z');
      const when = day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      if (c.around) placeName = c.around.name;
      const words = c.around
        ? `${c.around.here.sentence} ${c.around.near.text} ${c.about.briefing.split('. ')[0].replace(/^Across the map, /, 'Across the whole planet, ')}. ${r.limits[0]} Source: ${r.source}.`
        : `${c.about.briefing} ${r.limits[0]} Source: ${r.source}.`;
      const q = place ? `&place=${encodeURIComponent(place)}` : '';
      items.push(`    <item>
      <title>${xml(r.title.replace(/, latest day$/, ''))}${c.around ? ' around ' + xml(c.around.name) : ''}, ${xml(when)}</title>
      <description>${xml(words)}</description>
      <enclosure url="${xml(base)}/api/v1/audio/${r.id}.wav?day=${c.date}${xml(q)}" length="${c.wav.length}" type="audio/wav"/>
      <guid isPermaLink="false">earshot-${r.id}-${c.date}${place ? '-' + xml(encodeURIComponent(String(place).toLowerCase())) : ''}</guid>
      <pubDate>${day.toUTCString()}</pubDate>
    </item>`);
    } catch { /* a record that cannot be read today is left out of the feed */ }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Earshot: ${placeName ? 'the area around ' + xml(placeName) : 'the Earth'}, day by day, in sound</title>
    <link>${xml(base)}/</link>
    <language>en</language>
    <description>${placeName
      ? `Every day, NASA's newest maps of rain, smoke and dust, haze and sea temperature for the area around ${xml(placeName)}, each as twelve seconds of sound. Low notes are the south of the area, high notes the north, and a soft chime marks ${xml(placeName)}. The words underneath say how far away and in which direction the most is.`
      : "NASA's newest maps of rain, smoke and dust, haze and sea temperature, each as twelve seconds of sound with a spoken-style briefing. Low notes are the south of the planet, high notes are the north, and louder means more."} Made by Earshot from NASA data. Information, not a warning or a forecast. Not made or endorsed by NASA.</description>
${items.join('\n')}
  </channel>
</rss>
`;
}

async function api(req, res, path, url) {
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  const place = url && url.searchParams.get('place') ? url.searchParams.get('place').slice(0, 80) : '';
  // A daily feed for one place: the area around it, for every satellite record.
  if (path === 'feed.xml' && req.method === 'GET') {
    if (tooMany(req, 'feed', 240)) return send(res, 429, { error: 'Too many requests from this address this hour.' });
    try {
      const body = await feed(req, place);
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=900' });
      return res.end(body);
    } catch (err) { return send(res, err.status || 500, { error: err.message }); }
  }
  // The newest day of one record as a sound file. No key: this is what the daily feed points at.
  const m = /^audio\/([a-z]+)\.wav$/.exec(path);
  if (m && req.method === 'GET') {
    if (tooMany(req, 'audio', 240)) return send(res, 429, { error: 'Too many sound files from this address this hour.' });
    let clip;
    const day = url && url.searchParams.get('day');
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'day must look like 2026-11-13' });
    try { clip = await dailyClip(m[1], place, day || undefined); } catch (err) { return send(res, err.status || 404, { error: err.message }); }
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': clip.wav.length, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=1800' });
    return res.end(clip.wav);
  }
  if (path === 'health') return send(res, 200, { ok: true, service: 'earshot', records: liveRecords().map((r) => r.id) });
  if (path === 'records' && req.method === 'GET') return send(res, 200, { defaultDate: defaultDate(), records: liveRecords().map(recordInfo) });
  if (path === 'listening' && req.method === 'GET') return send(res, 200, ears);
  if (path === 'listening' && req.method === 'POST') {
    if (tooMany(req, 'ears', 12)) return send(res, 429, { error: 'Too many scores from this address this hour.' });
    const body = await readJson(req);
    const answers = Array.isArray(body.answers) ? body.answers.filter((a) => a && EAR_QUESTIONS[a.q] && typeof a.correct === 'boolean') : [];
    if (answers.length < 1 || answers.length > 9) return send(res, 400, { error: 'Send "answers" as 1 to 9 items like {"q":"half","correct":true}.' });
    const add = (t) => {
      t.sessions = (t.sessions || 0) + 1;
      for (const a of answers) { t.answers = (t.answers || 0) + 1; t.correct = (t.correct || 0) + (a.correct ? 1 : 0); t.byChance = +((t.byChance || 0) + EAR_QUESTIONS[a.q]).toFixed(4); }
    };
    add(ears.all);
    if (body.eyesClosed === true) add(ears.eyesClosed);
    if (body.blindOrLowVision === true) add(ears.blindOrLowVision);
    for (const a of answers) { const q = (ears.byQuestion[a.q] ||= { answers: 0, correct: 0 }); q.answers++; if (a.correct) q.correct++; }
    ears.updated = new Date().toISOString();
    writeFile(EARFILE, JSON.stringify(ears, null, 2)).catch(() => {});
    return send(res, 201, ears);
  }
  if (path === 'keys' && req.method === 'POST') {
    if (tooMany(req, 'keys', 30)) return send(res, 429, { error: 'Too many keys requested from this address this hour. Try again in an hour.' });
    const key = 'es_' + randomBytes(18).toString('base64url');
    keys[key] = { made: new Date().toISOString(), hour: 0, used: 0 };
    saveKeys();
    return send(res, 201, { key, callsPerHour: PER_HOUR, note: 'Keep it in the Authorization header. It is free and carries no personal data.' });
  }
  if ((path === 'brief' || path === 'sonify') && req.method === 'POST') {
    const bad = checkKey(req);
    if (bad) return send(res, 401, { error: bad });
    const body = await readJson(req);
    if (path === 'brief') {
      const live = await loadLive(body.record || 'smoke', body.date || defaultDate());
      const out = describe(live);
      if (body.place) {
        out.place = readPlace(live, body.place);
        const a = around(live, body.place);
        if (a) out.around = { sentences: a.near.sentences, area: { south: a.box.south, north: a.box.north, west: a.box.west, east: a.box.east } };
      }
      return send(res, 200, out);
    }
    let levels, about = { source: 'your data' };
    if (body.record) { const live = await loadLive(body.record, body.date || defaultDate()); levels = live.levels; about = describe(live); }
    else { levels = levelsFromBody(body); about.briefing = E.brief(levels, { noun: body.noun || 'the value', unit: body.unit || '', grid: levels.grid, placeName: regionAt }).text; }
    const rec = body.record ? liveRecords().find((r) => r.id === body.record) : null;
    const snd = makeSound(levels, Number(body.seconds) || 12, { timbre: body.timbre || rec?.timbre, rhythm: body.rhythm || rec?.rhythm, voices: Number(body.voices) === 4 ? 4 : 8 });
    if ((req.headers.accept || '').includes('audio/wav')) {
      res.writeHead(200, { 'content-type': 'audio/wav', 'access-control-allow-origin': '*', 'x-earshot-correlation': String(snd.proof.correlation) });
      return res.end(Buffer.from(snd.wav));
    }
    return send(res, 200, { ...about, seconds: snd.seconds, proof: snd.proof, audio: { format: 'wav, 16-bit stereo, 22050 Hz', base64: Buffer.from(snd.wav).toString('base64') } });
  }
  return send(res, 404, { error: 'No such endpoint. Try GET /api/v1/records.' });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/v1/')) return await api(req, res, url.pathname.slice(8).replace(/\/$/, ''), url);
    if (url.pathname === '/feed.xml') {
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=900' });
      return res.end(await feed(req));
    }
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!rel || rel.endsWith(sep)) rel += 'index.html';
    const file = join(SITE, rel);
    if (!file.startsWith(SITE)) return send(res, 403, 'Forbidden', 'text/plain');
    const data = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    // Byte ranges: Safari will not play a video without them, and every browser uses them to seek.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start >= data.length || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${data.length}`, 'accept-ranges': 'bytes' });
        return res.end();
      }
      res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${data.length}`, 'accept-ranges': 'bytes' });
      return res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'accept-ranges': 'bytes' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return send(res, 404, 'Not found', 'text/plain');
    send(res, 400, { error: err.message });
  }
}).listen(PORT, () => console.log(`Earshot is running at http://localhost:${PORT}`));
