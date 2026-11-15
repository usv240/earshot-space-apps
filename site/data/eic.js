// Earth Information Center records: flat world-map frames from visualizations
// that NASA's Scientific Visualization Studio (SVS) made for the Earth
// Information Center, as listed in the challenge brief.
//
// This file was written with AI assistance (Claude, by Anthropic). The frames in
// site/records/eic/ are NASA's own pictures, resized to 1024 x 512. Where a
// frame was changed, the record's "limits" say exactly how.
//
// Schema: the same as the picture records in records.js, plus
//   svs          the SVS visualization id
//   page         the NASA page for it
//   credits      the people NASA credits
//   listed       true when the id is on the challenge brief's list
//   frames       every frame of the sequence, in time order (image = default frame)
//   frameLabels  what period each frame shows
//   frameNote    used in place of frameLabels when NASA gives no date for the frames
//   noValue      true when the number itself means nothing to a listener (leave it out of sentences)
//   showFrames   optional: NASA's untouched frames, for display only
//   describe     what the picture looks like, for someone who cannot see it
//   group, track optional: records that are tracks of one picture

const seq = (id, n, stem = 'f') => Array.from({ length: n }, (_, i) => `records/eic/${id}/${stem}${String(i + 1).padStart(2, '0')}.jpg`);

// A legend colour also appears darker where the picture draws thin lines on
// black, so each legend stop is repeated at several brightness levels.
const shaded = (stops, levels) => levels.flatMap((k) => stops.map(([r, g, b, v]) => [Math.round(r * k), Math.round(g * k), Math.round(b * k), v]));

// A colour ramp from dim to full for one swatch of a legend that has no numbers.
const ramp = (rgb, from = 0.3, steps = 15) => Array.from({ length: steps }, (_, i) => {
  const t = from + ((1 - from) * i) / (steps - 1);
  return [Math.round(rgb[0] * t), Math.round(rgb[1] * t), Math.round(rgb[2] * t), +t.toFixed(3)];
});
const zero = (list) => list.map(([r, g, b]) => [r, g, b, 0]);

// Sea surface temperature legend of SVS 3912, sampled every degree along NASA's colour bar.
const SST_LEGEND = [[52,92,250,0],[51,109,238,1],[50,125,227,2],[50,140,215,3],[50,154,204,4],[50,169,192,5],[51,183,180,6],[52,195,169,7],[53,209,158,8],[54,221,147,9],[56,232,135,10],[58,244,123,11],[59,252,113,12],[60,255,102,13],[62,255,93,14],[68,255,81,15],[79,255,71,16],[99,255,61,17],[124,255,51,18],[150,255,44,19],[179,255,38,20],[204,255,35,21],[229,255,34,22],[248,255,33,23],[251,248,33,24],[250,226,31,25],[250,202,30,26],[249,172,28,27],[248,138,27,28],[247,106,26,29],[247,65,25,30],[247,18,24,31],[247,0,24,32]];

// The four swatches of the GEOS aerosol legend (SVS 5669), read from NASA's legend picture.
const AEROSOL = { smoke: [210, 94, 69], dust: [193, 154, 220], salt: [133, 170, 169], sulfate: [83, 220, 52] };
// Colours in that picture that are not an aerosol: night sea, land shading, ice.
const AEROSOL_GROUND = [[4, 8, 8], [22, 24, 24], [45, 47, 47], [62, 69, 61], [92, 96, 92]];
const aerosolStops = (kind) => [
  ...ramp(AEROSOL[kind]),
  ...Object.keys(AEROSOL).filter((k) => k !== kind).flatMap((k) => zero(ramp(AEROSOL[k]))),
  ...zero(AEROSOL_GROUND),
];
const AEROSOL_COMMON = {
  kind: 'picture', svs: 5669, listed: true, group: 'aerosols',
  page: 'https://svs.gsfc.nasa.gov/5669/',
  credits: 'Visualization by Joseph V. Ardizzone and Helen-Nicole Kostis, with scientific consulting by Lesley Ott, NASA Goddard Space Flight Center. Data: NASA GEOS model.',
  image: 'records/eic/5669/f01.jpg',
  frames: ['records/eic/5669/f01.jpg'],
  frameLabels: ['19 August 2025, 20:00 UTC'],
  legend: 'records/eic/5669/legend.png',
  date: '19 August 2025',
  lo: 0, hi: 0.6, curve: 'linear', tolerance: 60,
  unit: 'on a scale from 0 to 1',
  describe: 'A dark world map covered in glowing swirls. A wide pink and violet river of dust leaves the Sahara and crosses the Atlantic. Orange and red smoke sits over central Africa, bright green sulfate haze winds across the northern oceans and Asia, and pale blue-grey sea salt spirals around the storms of the Southern Ocean.',
};
const aerosolTrack = (id, track, title, noun, colourWord, about, field) => ({
  ...AEROSOL_COMMON, id, track, title, noun, about, field,
  stops: aerosolStops(track),
  source: `NASA Earth Information Center, "GEOS Aerosols (2025)" (SVS 5669), the ${colourWord} layer`,
  limits: [
    'NASA\'s legend for this picture names four colours and gives no numbers, so this is only how strongly the ' + colourWord + ' colour shows, not an amount.',
    'Where two kinds of particle overlap, the colours mix and the reading goes to whichever colour is nearest.',
  ],
});

