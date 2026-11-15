// Written with AI assistance (Claude). See README, "Use of AI".
// Earshot's own checks. Run from the project folder:
//   node test/roundtrip.test.mjs
// It exits with an error if any check fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng } from '../server/png.mjs';
import * as E from '../site/engine/earshot.js';
import { RECORDS } from '../site/data/records.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
}
const quieter = (a, k) => ({ ...a, left: a.left.map((v) => v * k), right: a.right.map((v) => v * k) });

// 1. Every saved NASA map: colours match NASA's table exactly, and the sound
//    gives the map back at three sweep lengths, through a 16-bit WAV file,
//    at reduced volume, and with four voices.
for (const rec of RECORDS.filter((r) => r.kind === 'live')) {
  const img = decodePng(readFileSync(join(root, 'site/records/live', rec.id + '.png')));
  const scale = E.parseGibsColormap(readFileSync(join(root, 'site/records/live', rec.id + '.xml'), 'utf8'));
  const raw = E.decode(img.rgba, img.width, img.height, scale, {});
  check(`${rec.id}: every data pixel matches NASA's colour table exactly`, raw.exactShare === 1, (raw.exactShare * 100).toFixed(2) + ' percent');
  const f = E.decode(img.rgba, img.width, img.height, scale, { emptyIsZero: rec.emptyIsZero });
  const grid = E.toGrid(f.values, f.valid, img.width, img.height);
  const levels = E.toLevels(grid, rec.lo, rec.hi, 0.08, rec.curve);
  for (const seconds of [8, 12, 24]) {
    const audio = E.sonify(levels, { seconds, timbre: rec.timbre, rhythm: rec.rhythm, gain: rec.gain });
    const heard = E.listenBack(E.fromWav(E.toWav(audio)));
    const c = E.compare(levels, heard);
    check(`${rec.id}: ${seconds} s sweep comes back from a WAV file`, c.r > 0.995 && c.meanError < 0.01 && heard.timbre === rec.timbre,
      `${c.cells} cells, match ${c.r.toFixed(4)}, mean error ${(c.meanError * 100).toFixed(2)} percent`);
  }
  const audio = E.sonify(levels, { timbre: rec.timbre, rhythm: rec.rhythm });
  const quiet = E.compare(levels, E.listenBack(quieter(audio, 0.4)));
  check(`${rec.id}: still comes back at 40 percent volume`, quiet.r > 0.995, quiet.r.toFixed(4));
  const four = E.simplify(levels);
  const c4 = E.compare(four, E.listenBack(E.sonify(four, { timbre: rec.timbre, rhythm: rec.rhythm })));
  check(`${rec.id}: four-voice setting comes back`, c4.r > 0.995, c4.r.toFixed(4));
  const b = E.brief(levels, { noun: rec.noun, unit: rec.unit, grid, words: rec.words });
  check(`${rec.id}: the briefing never reports a peak below the true cell value`, !(b.facts.peak.value > levels.hi) || /above the top/.test(b.text));
}

// 2. A hard case for every instrument: a random map with gaps and a rhythm on top.
for (const timbre of Object.keys(E.TIMBRES)) {
  let s = 1;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const levels = { cols: 72, lo: 0, hi: 1, curve: 'linear', level: Array.from({ length: 8 }, () => Float32Array.from({ length: 72 }, rnd)), known: Array.from({ length: 8 }, () => new Uint8Array(72).fill(1)) };
  for (let i = 0; i < 60; i++) { levels.known[i % 8][(i * 7) % 72] = 0; levels.level[i % 8][(i * 7) % 72] = 0; }
  const c = E.compare(levels, E.listenBack(E.sonify(levels, { timbre, rhythm: 'crackle' })));
  check(`${timbre}: random map with gaps and a crackle comes back`, c.r > 0.99, `match ${c.r.toFixed(4)}, mean error ${(c.meanError * 100).toFixed(2)} percent`);
}

