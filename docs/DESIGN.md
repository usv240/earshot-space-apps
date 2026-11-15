# Earshot: technical design

Written with AI assistance (Claude). See the README, "Use of AI".

## 1. The problem and the claim

NASA's Earth Information Center tells the story of a changing planet in pictures. A person who cannot see a picture gets, at best, a caption. Earshot makes two claims:

1. A colour-coded world map can be turned into a short piece of music that still contains the map. The page tests this for every map it plays.
2. People can read patterns from sound maps built this way. This rests on published studies with blind and sighted listeners (see the README, "The research it is built on"), and the design follows their findings.

Challenge: The Earth Information Jukebox (2026 NASA Space Apps Challenge). The brief asks for an interface that pairs Earth Information Center visual frames with sonifications generated in real time, with accessibility as a core theme.

## 2. One engine, four surfaces

```
                       site/engine/earshot.js
                       (pure functions, no dependencies)
                                  |
        +-------------+-----------+-----------+----------------+
        |             |                       |                |
   Web page      HTTP API               MCP server          Tests
   site/app.js   server/server.mjs      mcp/earshot-mcp.mjs test/*.mjs
   (browser)     (Node, keys)           (AI assistants)     (Node)
```

The engine never touches the network, the page or the file system. Each surface fetches pixels in its own way and hands them to the same functions, so a number shown on the page, returned by the API and given to an AI assistant is always the same number.

## 3. The pipeline

| Step | Function | Input | Output |
|---|---|---|---|
| 1. Read colours | `decode` | RGBA pixels, a colour table | a value per pixel, and which pixels had data |
| 2. Measure bands | `toGrid` | values | 8 latitude bands by 72 longitude slices: area-weighted mean and coverage |
| 3. Normalise | `toLevels` | grid, range, curve | levels from 0 to 1; cells with too little data are marked unknown |
| 4. Make sound | `sonify` | levels, instrument, rhythm | stereo samples |
| 5. Listen back | `listenBack` | samples only | a rebuilt grid |
| 6. Compare | `compare` | levels, rebuilt grid | correlation, mean error, worst error |
| 7. Describe | `facts`, `brief` | levels and the grid of real values | plain sentences |

### 3.1 Reading colours

Day-by-day records come from NASA GIBS as PNG pictures. GIBS also publishes the colour table of each layer as XML, listing every colour and the value range it stands for. `parseGibsColormap` reads that table and `decode` looks each pixel up in it. On every saved day tested, 100 percent of data pixels match a table entry exactly, so no value is guessed.

NASA answers with an empty picture for a day it has not published yet. An empty picture is never read as "nothing there": the page and the API both step back one day at a time until a picture with data arrives, and say which day they are playing.

Earth Information Center frames have no machine-readable table. Each is read in the most defensible way its picture allows:

| Visualization | Reading |
|---|---|
| Night lights (SVS 5313) | Brightness. The frames that are read have NASA's grey land shading and printed year removed, so brightness means light only. The untouched frames are the ones displayed |
| Ocean currents (SVS 3912) | Temperature from NASA's colour bar, sampled every degree, at several brightness levels because the currents are thin lines on a dark ground |
| Aerosols (SVS 5669) | Nearest of the four legend colours. The legend has no numbers, so each layer is a relative strength |
| Lightning (SVS 5011) | Density of yellow marks |
| Fine particles (SVS 5151) | 40 stops sampled along NASA's colour bar, nearest colour within a tolerance |

The page labels these as estimates read from a picture.

### 3.2 The grid

Rows are 22.5 degrees of latitude; columns are 5 degrees of longitude. Each pixel is weighted by the cosine of its latitude. A cell with data in less than 8 percent of its area is marked unknown. Unknown cells are silent in the voices and marked by a hiss, and the briefing says how much of the map had data.

### 3.3 The sound

