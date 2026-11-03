"""Slice the Leo Chua asset sheet into individual transparent PNGs.

Usage: python scripts/slice-game-assets.py <sheet.webp> public/game-assets <qa-contact-sheet.png>
Requires Pillow. Box coordinates match the 1536x1024 sheet layout.

White background is removed by flood-filling from the crop border, so white
areas enclosed by outlines (toilet paper, face holes) are preserved.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

# name: (x1, y1, x2, y2, remove_background)
BOXES = {
    "bg-sky": (12, 7, 274, 407, False),
    "mountain": (280, 8, 710, 434, True),
    "cloud-1": (650, 42, 890, 124, True),
    "cloud-2": (664, 146, 882, 217, True),
    "cloud-3": (698, 231, 890, 294, True),
    "cloud-4": (718, 322, 978, 392, True),
    "pagoda": (893, 16, 1217, 354, True),
    "bell": (1211, 136, 1320, 264, True),
    "bell-frame": (1328, 108, 1504, 274, True),
    "logo": (1103, 352, 1528, 478, True),
    "panel": (1328, 482, 1520, 614, True),
    "wc-hut": (18, 416, 144, 572, True),
    "wc-occupied": (155, 412, 315, 574, True),
    "flag-25": (743, 438, 838, 577, True),
    "flag-50": (857, 438, 952, 577, True),
    "flag-75": (972, 438, 1067, 577, True),
    "climber-walk-1": (28, 612, 114, 744, True),
    "climber-walk-2": (128, 612, 212, 744, True),
    "climber-walk-3": (226, 612, 310, 744, True),
    "climber-stuck-1": (336, 636, 454, 797, True),
    "climber-stuck-2": (454, 644, 552, 797, True),
    "monkey-run-1": (573, 598, 664, 697, True),
    "monkey-run-2": (666, 598, 764, 697, True),
    "monkey-run-3": (772, 598, 864, 697, True),
    "monkey-run-4": (870, 598, 964, 697, True),
    "monkey-run-5": (975, 598, 1062, 702, True),
    "monkey-sandal-1": (570, 706, 664, 814, True),
    "monkey-sandal-2": (670, 706, 772, 814, True),
    "monkey-sandal-3": (778, 706, 870, 814, True),
    "monkey-sandal-4": (876, 706, 968, 814, True),
    "monkey-sandal-5": (976, 706, 1067, 814, True),
    "cable-car": (1306, 618, 1480, 842, True),
    "toilet-paper": (22, 866, 114, 948, True),
    "crown": (126, 880, 230, 962, True),
    "gift": (243, 820, 364, 947, True),
    "burst": (378, 856, 518, 988, True),
    "confetti": (526, 864, 642, 978, True),
    "win-banner": (656, 838, 988, 968, True),
}

THRESH = 46

# Neighbouring assets that intrude into a crop, in sheet coordinates
ERASE = {
    "mountain": [(645, 0, 720, 230), (692, 225, 720, 300)],
    "wc-occupied": [(272, 405, 320, 436)],
    "cloud-4": [(890, 315, 990, 356)],
}


def remove_white_background(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()
    border = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    border += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for x, y in border:
        r, g, b, a = px[x, y]
        if a and r > 225 and g > 225 and b > 225:
            ImageDraw.floodfill(img, (x, y), (255, 255, 255, 0), thresh=THRESH)
    # Soften the white fringe left around anti-aliased outlines
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and r > 235 and g > 235 and b > 235:
                neighbours = [px[nx, ny][3] for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                              if 0 <= nx < w and 0 <= ny < h]
                if any(n == 0 for n in neighbours):
                    px[x, y] = (r, g, b, 0)
    return img


sheet = Image.open(SRC).convert("RGBA")
for name, (x1, y1, x2, y2, cut) in BOXES.items():
    source = sheet
    if name in ERASE:
        source = sheet.copy()
        eraser = ImageDraw.Draw(source)
        for rect in ERASE[name]:
            eraser.rectangle(rect, fill=(255, 255, 255, 255))
    crop = source.crop((x1, y1, x2, y2))
    if cut:
        crop = remove_white_background(crop)
        bbox = crop.getbbox()
        if bbox:
            crop = crop.crop(bbox)
    crop.save(OUT / f"{name}.png", optimize=True)
    print(f"{name}: {crop.size}")

# Contact sheet on a checkerboard for visual QA
cells = list(BOXES)
cols, cell = 8, 190
rows = (len(cells) + cols - 1) // cols
qa = Image.new("RGBA", (cols * cell, rows * cell), (60, 60, 60, 255))
draw = ImageDraw.Draw(qa)
for i in range(0, cols * cell, 20):
    for j in range(0, rows * cell, 20):
        if (i // 20 + j // 20) % 2:
            draw.rectangle([i, j, i + 19, j + 19], fill=(90, 90, 90, 255))
for idx, name in enumerate(cells):
    im = Image.open(OUT / f"{name}.png")
    im.thumbnail((cell - 24, cell - 34))
    cx, cy = (idx % cols) * cell, (idx // cols) * cell
    qa.alpha_composite(im, (cx + (cell - im.width) // 2, cy + 6))
    draw.text((cx + 6, cy + cell - 22), name, fill=(255, 255, 0, 255))
qa.save(Path(sys.argv[3]))
