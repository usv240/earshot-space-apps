// Written with AI assistance (Claude). See README, "Use of AI".
// A small gazetteer so the map can say where you are and answer "how is it in ...".
// Coordinates are city centres rounded to two decimals.

export const CITIES = [
  ['Charlotte', 'United States', 35.23, -80.84], ['Asheville', 'United States', 35.60, -82.55],
  ['Raleigh', 'United States', 35.78, -78.64], ['Atlanta', 'United States', 33.75, -84.39],
  ['New York', 'United States', 40.71, -74.01], ['Washington', 'United States', 38.91, -77.04],
  ['Miami', 'United States', 25.76, -80.19], ['Chicago', 'United States', 41.88, -87.63],
  ['Houston', 'United States', 29.76, -95.37], ['Denver', 'United States', 39.74, -104.99],
  ['Phoenix', 'United States', 33.45, -112.07], ['Los Angeles', 'United States', 34.05, -118.24],
  ['San Francisco', 'United States', 37.77, -122.42], ['Seattle', 'United States', 47.61, -122.33],
  ['Anchorage', 'United States', 61.22, -149.90], ['Honolulu', 'United States', 21.31, -157.86],
  ['Toronto', 'Canada', 43.65, -79.38], ['Vancouver', 'Canada', 49.28, -123.12],
  ['Montreal', 'Canada', 45.50, -73.57], ['Mexico City', 'Mexico', 19.43, -99.13],
  ['Havana', 'Cuba', 23.11, -82.37], ['Bogota', 'Colombia', 4.71, -74.07],
  ['Lima', 'Peru', -12.05, -77.04], ['Santiago', 'Chile', -33.45, -70.67],
  ['Buenos Aires', 'Argentina', -34.60, -58.38], ['Sao Paulo', 'Brazil', -23.55, -46.63],
  ['Rio de Janeiro', 'Brazil', -22.91, -43.17], ['Manaus', 'Brazil', -3.12, -60.02],
  ['Caracas', 'Venezuela', 10.48, -66.90], ['Asuncion', 'Paraguay', -25.26, -57.58],
  ['London', 'United Kingdom', 51.51, -0.13], ['Dublin', 'Ireland', 53.35, -6.26],
  ['Paris', 'France', 48.86, 2.35], ['Madrid', 'Spain', 40.42, -3.70],
  ['Lisbon', 'Portugal', 38.72, -9.14], ['Rome', 'Italy', 41.90, 12.50],
  ['Berlin', 'Germany', 52.52, 13.41], ['Amsterdam', 'Netherlands', 52.37, 4.90],
  ['Stockholm', 'Sweden', 59.33, 18.07], ['Oslo', 'Norway', 59.91, 10.75],
  ['Warsaw', 'Poland', 52.23, 21.01], ['Athens', 'Greece', 37.98, 23.73],
  ['Kyiv', 'Ukraine', 50.45, 30.52], ['Istanbul', 'Turkey', 41.01, 28.98],
  ['Ankara', 'Turkey', 39.93, 32.86], ['Moscow', 'Russia', 55.76, 37.62],
  ['Reykjavik', 'Iceland', 64.15, -21.94], ['Cairo', 'Egypt', 30.04, 31.24],
  ['Casablanca', 'Morocco', 33.57, -7.59], ['Dakar', 'Senegal', 14.72, -17.47],
  ['Lagos', 'Nigeria', 6.52, 3.38], ['Abuja', 'Nigeria', 9.06, 7.49],
  ['Accra', 'Ghana', 5.60, -0.19], ['Luanda', 'Angola', -8.84, 13.23],
  ['Kinshasa', 'DR Congo', -4.44, 15.27], ['Nairobi', 'Kenya', -1.29, 36.82],
  ['Addis Ababa', 'Ethiopia', 9.03, 38.74], ['Johannesburg', 'South Africa', -26.20, 28.05],
  ['Cape Town', 'South Africa', -33.92, 18.42], ['Riyadh', 'Saudi Arabia', 24.71, 46.68],
  ['Dubai', 'United Arab Emirates', 25.20, 55.27], ['Manama', 'Bahrain', 26.23, 50.59],
  ['Tehran', 'Iran', 35.69, 51.39], ['Baghdad', 'Iraq', 33.31, 44.37],
  ['Karachi', 'Pakistan', 24.86, 67.01], ['Lahore', 'Pakistan', 31.55, 74.34],
  ['Delhi', 'India', 28.61, 77.21], ['Mumbai', 'India', 19.08, 72.88],
  ['Bengaluru', 'India', 12.97, 77.59], ['Hyderabad', 'India', 17.39, 78.49],
  ['Chennai', 'India', 13.08, 80.27], ['Kolkata', 'India', 22.57, 88.36],
  ['Dhaka', 'Bangladesh', 23.81, 90.41], ['Kathmandu', 'Nepal', 27.72, 85.32],
  ['Colombo', 'Sri Lanka', 6.93, 79.86], ['Bangkok', 'Thailand', 13.76, 100.50],
  ['Hanoi', 'Vietnam', 21.03, 105.85], ['Singapore', 'Singapore', 1.35, 103.82],
  ['Jakarta', 'Indonesia', -6.21, 106.85], ['Manila', 'Philippines', 14.60, 120.98],
  ['Seoul', 'South Korea', 37.57, 126.98], ['Tokyo', 'Japan', 35.68, 139.69],
  ['Osaka', 'Japan', 34.69, 135.50], ['Ulaanbaatar', 'Mongolia', 47.89, 106.91],
  ['Almaty', 'Kazakhstan', 43.24, 76.89], ['Sydney', 'Australia', -33.87, 151.21],
  ['Melbourne', 'Australia', -37.81, 144.96], ['Perth', 'Australia', -31.95, 115.86],
  ['Auckland', 'New Zealand', -36.85, 174.76], ['Suva', 'Fiji', -18.14, 178.44],
  ['Beijing', 'China', 39.90, 116.41], ['Shanghai', 'China', 31.23, 121.47],
];