- **Pitches.** Eight voices at 110, 165, 220, 275, 371.25, 495, 660 and 880 Hz: the notes A, E, A, C sharp, F sharp, B, E, A, a six-nine chord on A in just intonation. No two voices are a semitone or a tritone apart. Because the ratios are exact, an overtone of a low voice either lands exactly on a higher voice or at least 41 Hz away from one.
- **Loudness.** A voice's gain is `level ^ 0.6`, lifted 3 dB per octave below the top voice as a partial equal-loudness correction.
- **Instruments.** Six overtone recipes (choir, glass, reed, string, brass, flute), chosen to differ in brightness. Each record has one. The overtones also carry the low voices on small speakers.
- **Shimmer.** Seven of the eight pitches are harmonics of 55 Hz, and steady harmonics in one tone colour fuse into a single sound. Each voice therefore dips by up to 30 percent at its own rate, from 2 Hz for the lowest voice to about 8 Hz for the highest. Flowers (2005) advises that "patterned or modulated streams will help keep them separate". The decoder removes the same pattern exactly. The shimmer runs at about the same rate as the data changes (six slices a second at 12 seconds), so it is kept shallow; whether it helps or distracts is a question for listeners.
- **One band at a time.** A setting plays the four voices one after another, far south first, each with the others silent (`onlyBand`, `joinAudio`), so a listener never follows more than one stream.
- **What changed.** `changeLevels` keeps only the rise between two moments of one visualization, on a fixed scale: a rise of a third of the record's scale or more plays at full strength, so a small change sounds quiet and a large one loud. Night lights grow by about 1.5 dB across the whole map between 2012 and 2023, too little to hear between two separate sweeps; in the change sound the largest rise is the loudest thing.
- **Rhythm.** Rain adds a soft patter and lightning a sharp crackle. The number of ticks in a slice follows how much there is in that slice. Ticks sit above 1.5 kHz, clear of the voices.
- **No data.** Shaped noise between 3 and 8 kHz, louder where more bands are missing. It says that a slice has gaps, not which bands.
- **Sweep.** West to east over 8, 12 or 24 seconds, panned from the left ear to the right with equal power. Three soft clicks mark the quarter points.
- **Tuning note.** 0.3 seconds, at half the strength of one full top voice. Its pitch (1000 Hz plus 100 Hz per instrument, plus 50 Hz for the four-voice setting) tells the decoder what follows.
- **Volume.** Each record has a fixed master gain, so two days of one record can be compared by ear. If a day would clip, it is turned down and the page says by how much. "Play all in order" brings all parts to one shared gain.
- **Four voices by default.** `simplify` merges the bands in pairs and plays four voices (A2, E3, C sharp 4, B4: 110, 165, 275 and 495 Hz), because following three or more continuous streams is hard (Flowers, 2005). None of the four is an overtone of the lowest, which makes them less likely to fuse. "One band at a time" plays them one after another. Eight voices are a setting.
- **Brightness.** A fuller voice is also brighter: its overtones run from 35 percent of full strength at level 0 to all of it at level 1. Loudness alone is a weak carrier of values (Neuhoff, 2011), so the value is carried twice. The decoder accounts for it when it removes overlapping overtones.

### 3.4 The self-check

`listenBack` is given only the samples. It finds the tuning note, which gives the instrument, the number of voices and the yardstick for loudness. For each time slice it measures each voice's pitch with the Goertzel algorithm (a one-frequency Fourier measurement) with a Hann window over the middle 60 percent of the slice. Where an overtone of a lower voice lands exactly on a higher voice, the known share is subtracted, working from the lowest voice up. Then the ear weighting and the loudness curve are undone.

Results from `node test/roundtrip.test.mjs`, on the saved maps of 13 November 2026 (the test was run on 14 November):

| Record | Cells checked | Match | Mean error |
|---|---|---|---|
| Rain | 576 | 0.9993 | 0.18 percent |
| Smoke and dust | 489 | 0.9985 | 0.24 percent |
| Haze | 331 | 0.9988 | 0.37 percent |
| Sea temperature | 426 | 0.9998 | 0.24 percent |
| Random map with gaps and a crackle, each of six instruments | 516 | 0.9970 or better | about 2.7 percent |

The same holds through a 16-bit WAV file, at 40 percent volume, at all three sweep lengths and with four voices. The check is deliberately a matched decoder: it knows the pitches and the timing. It shows that the grid of values survives the trip into sound and back. It does not cover the rhythm or the hiss. It is known to be sensitive to folding the two channels to one and to shifting the audio in time, and it does not cover the rhythm or the hiss.

### 3.5 The listening check

The listening check lets anyone test their own ear against the data. It plays three maps the listener is not shown and asks up to two questions on each: which half of the planet had more, when in the sweep the sound was fullest, and whether there was a hiss. A question is only asked when the data gives a clear answer (for example, the fullest third must exceed the next by 20 percent). The right answers come from `facts`, not from a person. With consent, the score is posted to `POST /api/v1/listening`, which keeps counts only: sessions, answers, correct answers, and the score guessing would have earned, with separate tallies for listeners who say their eyes were closed and who say they are blind or have low vision. The page shows the running count once listeners have added to it. No numbers are seeded.

### 3.6 Words

All text is produced by rules from the numbers. No AI model runs in the product: a blind listener cannot cross-check a sentence against the picture, so the sentence must not be able to invent anything.

