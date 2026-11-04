"""Turn the original exercise photos into small, web-ready WebP files in media/.

    python scripts/build_media.py

- Crops each photo to a 3:2 box around the person (tweak CROPS below if a crop cuts something off).
- Resizes to 800 px wide and saves as WebP.
- Strips ALL metadata (iPhone photos carry GPS coordinates; the site is public).

The originals in pictures/ are git-ignored; only the output in media/ is committed.
"""
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "pictures" / "pork_belly_destruction"
OUT = ROOT / "media"
WIDTH = 800
ASPECT = 3 / 2  # width / height
QUALITY = 68

# output name -> (source file, x0, y0, crop width) — all as fractions of the source image.
# The crop height follows from ASPECT. Use x0=0, y0=0, w=1 for "as wide as possible".
CROPS = {
    "roll-knees-left":              ("1_roll_knee_left.JPEG",                     0.05, 0.30, 0.75),
    "roll-knees-mid":               ("2_roll_in_mid.JPEG",                        0.10, 0.25, 0.80),
    "roll-knees-right":             ("3_roll_in_right.JPEG",                      0.05, 0.25, 0.80),
    "hip-lift":                     ("4_hips_lift.JPEG",                          0.00, 0.00, 1.00),
    "heel-touch-air":               ("5_heels_touch_air.JPEG",                    0.00, 0.20, 0.80),
    "boxing-crunches":              ("6_boxing_crushes.JPEG",                     0.00, 0.20, 0.80),
    "scissors-1":                   ("7_1_scissor.JPEG",                          0.10, 0.24, 0.85),
    "scissors-2":                   ("7_2_scissor.JPEG",                          0.10, 0.15, 0.80),
    "plank-pulses-left":            ("8_plank_pulses_left.JPEG",                  0.10, 0.15, 0.80),
    "plank-hold-left":              ("9_plank_hold_left.JPEG",                    0.10, 0.15, 0.85),
    "plank-pulses-right":           ("10_plank_pulses_right.JPEG",                0.05, 0.15, 0.85),
    "plank-hold-right":             ("11_plank_hold_right.JPEG",                  0.10, 0.15, 0.85),
    # 12_1 is intentionally the same photo as 5 (heel touch), so the exercise reuses heel-touch-air.webp.
    "crunch-glute-bridge-2":        ("12_2_chrunch_glue_bridge.JPEG",             0.05, 0.22, 0.85),
    "toe-touches":                  ("13_toe_touches.JPEG",                       0.10, 0.20, 0.80),
    "toe-reachers":                 ("14_toe_reacher.JPEG",                       0.10, 0.22, 0.85),
    "toe-touch-sit":                ("15_toe_touch_sit.JPEG",                     0.10, 0.20, 0.80),
    "mountain-climbers-cross-fast": ("16_alternating_mountain_climbers_fast.JPEG", 0.10, 0.25, 0.80),
    "mountain-climbers-cross-slow": ("17_alternating_mountain_climbers_slow.JPEG", 0.00, 0.08, 1.00),
    "shin-claps":                   ("18_shin_claps.JPEG",                        0.10, 0.20, 0.80),
    "heel-touches-ground":          ("19_heel_touches_ground.JPEG",               0.10, 0.25, 0.80),
    "hold-45":                      ("20_45_hold.JPEG",                           0.15, 0.20, 0.80),
    "mountain-climbers-fast":       ("21_mountain_climbers_straight_fast.JPEG",   0.10, 0.25, 0.80),
    "mountain-climbers-slow":       ("22_mountain_climbers_straight_slow.JPEG",   0.10, 0.20, 0.75),
    "belly-breathing":              ("23_cool_down_belly_breathing.JPEG",         0.05, 0.20, 0.80),
    "childs-pose":                  ("24_childs_pose.JPEG",                       0.05, 0.25, 0.80),
    # "get ready" screen (portrait original: keep the skyline band)
    "pork-belly-destruction-ready": ("0_intro_skyline.JPEG",                      0.00, 0.40, 1.00),
}


def build(name, src, x0, y0, w):
    im = ImageOps.exif_transpose(Image.open(SRC / src)).convert("RGB")
    W, H = im.size
    cw = round(w * W)
    ch = round(cw / ASPECT)
    left = min(round(x0 * W), W - cw)
    top = min(round(y0 * H), H - ch)
    if ch > H:
        raise SystemExit(f"{name}: crop is taller than the image; lower the crop width")
    im = im.crop((left, top, left + cw, top + ch)).resize((WIDTH, round(WIDTH / ASPECT)), Image.LANCZOS)
    out = OUT / f"{name}.webp"
    im.save(out, "WEBP", quality=QUALITY, method=6)  # no exif= argument -> no metadata written
    return out


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    total = 0
    for name, (src, x0, y0, w) in CROPS.items():
        out = build(name, src, x0, y0, w)
        total += out.stat().st_size
        print(f"{out.name:40} {out.stat().st_size // 1024:4} KB")
    print(f"total {total // 1024} KB")
