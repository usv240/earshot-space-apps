// Written with AI assistance (Claude). See README, "Use of AI".
// Builds the sound track and the timing sheet for the 30-second demo video.
//   node tools/make-demo-audio.mjs <work-folder>
// Every sound is computed by the same engine as the site, from NASA's frames.
// The narration is a computer voice (Windows speech), not a person and not a generative model.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../site/engine/earshot.js';
import { EIC_RECORDS } from '../site/data/eic.js';
import { regionAt } from '../site/data/places.js';
import { decodePng } from '../server/png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = process.argv[2];
mkdirSync(work, { recursive: true });
const SR = 22050;

function read(rec, image) {
  const png = join(work, image.replace(/[\\/]/g, '_') + '.png');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(root, 'site', image), '-vf', 'scale=1024:512', '-pix_fmt', 'rgb24', png]);
  const img = decodePng(readFileSync(png));
  const scale = rec.stops ? E.scaleFromStops(rec.stops.map(([r, g, b, value]) => ({ r, g, b, value }))) : null;
  const f = E.decode(img.rgba, img.width, img.height, scale, { mode: rec.mode, mask: rec.mask, tolerance: rec.tolerance });
  const grid = E.toGrid(f.values, f.valid, img.width, img.height);
  return { f, grid, levels: E.toLevels(grid, rec.lo, rec.hi, 0.08, rec.curve), w: img.width, h: img.height };
}

// the sounds
const currents = EIC_RECORDS.find((r) => r.id === 'currents');
const lights = EIC_RECORDS.find((r) => r.id === 'nightlights');
const sea = read(currents, currents.image);
const first = read(lights, lights.frames[0]), last = read(lights, lights.frames[lights.frames.length - 1]);
const seaAudio = E.sonify(E.simplify(sea.levels), { seconds: 5, timbre: 'glass', sampleRate: SR });
// "Hear only what changed": the rise from 2012 to 2023, as the site plays it
const changeAudio = E.sonify(E.simplify(E.changeLevels(first.levels, last.levels)), { seconds: 4.5, timbre: 'brass', sampleRate: SR });

// the sentence the site itself speaks after playing the years in order
const fa = E.facts(first.levels, first.grid), fz = E.facts(last.levels, last.grid);
let up = null;
for (let b = 0; b < E.BANDS; b++) for (let c = 0; c < 72; c++) {
  if (!first.levels.known[b][c] || !last.levels.known[b][c]) continue;
  const d = last.levels.level[b][c] - first.levels.level[b][c];
  if (!up || d > up.d) up = { d, b, c };
}
const where = regionAt(E.peakLat(last.f.values, last.f.valid, last.w, last.h, up.b, up.c, 72), -180 + ((up.c + 0.5) / 72) * 360);
const rose = fz.mean >= fa.mean;
const change = `From 2012 to 2023, light at night ${rose ? 'rose' : 'fell'} across the map as a whole. The largest rise was over ${where}.`;
const changeSaid = `The largest rise in light at night, from 2012 to 2023, was over ${where}.`;

// the narration, as a computer voice
const lines = [
  'NASA shows our planet in pictures. Earshot lets you hear them.',
  changeSaid,
  'It can also play the area around your own city, every day.',
  'Built on published research with blind listeners. By Team U S V.',
];
function speak(text, i) {
  const out = join(work, `say${i}.wav`);
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 2; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(${SR}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile('${out.replace(/'/g, "''")}', $f); $s.Speak('${text.replace(/'/g, "''")}'); $s.Dispose()`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps]);
  const a = E.fromWav(new Uint8Array(readFileSync(out)));
  let pk = 0, end = 0;
  for (let k = 0; k < a.left.length; k++) { const v = Math.abs(a.left[k]); if (v > pk) pk = v; if (v > 0.01) end = k; }
  const n = Math.min(a.left.length, end + Math.floor(SR * 0.15));
  return { samples: a.left.subarray(0, n).map((v) => (v * 0.8) / (pk || 1)), seconds: n / SR };
}
const voice = lines.map(speak);

// the timeline
const scenes = [];
let t = 0.2;
const put = (kind, seconds, extra) => { scenes.push({ kind, start: +t.toFixed(3), seconds: +seconds.toFixed(3), ...extra }); t += seconds; };
put('title', voice[0].seconds + 0.25, { say: 0 });
put('sweep-sea', seaAudio.seconds + 0.2, { lead: seaAudio.lead, sweep: seaAudio.sweep, audio: 'sea' });
put('sweep-change', changeAudio.seconds + 0.2, { lead: changeAudio.lead, sweep: changeAudio.sweep, audio: 'change' });
put('change', voice[1].seconds + 0.25, { say: 1, text: change });
put('area', voice[2].seconds + 0.6, { say: 2 });
put('end', voice[3].seconds + 0.6, { say: 3 });
const total = t;
if (total > 29.8) throw new Error(`the video would run ${total.toFixed(2)} seconds; the limit is 30`);

const n = Math.ceil(total * SR);
const left = new Float32Array(n), right = new Float32Array(n);
const clips = { sea: seaAudio, change: changeAudio };
for (const s of scenes) {
  const at = Math.floor(s.start * SR);
  if (s.audio) { const a = clips[s.audio]; for (let k = 0; k < a.left.length && at + k < n; k++) { left[at + k] += a.left[k]; right[at + k] += a.right[k]; } }
  if (s.say !== undefined) { const v = voice[s.say].samples; for (let k = 0; k < v.length && at + k < n; k++) { left[at + k] += v[k]; right[at + k] += v[k]; } }
}
writeFileSync(join(work, 'demo.wav'), E.toWav({ left, right, sampleRate: SR }, { app: 'Earshot', title: 'Earshot demo sound track', made: 'Sweeps computed from NASA data by Earshot. Narration is a computer voice. Assembled by a script written with AI assistance.' }));
writeFileSync(join(work, 'demo.json'), JSON.stringify({ total: +total.toFixed(3), scenes, lines, change, frames: { sea: currents.image, y2012: lights.showFrames[0], y2023: lights.showFrames[lights.showFrames.length - 1] }, changeSaid }, null, 2));
console.log(`sound track ${total.toFixed(2)} s`); console.log(change);
for (const s of scenes) console.log(s.kind.padEnd(11), s.start.toFixed(2), '+', s.seconds.toFixed(2));