// 3. An empty picture (a day NASA has not published) is recognised as empty.
{
  const blank = new Uint8Array(64 * 32 * 4);
  const scale = E.parseGibsColormap(readFileSync(join(root, 'site/records/live/rain.xml'), 'utf8'));
  check('an empty picture has no matched pixels, so it is never read as a dry planet', E.decode(blank, 64, 32, scale, {}).matchedShare === 0);
}

// 4. Fixed volume: a map with half as much sounds quieter, not the same.
{
  const mk = (k) => ({ cols: 72, lo: 0, hi: 1, curve: 'linear', level: Array.from({ length: 8 }, () => new Float32Array(72).fill(k)), known: Array.from({ length: 8 }, () => new Uint8Array(72).fill(1)) });
  const rms = (a) => Math.sqrt(a.left.reduce((t, v) => t + v * v, 0) / a.left.length);
  const loud = E.sonify(mk(0.8), { gain: 0.08 }), soft = E.sonify(mk(0.2), { gain: 0.08 });
  check('with a fixed volume, a fuller map is louder than an emptier one', rms(loud) > rms(soft) * 1.5, `${rms(loud).toFixed(3)} against ${rms(soft).toFixed(3)}`);
}

// 5. Tables from outside sources: the value column is found, quoted commas survive.
{
  const quake = 'time,latitude,longitude,depth,mag,place\n2026-11-13T10:00:00Z,35.2,-80.8,10,2.1,"10 km S of Somewhere, NC"\n2026-11-13T11:00:00Z,38.3,142.4,30,7.1,"off the coast, Japan"\n2026-11-13T12:00:00Z,-33.4,-70.6,50,5.8,"Chile"\n';
  const pts = E.parsePointsCsv(quake);
  check('earthquake-style table: reads "mag", not longitude', pts.valueName === 'mag' && pts.length === 3 && pts[1].value === 7.1, `value column "${pts.valueName}"`);
  const semi = E.parsePointsCsv('city;pm25;lat;lng\nDelhi;180;28.6;77.2\nLima;30;-12;-77\nOslo;6;59.9;10.7\n');
  check('semicolon table with columns in another order', semi.length === 3 && semi[0].value === 180 && semi[0].lat === 28.6);
  const picked = E.parsePointsCsv('latitude,longitude,bright_ti4,frp\n1,2,300,5\n3,4,310,9\n5,6,320,2\n', { value: 'bright_ti4' });
  check('a chosen value column is respected', picked.valueName === 'bright_ti4' && picked[0].value === 300);
}

// 6. A sound file is a map: the note inside it survives, and a file folded to one channel still gives the map back.
{
  let s2 = 5;
  const rnd = () => (s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0) / 4294967296;
  const levels = { cols: 72, lo: 0, hi: 1, curve: 'linear', level: Array.from({ length: 8 }, () => Float32Array.from({ length: 72 }, rnd)), known: Array.from({ length: 8 }, () => new Uint8Array(72).fill(1)) };
  const audio = E.sonify(levels, { timbre: 'reed' });
  const back = E.fromWav(E.toWav(audio, { title: 'Test map', unit: 'degrees', lo: 0, hi: 32, note: 'caf\u00e9' }));
  check('the note stored in a sound file comes back intact', back.meta && back.meta.title === 'Test map' && back.meta.hi === 32 && back.meta.note === 'caf\u00e9');
  const c = E.compare(levels, E.listenBack(back));
  check('a sound file with a note still gives the map back', c.r > 0.99, c.r.toFixed(4));
  const holes = { ...levels, known: levels.known.map((row, b) => row.map((k, c) => ((b * 7 + c) % 5 === 0 ? 0 : 1))) };
  const text = E.gapsToText(holes);
  let same = true;
  for (let b = 0; b < 8; b++) for (let c = 0; c < 72; c++) if (E.gapAt(text, 8, 72, b, c) !== !holes.known[b][c]) same = false;
  check('the list of gaps stored in the note comes back exactly', same && !E.gapAt('', 8, 72, 0, 0));
  const folded = { ...audio, left: audio.left.map((v, i) => (v + audio.right[i]) / 2) };
  folded.right = folded.left;
  const heard = E.listenBack(folded), cm = E.compare(levels, heard);
  check('a file folded down to one channel still gives the map back', heard.mono && cm.r > 0.99, cm.r.toFixed(4));
}

