#!/usr/bin/env node
// Earshot MCP server. Lets an AI assistant read NASA's maps through Earshot.
// Speaks the Model Context Protocol over standard input and output. No packages.
//   { "mcpServers": { "earshot": { "command": "node", "args": ["mcp/earshot-mcp.mjs"] } } }
// Written with AI assistance (Claude). See README, "Use of AI".
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { liveRecords, recordInfo, loadLive, readPlace, describe, makeSound, defaultDate, around } from '../server/core.mjs';

const recordIds = liveRecords().map((r) => r.id);
const recordArg = { type: 'string', enum: recordIds, description: 'Which NASA map to read.' };
const dateArg = { type: 'string', description: 'Day as YYYY-MM-DD. Leave out for the newest complete day.' };

const TOOLS = [
  { name: 'list_records', description: 'List the NASA maps Earshot can read, what each measures, and its limits.', inputSchema: { type: 'object', properties: {} } },
  { name: 'describe_map', description: 'Plain-language briefing of one NASA map for one day: where the peak is, which latitude band is strongest, how much of the map has data, and what the product cannot tell you.', inputSchema: { type: 'object', properties: { record: recordArg, date: dateArg }, required: ['record'] } },
  { name: 'value_at', description: 'The reading over one place on one NASA map. Place is a large city name or "lat, lon". Says plainly when there is no data.', inputSchema: { type: 'object', properties: { record: recordArg, place: { type: 'string', description: 'City name, or "lat, lon".' }, date: dateArg }, required: ['record', 'place'] } },
  { name: 'sonify_map', description: 'Turn one NASA map into an eight-voice WAV file and report how faithfully the sound carries the map.', inputSchema: { type: 'object', properties: { record: recordArg, date: dateArg, out_path: { type: 'string', description: 'Where to write the .wav file.' }, seconds: { type: 'number', description: 'Sweep length, 4 to 30. Default 12.' } }, required: ['record', 'out_path'] } },
];

async function call(name, a = {}) {
  if (name === 'list_records') return { defaultDate: defaultDate(), records: liveRecords().map(recordInfo) };
  const live = await loadLive(a.record, a.date || defaultDate());
  if (name === 'describe_map') return describe(live);
  if (name === 'value_at') { const ar = around(live, a.place); return { record: live.rec.id, source: live.source, ...readPlace(live, a.place), around: ar ? ar.near.sentences : [], limits: live.rec.limits }; }
  if (name === 'sonify_map') {
    const snd = makeSound(live.levels, a.seconds || 12, { timbre: live.rec.timbre, rhythm: live.rec.rhythm });
    const file = resolve(a.out_path);
    await writeFile(file, snd.wav);
    return { wrote: file, seconds: snd.seconds, instrument: snd.instrument, proof: snd.proof, briefing: describe(live).briefing };
  }
  throw new Error('unknown tool ' + name);
}

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fail = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, 'parse error'); }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'earshot', version: '0.1.0' }, instructions: 'Earshot reads NASA maps of smoke, haze, rain and sea temperature. Always pass on the limits it returns. It is not a health warning or a forecast.' });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      try {
        const out = await call(params.name, params.arguments);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (err) {
        return reply(id, { isError: true, content: [{ type: 'text', text: err.message }] });
      }
    }
    return fail(id, -32601, 'method not found: ' + method);
  } catch (err) { fail(id, -32603, err.message); }
});