export const EIC_RECORDS = [
  {
    id: 'nightlights',
    kind: 'picture',
    svs: 5313, listed: true,
    page: 'https://svs.gsfc.nasa.gov/5313/',
    title: 'Night lights',
    noun: 'light at night',
    credits: 'Visualization by Kel Elkins (USRA), NASA Scientific Visualization Studio. Scientists: Zhuosen Wang, Miguel Román, Ranjay Shrestha, Srija Chakraborty and Virginia Kalb. Data: NASA Black Marble.',
    image: 'records/eic/5313/f12.jpg',
    frames: seq(5313, 12),
    showFrames: seq(5313, 12, 'show'),
    frameLabels: ['2012', '2013', '2014', '2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023'],
    date: '2012 to 2023, one frame a year',
    mode: 'brightness', lo: 0.002, hi: 0.12, curve: 'log', noValue: true,
    unit: 'relative brightness',
    source: 'NASA Earth Information Center, "Change in Night Lights between 2012 and 2023" (SVS 5313), from NASA Black Marble',
    about: 'The lights people leave on at night, as a yearly average seen from orbit, from 2012 to 2023. Louder means more light. Play the years in order to hear places grow brighter.',
    describe: 'A black world map with the land barely visible. Tiny points of warm light trace where people live: the eastern United States, Europe, the Nile, India and the coast of China glow, while the oceans, the Sahara, the Amazon and Siberia stay dark. From 2012 to 2023 India and China grow visibly brighter.',
    limits: [
      'NASA\'s frame draws the lights on a grey shaded map. The grey land shading and the printed year were removed so that brightness means light only. The picture shown on this page is NASA’s untouched frame.',
      'Brightness is read from a picture, so it shows where and roughly how much, not a measured radiance.',
    ],
    field: 'yellow',
  },
  {
    id: 'currents',
    kind: 'picture',
    svs: 3912, listed: true,
    page: 'https://svs.gsfc.nasa.gov/3912/',
    title: 'Ocean currents',
    noun: 'sea surface temperature along the currents',
    credits: 'Animation by Greg Shirah, Horace Mitchell and Eric Sokolowsky, NASA Scientific Visualization Studio. Scientists: Hong Zhang and Dimitris Menemenlis. Data: ECCO2 ocean model (MIT and NASA JPL).',
    image: 'records/eic/3912/f04.jpg',
    frames: seq(3912, 12),
    frameLabels: ['25 March 2007', '15 April 2007', '15 May 2007', '15 June 2007', '15 July 2007', '15 August 2007', '15 September 2007', '15 October 2007', '15 November 2007', '15 December 2007', '15 January 2008', '15 February 2008'],
    legend: 'records/eic/3912/legend.png',
    date: 'March 2007 to February 2008, one frame a month',
    lo: 0, hi: 32, curve: 'linear', tolerance: 30,
    stops: shaded(SST_LEGEND, [1, 0.82, 0.66, 0.52, 0.4, 0.3]),
    unit: 'degrees Celsius',
    source: 'NASA Earth Information Center, "Global Sea Surface Currents and Temperature" (SVS 3912), ECCO2 model',
    about: 'The surface currents of the ocean, drawn as thousands of flowing lines and coloured by the temperature of the water. Louder means warmer. Play the months in order to hear the warm water follow the sun.',
    describe: 'A world map with dark grey land and an ocean made of fine swirling threads. The threads are red and orange in a warm belt around the equator, yellow and green in the middle latitudes, and blue near the poles. The Gulf Stream and the Kuroshio show as bright curling ribbons leaving the coasts of North America and Japan.',
    limits: [
      'The colour gives the temperature. The shape and speed of the currents are in the picture but are not turned into sound.',
      'Temperatures are read from colours against NASA\'s colour bar, which runs from 0 to 32 degrees Celsius, so they are estimates. This is a model of 2007 and 2008, not a measurement of today.',
    ],
    field: 'coral',
  },
  aerosolTrack('aerosol-dust', 'dust', 'Aerosols: dust', 'desert dust', 'pink',
    'Desert dust lifted into the air, from NASA\'s GEOS model for one moment in August 2025. Louder means the dust colour shows more strongly.', 'yellow'),
  aerosolTrack('aerosol-smoke', 'smoke', 'Aerosols: smoke', 'smoke from fires', 'orange and red',
    'Smoke and soot from fires, from NASA\'s GEOS model for one moment in August 2025. Louder means the smoke colour shows more strongly.', 'coral'),
  aerosolTrack('aerosol-sulfate', 'sulfate', 'Aerosols: sulfate', 'sulfate haze', 'green',
    'Sulfate haze from pollution and volcanoes, from NASA\'s GEOS model for one moment in August 2025. Louder means the sulfate colour shows more strongly.', 'green'),
  aerosolTrack('aerosol-salt', 'salt', 'Aerosols: sea salt', 'sea salt spray', 'blue-grey',
    'Sea salt thrown into the air by wind and waves, from NASA\'s GEOS model for one moment in August 2025. Louder means the sea salt colour shows more strongly.', 'green'),
  {
    id: 'lightning-year',
    south: -55, north: 55, // what the Lightning Imaging Sensor can see from the station's orbit
    kind: 'picture',
    svs: 5011, listed: true,
    page: 'https://svs.gsfc.nasa.gov/5011/',
    title: 'Lightning through a year',
    noun: 'lightning',
    credits: 'Visualization by Michala Garrison, Greg Shirah, Kel Elkins and Alex Kekesi, NASA Scientific Visualization Studio. Data: Lightning Imaging Sensor on the International Space Station.',
    image: 'records/eic/5011/f07.jpg',
    frames: seq(5011, 12),
    frameNote: 'Twelve evenly spaced frames, from about the middle of 2022 to about the middle of 2023. NASA prints no dates on this movie, so the frames carry no month labels.',
    date: 'about mid 2022 to mid 2023, twelve frames',
    mode: 'spark', curve: 'linear', lo: 0, hi: 0.1, emptyIsZero: true,
    unit: 'share of the area flashing',
    source: 'NASA Earth Information Center, "Lightning Events Detected from the International Space Station 2017-2023" (SVS 5011)',
    about: 'Every yellow dot is lightning seen by the Lightning Imaging Sensor on the International Space Station. Louder means more flashes. Play the frames in order to hear the storms swing from the northern summer to the southern summer and back.',
    describe: 'A dark grey world map sprinkled with small yellow dots. The dots crowd over central Africa, the Amazon and the islands of Southeast Asia. In the northern summer they spread up over North America, Europe and India, and in the southern summer they sink back toward southern Africa, South America and northern Australia.',
    limits: [
      'NASA\'s movie covers March 2017 to July 2023 and prints no date on its frames. The year was worked out by counting the seasonal swings in the movie, so it is an estimate.',
      'The space station only sees between about 55 degrees south and 55 degrees north. The polar bands are therefore missing. With eight voices a hiss marks them; with four, the far-south and far-north voices are read from the part the station does see. Values are read from dots in a picture, so they show where lightning clusters, not an exact count.',
    ],
    field: 'green',
  },
];