- `brief` reports the average and the peak in real units (from the grid of means, so they are not cut off at the top of the scale), names the peak by region, and uses each record's own words (for rain: very light, light, moderate, heavy).
- Each record carries a description of what the picture looks like.
- The question box matches a small set of intents.
- "Two readings" alternates what the map shows with what this kind of NASA map cannot tell you.
- After "Play all in order", one or two sentences say what changed, worked out from the first and last parts or from the seasonal swing.

### 3.7 The area around one place

`areaBox` makes a box of 60 degrees of longitude by 30 of latitude around a place (moved inside the map near the poles). `areaGrid` cuts that box from the same whole-world field, as 8 bands by 48 columns, weighting each pixel by the cosine of its latitude and wrapping across the date line. The sound is made the same way as for the planet, plus a soft two-note chime (2.35 and 3.14 kHz, above the voices) as the sweep passes the place; the self-check is unaffected (match 0.9999 in the test). `nearby` writes the sentences: the strongest cell in the box, its distance (great-circle) and compass direction from the place, a region name, and which half of the box has more. The page, the API (`around` in `POST /api/v1/brief`), the MCP tool `value_at` and the per-place podcast feed all use the same functions.

## 4. The web page

Plain HTML, CSS and JavaScript modules. No framework and no build step.

| Concern | Choice |
|---|---|
| Day-by-day maps | `fetch` to GIBS, decoded with `createImageBitmap` using `premultiplyAlpha: 'none'` and `colorSpaceConversion: 'none'` so pixel values are not altered |
| Fallback | One saved day of each layer; the page says when it is using it |
| Sound | Web Audio API, playing the engine's samples |
| Speech out | `speechSynthesis`, with a "page voice" switch so screen-reader users do not hear two voices |
| Speech in | `SpeechRecognition` where the browser has it |
| Explore | Pointer events and arrow keys on the map; a tone only while pressing; `navigator.vibrate` on phones that have it |
| Downloads | WAV, band CSV, points CSV, map PNG, briefing text, proof JSON, all made in the browser |
| Your own data | A picture (brightness, a two-colour ramp, or NASA's fine-particle legend), a CSV with latitude, longitude and a value column that is detected and named back to you, or an Earshot sound file, which is turned back into a map |
| Themes | Light and dark, following the system, with a remembered toggle |
| Information buttons | Nineteen. Each opens on hover, focus and tap, and its text is also attached to the button for screen readers |

### Accessibility

- Every control is a real button, input, select or link with a visible focus ring.
- Results are written to live regions; loading text has the status role.
- The text of every information button is exposed with `aria-describedby`.
- The map is focusable and can be explored with arrow keys.
- No sound plays on load, and none plays on hover.
- Motion respects `prefers-reduced-motion`; on phones nothing waits for an entrance.
- Smallest text is 15 px; body text is 17 to 19 px.


### Visual design

Direction "colour chapters": each section is one flat field of colour, with one typeface (Outfit, SIL Open Font License) and square corners. The hero shows the loaded NASA map itself, and the jukebox draws the current map as a vinyl record, with the Antarctic at the centre and the Arctic at the rim.

## 5. The HTTP API

`server/server.mjs`, Node built-ins only. Default port 8790.

| Method and path | Key | Purpose |
|---|---|---|
| `GET /api/v1/health` | no | Is the service up |
| `GET /api/v1/records` | no | The day-by-day records, their units, instruments and limits |
| `POST /api/v1/keys` | no | Issue a free key (30 an hour per address) |
| `POST /api/v1/brief` | yes | Briefing for `{record, date, place}` |
| `POST /api/v1/sonify` | yes | WAV for `{record, date}` or for your own `{points}` or `{grid}`, with `timbre`, `rhythm`, `voices`, and the self-check numbers |
| `GET /api/v1/listening` | no | The listening check's running count |
| `POST /api/v1/listening` | no | Add one listener's score (12 an hour per address) |

Keys are random, stored in `server/keys.json`, limited to 120 calls an hour, and carry no personal data.

## 6. The MCP server

`mcp/earshot-mcp.mjs` speaks JSON-RPC over standard input and output, with no packages. Tools: `list_records`, `describe_map`, `value_at`, `sonify_map`. Every answer carries the record's limits.

## 7. Known limits

- Earth Information Center records are estimates read from pictures, and five of the brief's listed visualizations have no flat world frame to read.
- GIBS pictures at 1024 by 512 are a coarse view of each product.
- The data value rides on loudness, which the ear judges roughly; the page is for patterns ("more in the north", "fullest over Asia"), not for reading exact numbers. Exact numbers come from the spoken value at a place.
- Place lookup covers about ninety cities, or any latitude and longitude.
- The listening check's count is self-reported and unmoderated.
- The API and the MCP server serve the day-by-day records only.
