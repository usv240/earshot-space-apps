// Written with AI assistance (Claude). See README, "Use of AI".
// The jukebox's records. "live" records are fetched from NASA GIBS for a chosen
// day and decoded with NASA's own colour table. "picture" records are frames
// from NASA's Earth Information Center, decoded from the picture's legend.

export const GIBS_WMS =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0' +
  '&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=1024&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE';
export const GIBS_COLORMAPS = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/';

export const RECORDS = [
  {
    id: 'rain',
    kind: 'live',
    title: 'Rain, latest day',
    most: 'The heaviest rain',
    timbre: 'choir', rhythm: 'patter', gain: 0.21,
    // words for a rain rate in millimetres per hour
    words: [[0.1, 'almost none'], [0.5, 'very light'], [2.5, 'light'], [7.6, 'moderate'], [50, 'heavy'], [Infinity, 'violent']],
    noun: 'rainfall',
    layer: 'IMERG_Precipitation_Rate',
    colormap: 'GPM_Precipitation_Rate.xml',
    lo: 0.1, hi: 30, curve: 'log', emptyIsZero: true,
    unit: 'millimetres per hour',
    source: 'IMERG from the Global Precipitation Measurement mission, served by NASA GIBS',
    about: 'How hard it was raining or snowing at midnight UTC on the chosen day, estimated from a fleet of satellites. Quiet means dry, and the patter speeds up where it is wet.',
    describe: 'The picture is a world map that is mostly empty. Rain shows as scattered green and yellow streaks: a broken belt along the equator, and long curved bands in the middle latitudes where storms are passing.',
    limits: [
      'This is one moment of the chosen day, not the daily total, and it is not a forecast. The newest day NASA has published is usually one or two days old.',
      'Each value is an average over an area hundreds of kilometres across. A local downpour is far heavier than the number you hear.',
      'A silent stretch means less than 0.1 millimetres per hour, or no estimate. The picture cannot tell those two apart, which matters most near the poles.',
    ],
    field: 'green',
  },
  {
    id: 'smoke',
    kind: 'live',
    title: 'Smoke and dust',
    most: 'The most smoke and dust',
    timbre: 'reed', gain: 0.15,
    words: [[0.5, 'very little'], [1, 'slight'], [2, 'moderate'], [4, 'heavy'], [Infinity, 'extreme']],
    noun: 'smoke and dust',
    layer: 'OMPS_NOAA21_NadirMapper_AerosolIndex_380',
    colormap: 'OMPS_Aerosol_Index.xml',
    lo: 0, hi: 4, curve: 'linear',
    unit: 'on the aerosol index',
    source: 'OMPS Nadir Mapper on the NOAA-21 satellite, served by NASA GIBS',
    oceanCaveat: 'That spot is open ocean, where this index is often fooled by sunlight glinting off the water, so treat this peak with doubt.',
    about: 'An index of smoke, dust and ash floating in the air, measured from orbit once a day. Higher means more particles that absorb sunlight.',
    describe: 'The picture is a world map in pale greys with patches of yellow, orange and red where smoke or desert dust hangs in the air, most often over the Sahara, central Africa and wherever large fires are burning.',
    limits: [
      'This index measures particles through the whole depth of the air. It does not tell you what you are breathing at ground level.',
      'The satellite passes once a day, so the picture is a snapshot from that pass.',
      'Over open ocean, sunlight glinting off the water can fool this index. It shows as a row of evenly spaced streaks along one latitude, one for each orbit. A peak over open ocean may be glint, not smoke.',
    ],
    field: 'coral',
  },
  {
    id: 'haze',
    kind: 'live',
    title: 'Haze',
    most: 'The haziest air',
    timbre: 'string', gain: 0.19,
    words: [[0.1, 'clear air'], [0.3, 'slightly hazy'], [0.5, 'hazy'], [1, 'very hazy'], [Infinity, 'extremely hazy']],
    noun: 'haze',
    layer: 'VIIRS_NOAA20_AOD_Deep_Blue_Land_Ocean',
    colormap: 'MODIS_VIIRS_AOD.xml',
    lo: 0, hi: 1, curve: 'linear',
    unit: 'aerosol optical depth',
    source: 'VIIRS on the NOAA-20 satellite (Deep Blue aerosol optical depth), served by NASA GIBS',
    about: 'How much the air dims sunlight because of fine particles. Zero is perfectly clear. Above about 0.5 the sky looks hazy.',
    describe: 'The picture is a world map in stripes, because the satellite sees the planet in strips as it orbits. Clear air is pale yellow; haze deepens to orange and dark red. Large white gaps are cloud, where the instrument could not see the ground.',
    limits: [
      'The instrument cannot see through cloud, so cloudy places have no reading that day.',
      'It measures the whole column of air, not the air at street level.',
    ],
    field: 'yellow',
  },
  {
    id: 'sea',
    kind: 'live',
    title: 'Sea temperature',
    most: 'The warmest water',
    timbre: 'glass', gain: 0.09,
    words: [[2, 'near freezing'], [10, 'cold'], [18, 'cool'], [24, 'mild'], [28, 'warm'], [Infinity, 'very warm']],
    noun: 'sea surface temperature',
    layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    colormap: 'GHRSST_Sea_Surface_Temperature.xml',
    lo: -2, hi: 32, curve: 'linear',
    unit: 'degrees Celsius',
    source: 'GHRSST MUR sea surface temperature analysis, served by NASA GIBS',
    about: 'The temperature of the top of the ocean, blended from several satellites. Louder means warmer water.',
    describe: 'The picture is a world map with the land left blank. The oceans run from deep blue and purple near the poles, through green, to orange and red in a broad warm belt around the equator.',
    limits: [
      'Land has no value on this record, so the voices thin out over continents.',
      'This is the skin of the ocean, not the water below it.',
    ],
    field: 'coral',
  },
  {
    id: 'pm25',
    kind: 'picture',
    title: 'Fine particles',
    most: 'The worst fine-particle pollution',
    timbre: 'reed', svs: 5151,
    words: [[5, 'clean'], [15, 'moderate'], [35, 'polluted'], [75, 'heavily polluted'], [Infinity, 'hazardous']],
    noun: 'fine particle pollution',
    image: 'records/pm25.jpg',
    date: 'frame stamped 15 August 2023',
    lo: 1, hi: 150, curve: 'log',
    unit: 'micrograms per cubic metre',
    tolerance: 46,
    // corner labels printed on the frame: [x0, y0, x1, y1] in a 1024 x 512 frame
    mask: [[0, 0, 182, 38], [0, 458, 254, 512]],
    source: 'NASA Earth Information Center, "Particulate Matter (PM) 2.5", GEOS-CF model (SVS 5151)',
    about: 'Fine particles near the ground from NASA’s GEOS-CF model, as shown on the Earth Information Center wall. This is the kind of pollution that harms lungs.',
    describe: 'The picture is a world map drawn entirely in shades of cream, orange and brown, over land and sea alike. Pale cream means clean air, which covers most of the open oceans. The colour deepens to orange and dark brown where fine particles are thick: in this frame over Siberia and Canada, where forests were burning, and over central Africa and south Asia.',
    limits: [
      'This is a model estimate for one hour in August 2023, read back from the colours of a picture.',
      'Coastlines drawn on the picture are skipped, which leaves thin gaps.',
    ],
    // legend colours sampled from NASA's colour bar for this visualization (log scale)
    stops: [[255,254,246,0.4],[255,245,185,0.48],[254,237,167,0.57],[254,224,137,0.68],[254,214,118,0.81],[254,199,85,0.97],[254,187,71,1.16],[254,175,60,1.39],[254,162,49,1.66],[253,151,40,1.98],[248,139,35,2.37],[245,133,31,2.83],[241,123,26,3.38],[238,117,22,4.03],[232,108,18,4.82],[228,103,16,5.75],[222,96,12,6.87],[218,91,10,8.21],[212,85,6,9.8],[206,78,3,11.71],[201,75,2,13.99],[197,73,2,16.71],[189,69,3,19.96],[183,66,3,23.84],[177,64,3,28.48],[171,60,3,34.02],[166,58,4,40.64],[158,55,4,48.54],[154,52,4,57.98],[148,51,4,69.26],[144,50,4,82.73],[139,48,5,98.82],[135,47,5,118.05],[130,45,5,141.01],[125,44,5,168.43],[121,43,5,201.19],[116,41,5,240.32],[113,40,6,287.07],[107,39,6,342.9],[104,38,6,409.6]],
    field: 'yellow',
  },
];

export function gibsUrl(layer, date) {
  return `${GIBS_WMS}&LAYERS=${layer}&TIME=${date}`;
}

// Yesterday in UTC: the newest day that every live layer has finished.
export function defaultDate(now = new Date()) {
  const d = new Date(now.getTime() - 36 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
