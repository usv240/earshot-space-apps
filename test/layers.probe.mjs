// Written with AI assistance (Claude). See README, "Use of AI".
// Probe live NASA GIBS layers: coverage, colour-match rate and round-trip quality.
import { decodePng } from '../server/png.mjs';
import * as E from '../site/engine/earshot.js';
const W = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE';
const date = process.argv[2];
const layers = process.argv.slice(3).map((s) => s.split('|'));
for (const [layer, cmap, lo, hi] of layers) {
  try {
    const [img, xml] = await Promise.all([
      fetch(`${W}&LAYERS=${layer}&TIME=${date}`).then((r) => r.arrayBuffer()),
      fetch(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${cmap}`).then((r) => r.text()),
    ]);
    const png = decodePng(Buffer.from(img));
    const scale = E.parseGibsColormap(xml);
    const f = E.decode(png.rgba, png.width, png.height, scale);
    const live = scale.filter((e) => !e.nodata);
    const g = E.toGrid(f.values, f.valid, png.width, png.height);
    const lv = E.toLevels(g, Number(lo), Number(hi));
    const cmp = E.compare(lv, E.listenBack(E.sonify(lv)));
    console.log(`${layer} | bytes ${img.byteLength} | scale ${live.length} entries ${live[0].lo}..${live[live.length - 1].hi} | data ${(f.matchedShare * 100).toFixed(1)}% exact ${(f.exactShare * 100).toFixed(1)}% | cells ${cmp.cells}/576 | r ${cmp.r.toFixed(4)} err ${(cmp.meanError * 100).toFixed(2)}%`);
  } catch (e) { console.log(layer, 'ERR', String(e).slice(0, 120)); }
}
