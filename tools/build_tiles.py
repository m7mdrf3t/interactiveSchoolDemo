#!/usr/bin/env python3
"""Convert 2:1 equirectangular panoramas into Marzipano multi-resolution cube tiles.

    pip install pillow numpy
    python3 tools/build_tiles.py                 # all assets/panoramas/scene-*.jpg
    python3 tools/build_tiles.py scene-03        # one scene

Output (per scene) under assets/tiles/<scene-id>/:
    manifest.json          levels + source size, read by the viewer
    (also assets/thumbs/<scene-id>.jpg, a menu thumbnail at the scene's initialView)
    preview.jpg            six faces stacked vertically, order b d f l r u
    <z>/<face>/<y>/<x>.jpg tiles for levels 1..N (level 0 is the preview)

The viewer falls back to the plain equirect JPEG when no tiles exist, so this step
is an optimisation (fast start, works on phones with 4096px texture limits), not a
requirement.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "panoramas"
DST = ROOT / "assets" / "tiles"

TILE = 512
LEVEL_SIZES = [512, 1024, 2048]   # face sizes of z=1..3
PREVIEW_SIZE = 256
FACE_ORDER = "bdflru"             # Marzipano preview order
QUALITY = 84

# Marzipano's per-face rotation relative to the front face (src/geometries/Cube.js).
FACE_ROT = {
    "f": (0, 0), "b": (0, math.pi), "l": (0, math.pi / 2),
    "r": (0, -math.pi / 2), "u": (math.pi / 2, 0), "d": (-math.pi / 2, 0),
}


def face_directions(face, size):
    """Unit view vectors for every pixel of a face (Marzipano: front = -z, up = +y)."""
    rx, ry = FACE_ROT[face]
    u = (np.arange(size) + 0.5) / size
    x, y = np.meshgrid(u - 0.5, 0.5 - u)          # image row 0 is the top
    z = np.full_like(x, -0.5)
    # gl-matrix rotateX then rotateY
    if rx:
        c, s = math.cos(rx), math.sin(rx)
        y, z = y * c - z * s, y * s + z * c
    if ry:
        c, s = math.cos(ry), math.sin(ry)
        x, z = z * s + x * c, z * c - x * s
    n = np.sqrt(x * x + y * y + z * z)
    return x / n, y / n, z / n


def sample_equirect(img, x, y, z):
    h, w = img.shape[:2]
    yaw = np.arctan2(x, -z)
    pitch = np.arcsin(np.clip(y, -1, 1))
    px = (yaw / (2 * math.pi) + 0.5) * w - 0.5
    py = (0.5 - pitch / math.pi) * h - 0.5
    x0 = np.floor(px).astype(int)
    y0 = np.floor(py).astype(int)
    fx = (px - x0)[..., None]
    fy = (py - y0)[..., None]
    xa, xb = x0 % w, (x0 + 1) % w                 # wrap horizontally
    ya, yb = np.clip(y0, 0, h - 1), np.clip(y0 + 1, 0, h - 1)
    top = img[ya, xa] * (1 - fx) + img[ya, xb] * fx
    bot = img[yb, xa] * (1 - fx) + img[yb, xb] * fx
    return np.clip(top * (1 - fy) + bot * fy, 0, 255).astype(np.uint8)


def make_thumbnail(arr, scene_id, view, w=480, h=300):
    """Rectilinear crop at the scene's initialView, for the location menu."""
    yaw, pitch, fov = (math.radians(view.get(k, d)) for k, d in (("yaw", 0), ("pitch", 0), ("fov", 90)))
    t = math.tan(min(fov, math.radians(100)) / 2)
    a = (np.arange(w) + 0.5) / w - 0.5
    b = 0.5 - (np.arange(h) + 0.5) / h
    x, y = np.meshgrid(a * 2 * t, b * 2 * t * h / w)
    z = np.full_like(x, -1.0)
    c, s = math.cos(pitch), math.sin(pitch)          # rotateX(pitch)
    y, z = y * c - z * s, y * s + z * c
    c, s = math.cos(-yaw), math.sin(-yaw)            # rotateY(-yaw): positive yaw looks right
    x, z = z * s + x * c, z * c - x * s
    n = np.sqrt(x * x + y * y + z * z)
    out = ROOT / "assets" / "thumbs"
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sample_equirect(arr, x / n, y / n, z / n)).save(out / f"{scene_id}.jpg", quality=80)


def initial_views():
    try:
        cfg = json.loads((ROOT / "config" / "tour.json").read_text())
        return {s["id"]: s.get("initialView", {}) for s in cfg["scenes"]}
    except (OSError, KeyError, ValueError):
        return {}


def build(scene_id):
    src = SRC / f"{scene_id}.jpg"
    out = DST / scene_id
    img = Image.open(src).convert("RGB")
    if abs(img.width / img.height - 2) > 0.01:
        sys.exit(f"{src} is {img.width}x{img.height}; expected a 2:1 equirectangular image")
    arr = np.asarray(img, dtype=np.float32)
    print(f"{scene_id}: {img.width}x{img.height}")

    make_thumbnail(arr, scene_id, initial_views().get(scene_id, {}))

    out.mkdir(parents=True, exist_ok=True)
    strip = Image.new("RGB", (PREVIEW_SIZE, PREVIEW_SIZE * 6))
    for i, face in enumerate(FACE_ORDER):
        f = Image.fromarray(sample_equirect(arr, *face_directions(face, PREVIEW_SIZE)))
        strip.paste(f, (0, i * PREVIEW_SIZE))
    strip.save(out / "preview.jpg", quality=QUALITY)

    for z, size in enumerate(LEVEL_SIZES, start=1):
        n = size // TILE if size >= TILE else 1
        for face in FACE_ORDER:
            full = Image.fromarray(sample_equirect(arr, *face_directions(face, size)))
            for ty in range(n):
                d = out / str(z) / face / str(ty)
                d.mkdir(parents=True, exist_ok=True)
                for tx in range(n):
                    box = (tx * TILE, ty * TILE, min((tx + 1) * TILE, size), min((ty + 1) * TILE, size))
                    full.crop(box).save(d / f"{tx}.jpg", quality=QUALITY)

    manifest = {
        "source": {"width": img.width, "height": img.height},
        "tileSize": TILE,
        # z=0 is served from preview.jpg (fallbackOnly)
        "levels": [{"size": PREVIEW_SIZE, "tileSize": PREVIEW_SIZE, "fallbackOnly": True}]
        + [{"size": s, "tileSize": TILE} for s in LEVEL_SIZES],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    ids = sys.argv[1:] or sorted(p.stem for p in SRC.glob("scene-*.jpg"))
    if not ids:
        sys.exit(f"no scene-*.jpg found in {SRC}")
    for sid in ids:
        build(sid)
    print("done")
