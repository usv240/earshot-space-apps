// Written with AI assistance (Claude). See README, "Use of AI".
// Saves one day of each live NASA layer plus its colour table into site/records/live,
// so the site still works when NASA's map service cannot be reached.
import { writeFileSync } from 'node:fs';
const date = process.argv[2];
const W = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE';
const items = [
  ['smoke', 'OMPS_NOAA21_NadirMapper_AerosolIndex_380', 'OMPS_Aerosol_Index.xml'],
  ['haze', 'VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean', 'MODIS_VIIRS_AOD.xml'],
  ['rain', 'IMERG_Precipitation_Rate', 'GPM_Precipitation_Rate.xml'],
  ['sea', 'GHRSST_L4_MUR_Sea_Surface_Temperature', 'GHRSST_Sea_Surface_Temperature.xml'],
  ['coast', 'Coastlines_15m', null],
];
for (const [id, layer, cmap] of items) {
  const r = await fetch(`${W}&LAYERS=${layer}&TIME=${date}`);
  const b = Buffer.from(await r.arrayBuffer());
  console.log(id, r.status, r.headers.get('content-type'), b.length);
  if (r.ok && String(r.headers.get('content-type')).includes('png')) writeFileSync(`site/records/live/${id}.png`, b);
  if (cmap) {
    const x = await fetch(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${cmap}`).then((q) => q.text());
    writeFileSync(`site/records/live/${id}.xml`, x);
    const units = /units="([^"]*)"/.exec(x);
    console.log('   colour table', x.length, 'units', units ? units[1] : '(none)');
  }
}
