"""Slice the Tu Tien reference asset sheet into individual transparent PNGs.

Usage: python scripts/slice-tutien-assets.py [sheet.webp] [public/tutien-assets] [qa-contact-sheet.png]
Requires Pillow. Box coordinates match the 843x562 sheet (4 columns x 2 rows):
  Row 1: Luyện Khí (1,1), Trúc Cơ (1,2), Kim Đan (1,3), Nguyên Anh (1,4)
  Row 2: Hóa Thần (2,1), Luyện Hư (2,2), Hợp Thể (2,3), Đại Thừa (2,4)

White background and WebP compression noise are removed by clearing low-alpha
compression noise and flood-filling from crop borders, preserving internal white areas
(e.g., white robes, hair ribbons). Generates a 4x2 QA contact sheet.
"""

from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

# CLI arguments with fallback defaults
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs/game/assets/reference-male-realms.webp")
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("public/tutien-assets")
QA_OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else OUT / "qa-contact-sheet.png"

OUT.mkdir(parents=True, exist_ok=True)
QA_OUT.parent.mkdir(parents=True, exist_ok=True)

# Slicing boxes: name -> (x1, y1, x2, y2, cut_white_background)
# Matching 843x562 sheet: 4 columns x 2 rows
BOXES = {
    # Row 1 (y: 0..265)
    "char-luyen-khi-male": (0, 0, 210, 265, True),
    "char-truc-co-male": (210, 0, 421, 265, True),
    "char-kim-dan-male": (421, 0, 632, 265, True),
    "char-nguyen-anh-male": (632, 0, 843, 265, True),
    # Row 2 (y: 265..562)
    "char-hoa-than-male": (0, 265, 210, 562, True),
    "char-luyen-hu-male": (210, 265, 421, 562, True),
    "char-hop-the-male": (421, 265, 630, 562, True),
    "char-dai-thua-male": (623, 265, 843, 562, True),
}

# Realm metadata for QA sheet and manifest synchronization
REALM_META = {
    "char-luyen-khi-male": {"vn": "1. Luyện Khí", "color": "#7FD3FF"},
    "char-truc-co-male": {"vn": "2. Trúc Cơ", "color": "#50E3C2"},
    "char-kim-dan-male": {"vn": "3. Kim Đan", "color": "#F5A623"},
    "char-nguyen-anh-male": {"vn": "4. Nguyên Anh", "color": "#BD10E0"},
    "char-hoa-than-male": {"vn": "5. Hóa Thần", "color": "#4A90E2"},
    "char-luyen-hu-male": {"vn": "6. Luyện Hư", "color": "#9013FE"},
    "char-hop-the-male": {"vn": "7. Hợp Thể", "color": "#D0021B"},
    "char-dai-thua-male": {"vn": "8. Đại Thừa", "color": "#F8E71C"},
}

THRESH = 46

# Neighboring assets that intrude into a crop, in sheet coordinates
ERASE = {
    # Dai Thua red flame intrudes into Hop The bounding area around y=385..430
    "char-hop-the-male": [(623, 385, 640, 430)],
    # Hop The golden aura and robe intrude into Dai Thua bounding area
    "char-dai-thua-male": [(615, 325, 628, 375), (615, 455, 628, 515)],
}


def remove_white_background(img: Image.Image) -> Image.Image:
    """Remove white background while preserving inner white robes and cleaning noise."""
    img = img.convert("RGBA")
    w, h = img.size
    px = img.load()

    # 1. Clear WebP near-zero alpha compression noise (artifacts on transparent background)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] <= 15:
                px[x, y] = (0, 0, 0, 0)

    # 2. Flood-fill white/off-white background from crop borders to transparent
    border = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    border += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for x, y in border:
        r, g, b, a = px[x, y]
        if a > 0 and r > 225 and g > 225 and b > 225:
            ImageDraw.floodfill(img, (x, y), (255, 255, 255, 0), thresh=THRESH)

    # 3. Soften the white fringe left around anti-aliased outlines adjacent to transparency
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and r > 235 and g > 235 and b > 235:
                neighbours = [
                    px[nx, ny][3]
                    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
                    if 0 <= nx < w and 0 <= ny < h
                ]
                if any(n == 0 for n in neighbours):
                    px[x, y] = (r, g, b, 0)

    return img


def slice_assets():
    print(f"Loading reference sheet from: {SRC}")
    sheet = Image.open(SRC).convert("RGBA")
    results = {}

    for name, (x1, y1, x2, y2, cut) in BOXES.items():
        source = sheet
        if name in ERASE:
            source = sheet.copy()
            eraser = ImageDraw.Draw(source)
            for rect in ERASE[name]:
                eraser.rectangle(rect, fill=(0, 0, 0, 0))

        crop = source.crop((x1, y1, x2, y2))
        if cut:
            crop = remove_white_background(crop)
            bbox = crop.getbbox()
            if bbox:
                crop = crop.crop(bbox)

        out_file = OUT / f"{name}.png"
        crop.save(out_file, optimize=True)
        results[name] = crop
        print(f"Exported {out_file.name}: {crop.size} ({out_file.stat().st_size} bytes)")

    # Build 4x2 visual QA contact sheet on checkerboard + magenta verification strip
    cols, rows = 4, 2
    cell_w, cell_h = 240, 340
    qa = Image.new("RGBA", (cols * cell_w, rows * cell_h), (40, 42, 48, 255))
    draw = ImageDraw.Draw(qa)

    # Checkerboard pattern for transparency verification
    check_sz = 16
    for x in range(0, cols * cell_w, check_sz):
        for y in range(0, rows * cell_h, check_sz):
            if (x // check_sz + y // check_sz) % 2 == 0:
                draw.rectangle([x, y, x + check_sz - 1, y + check_sz - 1], fill=(55, 58, 66, 255))

    # Font setup
    try:
        title_font = ImageFont.truetype("arial.ttf", 13)
        sub_font = ImageFont.truetype("arial.ttf", 11)
    except Exception:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()

    for idx, (name, crop) in enumerate(results.items()):
        col = idx % cols
        row = idx // cols
        cx = col * cell_w
        cy = row * cell_h

        # Cell border
        draw.rectangle([cx, cy, cx + cell_w - 1, cy + cell_h - 1], outline=(70, 75, 85, 255), width=1)

        # Magenta bottom bar for checking alpha cleanliness (#FF00FF test per guidelines §8)
        draw.rectangle([cx + 12, cy + cell_h - 66, cx + cell_w - 12, cy + cell_h - 48], fill=(255, 0, 255, 255))

        # Thumbnail to fit cell display area (max height 240)
        thumb = crop.copy()
        thumb.thumbnail((cell_w - 24, cell_h - 76))
        tx = cx + (cell_w - thumb.width) // 2
        ty = cy + 10 + (cell_h - 76 - thumb.height) // 2
        qa.alpha_composite(thumb, (tx, ty))

        # Metadata text
        meta = REALM_META.get(name, {"vn": name, "color": "#FFFFFF"})
        label = f"{meta['vn']} — {crop.width}x{crop.height}"
        sub_label = f"{name}.png"

        # Text banner
        draw.rectangle([cx, cy + cell_h - 44, cx + cell_w - 1, cy + cell_h - 1], fill=(20, 22, 28, 235))
        draw.text((cx + 10, cy + cell_h - 40), label, fill=meta["color"], font=title_font)
        draw.text((cx + 10, cy + cell_h - 22), sub_label, fill=(180, 185, 195, 255), font=sub_font)

    qa.save(QA_OUT, optimize=True)
    print(f"QA contact sheet saved to: {QA_OUT} ({QA_OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    slice_assets()
