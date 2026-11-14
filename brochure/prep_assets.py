#!/usr/bin/env python3
"""Generate background plates and pre-crop key art for the brochure."""
import os, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

DPI = int(os.environ.get("BROCHURE_DPI", "200"))
QUALITY = int(os.environ.get("BROCHURE_Q", "90"))
MM = DPI / 25.4          # px per mm
PAGE_W_MM, PAGE_H_MM = 297, 210
PW, PH = int(PAGE_W_MM * MM), int(PAGE_H_MM * MM)

INK    = (7, 7, 14)
INK2   = (11, 12, 26)
VIOLET = (124, 92, 255)
CYAN   = (47, 227, 236)
GOLD   = (242, 182, 90)


def hexc(c, a=255):
    return (c[0], c[1], c[2], a)


def radial(size, centre, radius, colour, opacity=1.0, falloff=2.2):
    """Soft radial glow layer."""
    w, h = size
    small = 4
    im = Image.new("L", (w // small, h // small), 0)
    d = ImageDraw.Draw(im)
    cx, cy = centre[0] / small, centre[1] / small
    r = radius / small
    steps = 28
    for i in range(steps, 0, -1):
        t = i / steps
        val = int(255 * opacity * ((1 - t) ** falloff))
        rr = r * t
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=val)
    im = im.filter(ImageFilter.GaussianBlur(radius * 0.06 / small))
    im = im.resize((w, h), Image.LANCZOS)
    layer = Image.new("RGBA", (w, h), hexc(colour, 0))
    layer.putalpha(im)
    return layer


def grid_layer(size, step, colour, opacity=12):
    w, h = size
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=hexc(colour, opacity), width=1)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=hexc(colour, opacity), width=1)
    return im


def vignette(size, strength=170):
    w, h = size
    small = 8
    im = Image.new("L", (w // small, h // small), 0)
    d = ImageDraw.Draw(im)
    d.ellipse([-w * 0.18 / small, -h * 0.3 / small,
               w * 1.18 / small, h * 1.3 / small], fill=255)
    im = im.filter(ImageFilter.GaussianBlur(w * 0.02 / small))
    im = im.resize((w, h), Image.LANCZOS)
    # invert: transparent in middle, dark at edges
    from PIL import ImageOps
    inv = ImageOps.invert(im)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, strength))
    layer.putalpha(inv)
    return layer