// 7. The area around one place: the right cells, distance and direction, and the chime does not disturb the check.
{
  const w = 360, h = 180, values = new Float32Array(w * h), valid = new Uint8Array(w * h).fill(1);
  // one hot spot at 45 N, 70 W (north-east of Charlotte, 35.2 N 80.8 W)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lat = 90 - (y + 0.5), lon = -180 + (x + 0.5);
    values[y * w + x] = Math.exp(-((lat - 45) ** 2 + (lon + 70) ** 2) / 8);
  }
  const box = E.areaBox(35.2, -80.8);
  const grid = E.areaGrid(values, valid, w, h, box);
  const levels = E.toLevels(grid, 0, 1, 0.08, 'linear');
  const near = E.nearby(levels, grid, { name: 'Charlotte', noun: 'smoke', unit: 'units' });
  check('the area finds a hot spot to the north-east of Charlotte', near.peak && /north-east/.test(near.text) && near.peak.km > 1000 && near.peak.km < 1700, near.sentences[0]);
  check('the distance between Charlotte and New York is about 850 km', Math.abs(E.distanceKm(35.2, -80.8, 40.7, -74.0) - 855) < 30);
  const wrap = E.areaGrid(values, valid, w, h, E.areaBox(0, 175));
  check('an area across the date line is read from both edges of the map', wrap.cover.every((row) => row.every((v) => v > 0.99)));
  const audio = E.sonify(levels, { timbre: 'reed', marker: { at: 0.5 } });
  const c = E.compare(levels, E.listenBack(audio, levels.cols));
  check('the chime for "you are here" does not disturb the check', c.r > 0.99, c.r.toFixed(4));
}

// 8. "What changed" uses a fixed scale, and one band at a time plays only that band.
{
  const mk = (f) => ({ cols: 72, lo: 0, hi: 1, curve: 'linear', level: Array.from({ length: 8 }, (_, b) => Float32Array.from({ length: 72 }, (_, c) => f(b, c))), known: Array.from({ length: 8 }, () => new Uint8Array(72).fill(1)) });
  const before = mk(() => 0.30), after = mk((b, c) => (b === 5 && c > 50 && c < 60 ? 0.33 : 0.30));
  const big = mk((b, c) => (b === 5 && c > 50 && c < 60 ? 0.70 : 0.30));
  const small = E.changeLevels(before, after), large = E.changeLevels(before, big);
  check('in the change sound a small rise is quiet, a large rise is full, and no change is silent',
    Math.abs(small.level[5][55] - 0.09) < 0.001 && large.level[5][55] === 1 && small.level[2][10] === 0,
    `a rise of 0.03 plays at ${small.level[5][55].toFixed(2)}, a rise of 0.40 at ${large.level[5][55].toFixed(2)}`);
  const one = E.onlyBand(E.simplify(before), 2);
  check('one band at a time silences the other bands without hiss', one.level[0].every((v) => v === 0) && one.known[0].every((k) => k === 1) && one.level[2][0] > 0);
  const joined = E.joinAudio([0, 1, 2, 3].map((k) => E.sonify(E.onlyBand(E.simplify(before), k), { seconds: 2 })));
  check('the four single-band sweeps join into one clip', joined.parts.length === 4 && Math.abs(joined.seconds - (4 * (2 + 0.45) + 1.5)) < 0.05, joined.seconds.toFixed(2) + ' s');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
