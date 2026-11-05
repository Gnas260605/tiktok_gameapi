"""Crop a background painting to the 9:16 Tu Tien overlay and export WebP.

Usage:
  python scripts/prepare-tutien-bg.py <source image> [--center-x 0.5] [--name bg-plaza]

Writes public/tutien-assets/<name>.webp at 720x1280 (the overlay size).
A landscape source is cropped around --center-x (0..1 of the width); warns when
the crop has to be enlarged, because an upscaled background looks soft on stream.
Requires Pillow.
"""
import argparse
from pathlib import Path
from PIL import Image

W, H = 720, 1280

parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('--center-x', type=float, default=0.5)
parser.add_argument('--name', default='bg-plaza')
args = parser.parse_args()

img = Image.open(args.source).convert('RGB')
sw, sh = img.size
target_ratio = W / H

if sw / sh > target_ratio:  # too wide: crop width around center-x
    cw, ch = round(sh * target_ratio), sh
    left = round(args.center_x * sw - cw / 2)
    left = max(0, min(sw - cw, left))
    box = (left, 0, left + cw, ch)
else:  # too tall: keep the bottom (the plaza floor), crop the sky
    cw, ch = sw, round(sw / target_ratio)
    box = (0, sh - ch, cw, sh)

crop = img.crop(box)
scale = H / crop.size[1]
if scale > 1.05:
    print(f'warning: crop {crop.size[0]}x{crop.size[1]} is enlarged {scale:.2f}x; '
          'a vertical 9:16 source of at least 1440x2560 will look sharper')

out = Path(__file__).resolve().parent.parent / 'public' / 'tutien-assets' / f'{args.name}.webp'
crop.resize((W, H), Image.LANCZOS).save(out, 'WEBP', quality=82, method=6)
print(f'wrote {out} from crop {box} of {sw}x{sh}')