// The sonification NASA lists in the brief as an example. Earshot's sweep with
// position mapped to pitch belongs to the same family, so it is cited here.
export const CALDWELL = {
  svs: 13786,
  title: 'Data Sonification: Caldwell 73',
  page: 'https://svs.gsfc.nasa.gov/13786/',
  released: '23 December 2020',
  credits: 'Sonification by SYSTEM Sounds (M. Russo, A. Santaguida) for NASA\'s Hubble Space Telescope project, published by NASA Scientific Visualization Studio.',
  summary: 'A sweep moves around a Hubble picture of the star cluster Caldwell 73 like a radar. Each star\'s distance from the centre sets its pitch, so stars farther out sound higher. The whole picture sings as a choir, with a marimba for orange and red stars and a glockenspiel for blue ones.',
};

// Visualizations on the brief's list that have no flat whole-world frame, and why they are not records.
export const EIC_NOT_USED = [
  { svs: 5533, title: 'Air Quality Model Runs', why: 'Each frame is cut into moving vertical stripes that show four different gases side by side, so no frame holds a whole-world map of one quantity. Its sibling from the same model, fine particles (SVS 5151), is a record.' },
  { svs: 5425, title: 'Perpetual Ocean 2: Western Boundary Currents', why: 'Drawn on a globe with a moving camera, not a flat world map.' },
  { svs: 5196, title: 'DYAMOND Global Carbon Dioxide', why: 'Drawn on a rotating globe, not a flat world map.' },
  { svs: 4960, title: 'A 3D View of an Atmospheric River from an Earth System Model', why: 'A three-dimensional view of one storm, not a flat world map.' },
  { svs: 4950, title: 'GEDI Forest Height', why: 'Drawn on a rotating globe and in regional close-ups, not a flat world map.' },
];