def noise(size, amount=5):
    w, h = size
    rnd = random.Random(7)
    small = Image.new("L", (w // 2, h // 2))
    px = small.load()
    for y in range(small.height):
        for x in range(small.width):
            px[x, y] = 128 + rnd.randint(-amount * 6, amount * 6)
    small = small.resize((w, h), Image.BILINEAR)
    layer = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    layer.putalpha(ImageChops.subtract(small, Image.new("L", (w, h), 128)))
    return layer


LIGHT_BG    = (251, 250, 247)
LIGHT_TINT  = (244, 242, 236)
LIGHT_EDGE  = (231, 227, 217)


def light_page(tint=False, glow=None):
    """Paper-white plate with a whisper of warm tint and a soft edge falloff."""
    base = LIGHT_TINT if tint else LIGHT_BG
    canvas = Image.new("RGBA", (PW, PH), hexc(base))
    # very soft corner washes so the page is not dead flat
    if glow:
        for centre, radius, colour, op in glow:
            canvas = Image.alpha_composite(canvas, radial((PW, PH), centre, radius, colour, op))
    # gentle edge shading
    edge = Image.new("L", (PW // 8, PH // 8), 0)
    d = ImageDraw.Draw(edge)
    d.rectangle([0, 0, edge.width, edge.height], fill=0)
    edge = edge.filter(ImageFilter.GaussianBlur(6))
    edge = edge.resize((PW, PH), Image.LANCZOS)
    shade = Image.new("RGBA", (PW, PH), (214, 208, 196, 22))
    canvas = Image.alpha_composite(canvas, shade)
    return canvas.convert("RGB")


def base_page(glows, grid=True, grain=True):
    canvas = Image.new("RGBA", (PW, PH), hexc(INK))
    # subtle vertical lift
    grad = Image.new("RGBA", (PW, PH))
    gd = ImageDraw.Draw(grad)
    for y in range(PH):
        t = y / PH
        col = (int(7 + 8 * t), int(7 + 9 * t), int(14 + 16 * t), 255)
        gd.line([(0, y), (PW, y)], fill=col)
    canvas = Image.alpha_composite(canvas, grad)
    for centre, radius, colour, op in glows:
        canvas = Image.alpha_composite(canvas, radial((PW, PH), centre, radius, colour, op))
    if grid:
        canvas = Image.alpha_composite(canvas, grid_layer((PW, PH), int(12 * MM), (150, 160, 255), 10))
    canvas = Image.alpha_composite(canvas, vignette((PW, PH), 150))
    if grain:
        canvas = Image.alpha_composite(canvas, noise((PW, PH), 2))
    return canvas.convert("RGB")


def save(im, name, quality=None):
    quality = quality or QUALITY
    cache_dir = os.environ.get("BROCHURE_CACHE", CACHE)
    os.makedirs(cache_dir, exist_ok=True)
    p = os.path.join(cache_dir, name)
    im.save(p, quality=quality, optimize=True, progressive=True)
    return p


# --------------------------------------------------------------------------
# Page plates
# --------------------------------------------------------------------------
def crop_cover(src, out_w, out_h, focus=0.5, focus_y=0.5):
    """Centre-crop (or edge-crop) the source art to the target aspect, then resize."""
    im = Image.open(src).convert("RGB")
    sw, sh = im.size
    target = out_w / out_h
    source = sw / sh
    if source > target:
        nw = int(sh * target)
        x0 = int((sw - nw) * focus)
        im = im.crop((x0, 0, x0 + nw, sh))
    else:
        nh = int(sw / target)
        y0 = int((sh - nh) * focus_y)
        im = im.crop((0, y0, sw, y0 + nh))
    return im.resize((out_w, out_h), Image.LANCZOS)


def plates():
    save(light_page(), "bg_page.jpg")
    save(light_page(tint=True), "bg_quiet.jpg")
    save(light_page(glow=[((PW * 0.5, PH * 0.1), PW * 0.8, (226, 219, 240), 0.55),
                          ((PW * 0.1, PH * 1.0), PW * 0.6, (232, 226, 238), 0.40)]), "bg_divider.jpg")
    save(light_page(glow=[((PW * 0.5, PH * 0.2), PW * 0.9, (228, 220, 240), 0.45)]), "bg_back.jpg")
    save(light_page(glow=[((PW * 0.3, PH * 0.5), PW * 0.8, (232, 226, 240), 0.45)]), "bg_cover.jpg")


PRODUCT_KEYS = [k for k in ["floatbet", "rebuy", "tanktickets", "trampo", "tankdistro",
                            "iuea", "biopay", "grgc", "proxicore", "proxipoint", "proxicast"]
                if os.path.exists(os.path.join(ART, k + ".png"))]


def build_crops():
    # cover: wide art inset (light page, art sits in a frame)
    cov = crop_cover(os.path.join(ART, "cover.png"), int(250 * MM), int(150 * MM), focus=0.55)
    save(cov, "cover_full.jpg")

    # story page inset: 108 x 132 mm portrait plate on the right
    for p in PRODUCT_KEYS:
        im = crop_cover(os.path.join(ART, p + ".png"), int(108 * MM), int(132 * MM), focus=0.5)
        save(im, f"story_{p}.jpg")

    # engineering page band: 120 x 74 mm landscape plate
    for p in PRODUCT_KEYS:
        im = crop_cover(os.path.join(ART, p + ".png"), int(120 * MM), int(74 * MM), focus=0.5)
        save(im, f"eng_{p}.jpg")

    # small index thumbnails 34 x 22
    for p in PRODUCT_KEYS:
        im = crop_cover(os.path.join(ART, p + ".png"), int(34 * MM), int(22 * MM), focus=0.5)
        save(im, f"thumb_{p}.jpg")

    # economics page hero strip
    im = crop_cover(os.path.join(ART, "cover.png"), int(257 * MM), int(34 * MM), focus=0.5)
    save(im, "econ_strip.jpg")


if __name__ == "__main__":
    plates()
    build_crops()
    print("assets ready in", os.environ.get("BROCHURE_CACHE", CACHE), "at", DPI, "dpi / q", QUALITY)
