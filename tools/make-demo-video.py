# Written with AI assistance (Claude). See README, "Use of AI".
# Draws the frames of the 30-second demo and joins them with the sound track.
#   python tools/make-demo-video.py <work-folder> <output.mp4>
# Run tools/make-demo-audio.mjs first. Pictures are NASA's own frames; nothing here is made by generative AI.
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

work, out = sys.argv[1], sys.argv[2]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')
plan = json.load(open(os.path.join(work, 'demo.json'), encoding='utf-8'))
W, H, FPS = 1280, 720, 24
MAP_H = 640  # the map is 2:1 across the top; captions sit in the band below
INK, BONE, CORAL, GREEN, YELLOW = (20, 20, 19), (230, 224, 210), (237, 75, 68), (24, 188, 66), (242, 194, 26)

def font(size, bold=True):
    return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf', size)
F_BIG, F_HEAD, F_CAP, F_SMALL, F_TINY = font(86), font(46), font(24), font(22, False), font(15, False)

def picture(rel):
    return Image.open(os.path.join(root, rel)).convert('RGB').resize((W, MAP_H), Image.LANCZOS)
PIC = {k: picture(v) for k, v in plan['frames'].items()}
# a screenshot of the product itself, fitted into the map area
shot = Image.open(os.path.join(work, 'product-area.jpg')).convert('RGB')
shot.thumbnail((W, MAP_H), Image.LANCZOS)
PRODUCT = Image.new('RGB', (W, MAP_H), (24, 188, 66))
PRODUCT.paste(shot, ((W - shot.width) // 2, (MAP_H - shot.height) // 2))

def boxed(d, xy, text, f, fill=BONE, pad=14, bg=(0, 0, 0)):
    x, y = xy
    l, t, r, b = d.textbbox((x, y), text, font=f)
    d.rectangle((l - pad, t - pad, r + pad, b + pad), fill=bg)
    d.text((x, y), text, font=f, fill=fill)

def caption(d, lines, colour=BONE):
    d.rectangle((0, MAP_H, W, H), fill=INK)
    y = MAP_H + (6 if len(lines) > 1 else 22)
    for line in lines:
        d.text((28, y), line, font=F_CAP, fill=colour)
        y += 33
    mark = 'Made with AI assistance. Pictures: NASA'
    d.text((W - 16 - d.textlength(mark, font=F_TINY), 8), mark, font=F_TINY, fill=(205, 200, 190))

def wrap(d, text, f, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        if d.textlength((cur + ' ' + w).strip(), font=f) > width and cur:
            lines.append(cur); cur = w
        else:
            cur = (cur + ' ' + w).strip()
    return lines + [cur]

def sweep(img, d, s, t):
    p = (t - s['start'] - s['lead']) / s['sweep']
    if 0 <= p <= 1:
        x = int(p * W)
        d.rectangle((x - 3, 0, x + 3, MAP_H), fill=CORAL)

def bands(d):
    names = ['high notes: far north', 'northern middle', 'southern middle', 'low notes: far south']
    for i, name in enumerate(names):
        y = int(i * MAP_H / 4)
        if i: d.line((0, y, W, y), fill=(255, 255, 255), width=1)
        boxed(d, (20, y + 16), name, F_SMALL, pad=8)

def frame(t):
    s = next((x for x in plan['scenes'] if x['start'] <= t < x['start'] + x['seconds']), plan['scenes'][0 if t < 1 else -1])
    k = s['kind']
    img = Image.new('RGB', (W, H), INK)
    d = ImageDraw.Draw(img)
    if k == 'title':
        img.paste(PIC['y2023'], (0, 0))
        boxed(d, (48, 190), "Hear NASA's", F_BIG, pad=18)
        boxed(d, (48, 310), 'Earth maps.', F_BIG, pad=18)
        boxed(d, (48, 60), 'Earshot, by Team USV', F_HEAD, fill=YELLOW, pad=12)
        caption(d, ["NASA shows our planet in pictures. Earshot lets you hear them.", "About 28,000 people in Charlotte are blind or have serious difficulty seeing (US Census, 2024)."])
    elif k == 'sweep-sea':
        img.paste(PIC['sea'], (0, 0)); bands(d); sweep(img, d, s, t)
        caption(d, ['Ocean heat, as sound: louder and brighter means warmer water.', 'The hiss is land, where this map has no data. Sound moves west to east.'])
    elif k == 'sweep-change':
        img.paste(PIC['y2023'], (0, 0)); sweep(img, d, s, t)
        boxed(d, (48, 60), 'Only what grew, 2012 to 2023', F_HEAD, fill=YELLOW, pad=12)
        caption(d, ["Night lights: this sweep plays only the rise between 2012 and 2023.", "Silent where nothing changed, loudest where light grew most."])
    elif k == 'area':
        img.paste(PRODUCT, (0, 0))
        caption(d, ["The area around your own city: a chime marks you, then Earshot says", "how far away the most is, and which way. Every day, in a podcast app."])
    elif k == 'change':
        img.paste(PIC['y2023'], (0, 0))
        boxed(d, (48, 60), '2012 to 2023', F_HEAD, fill=YELLOW, pad=12)
        caption(d, wrap(d, 'Earshot says: "' + s['text'] + '"', F_CAP, W - 60)[:2])
    else:
        d.rectangle((0, 0, W, H), fill=INK)
        d.text((60, 50), 'Earshot', font=F_BIG, fill=BONE)
        y = 175
        for line, colour in [('Built on published research with blind listeners.', BONE), ('Every sound is computed from NASA data, in the browser.', BONE), ('Made for a speaker beside the Earth Information Center wall,', BONE), ('a podcast app, or any app through its open API.', BONE), ('dp16xommhs4bv.cloudfront.net', YELLOW), ('Team USV. Challenge: The Earth Information Jukebox.', GREEN)]:
            d.text((60, y), line, font=F_HEAD if colour != BONE else font(34), fill=colour); y += 62
        d.text((60, H - 70), 'Made with AI assistance. Narration is a computer voice. Pictures: NASA Scientific Visualization Studio.', font=F_SMALL, fill=(205, 200, 190))
        d.text((60, H - 40), 'Not made or endorsed by NASA.', font=F_SMALL, fill=(205, 200, 190))
    return img

n = int(plan['total'] * FPS)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
       '-i', os.path.join(work, 'demo.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-movflags', '+faststart', '-shortest',
       '-metadata', 'title=Earshot: hear NASA\'s Earth maps',
       '-metadata', 'comment=Sounds computed from NASA data by Earshot. Narration is a computer voice. Assembled by a script written with AI assistance. Pictures: NASA Scientific Visualization Studio. Not made or endorsed by NASA.',
       out]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
for i in range(n):
    p.stdin.write(frame(i / FPS).tobytes())
p.stdin.close()
p.wait()
for name, t in [(sc['kind'], sc['start'] + sc['seconds'] * 0.6) for sc in plan['scenes']]:
    frame(t).save(os.path.join(work, f'still-{name}.jpg'), quality=85)
print('frames', n, 'seconds', n / FPS)