// Coarse region names, first match wins. [south, north, west, east, name]
export const REGIONS = [
  [24, 50, -100, -66, 'the eastern United States'], [31, 50, -125, -100, 'the western United States'],
  [50, 72, -141, -52, 'Canada'], [54, 72, -170, -141, 'Alaska'], [14, 32, -118, -86, 'Mexico'],
  [7, 24, -92, -59, 'Central America and the Caribbean'], [-18, 7, -80, -44, 'the Amazon basin'],
  [-34, -5, -58, -34, 'eastern Brazil'], [-56, -18, -76, -53, 'the southern cone of South America'],
  [-18, 12, -82, -66, 'the northern Andes'], [59, 84, -73, -11, 'Greenland'],
  [36, 60, -11, 20, 'western Europe'], [36, 60, 20, 45, 'eastern Europe'], [55, 72, 4, 32, 'Scandinavia'],
  [15, 37, -18, 35, 'the Sahara'], [4, 15, -18, 16, 'West Africa'], [-12, 5, 8, 31, 'Central Africa'],
  [-12, 16, 31, 52, 'East Africa'], [-35, -12, 11, 41, 'southern Africa'], [-26, -11, 43, 51, 'Madagascar'],
  [12, 38, 35, 61, 'the Middle East'], [36, 56, 45, 88, 'Central Asia'], [50, 78, 60, 180, 'Siberia'],
  [6, 36, 61, 90, 'the Indian subcontinent'], [20, 54, 90, 135, 'East Asia'],
  [8, 28, 92, 110, 'mainland Southeast Asia'], [-11, 8, 95, 141, 'Indonesia and the Philippines'],
  [30, 46, 128, 146, 'Japan and Korea'], [-39, -10, 112, 154, 'Australia'], [-48, -33, 165, 179, 'New Zealand'],
  [-90, -60, -180, 180, 'Antarctica'], [66, 90, -180, 180, 'the Arctic Ocean'],
  [0, 66, -80, -5, 'the North Atlantic'], [-60, 0, -68, 20, 'the South Atlantic'],
  [-60, 30, 20, 120, 'the Indian Ocean'], [0, 66, 120, 180, 'the North Pacific'],
  [0, 66, -180, -100, 'the North Pacific'], [-60, 0, 120, 180, 'the South Pacific'],
  [-60, 0, -180, -68, 'the South Pacific'],
];

export function regionAt(lat, lon) {
  for (const [s, n, w, e, name] of REGIONS) if (lat >= s && lat < n && lon >= w && lon < e) return name;
  return lat >= 0 ? 'the northern hemisphere' : 'the southern hemisphere';
}

export function findCity(query) {
  const q = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  let best = null;
  for (const c of CITIES) {
    const name = c[0].toLowerCase();
    if (q === name) return city(c);
    if (new RegExp('(^| )' + name + '( |$)').test(q) && (!best || name.length > best[0].length)) best = c;
  }
  return best ? city(best) : null;
}

export function nearestCity(lat, lon, maxDeg = 4) {
  let best = null, bd = maxDeg * maxDeg;
  for (const c of CITIES) {
    const d = (c[2] - lat) ** 2 + ((c[3] - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best ? city(best) : null;
}

function city(c) {
  return { name: c[0], country: c[1], lat: c[2], lon: c[3] };
}

export function coordWords(lat, lon) {
  const a = Math.abs(lat).toFixed(0) + ' degrees ' + (lat >= 0 ? 'north' : 'south');
  const b = Math.abs(lon).toFixed(0) + ' degrees ' + (lon >= 0 ? 'east' : 'west');
  return a + ', ' + b;
}
