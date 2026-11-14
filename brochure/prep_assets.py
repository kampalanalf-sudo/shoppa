#!/usr/bin/env python3
"""Generate background plates and pre-crop key art for the brochure."""
import os, math, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)

DPI = 200
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


def save(im, name, quality=90):
    p = os.path.join(CACHE, name)
    im.save(p, quality=quality, optimize=True, progressive=True)
    return p


# --------------------------------------------------------------------------
# Page plates
# --------------------------------------------------------------------------
def plates():
    # standard interior page
    save(base_page([
        ((PW * 0.05, PH * -0.05), PW * 0.62, VIOLET, 0.30),
        ((PW * 0.98, PH * 1.02), PW * 0.55, CYAN, 0.20),
    ]), "bg_page.jpg")

    # darker, quieter page for text-heavy spreads
    save(base_page([
        ((PW * 0.1, PH * 0.05), PW * 0.5, VIOLET, 0.13),
        ((PW * 1.0, PH * 0.95), PW * 0.45, CYAN, 0.10),
    ]), "bg_quiet.jpg")

    # divider / section opener — stronger
    save(base_page([
        ((PW * 0.5, PH * 1.05), PW * 0.95, VIOLET, 0.45),
        ((PW * 0.15, PH * 0.0), PW * 0.55, CYAN, 0.22),
        ((PW * 0.9, PH * 0.1), PW * 0.4, GOLD, 0.10),
    ]), "bg_divider.jpg")

    # back cover
    save(base_page([
        ((PW * 0.5, PH * 0.15), PW * 0.8, VIOLET, 0.38),
        ((PW * 0.5, PH * 1.15), PW * 0.7, CYAN, 0.18),
    ]), "bg_back.jpg")

    # cover base (art goes on top)
    save(base_page([
        ((PW * 0.62, PH * 0.18), PW * 0.85, VIOLET, 0.34),
        ((PW * 0.15, PH * 0.95), PW * 0.6, CYAN, 0.16),
    ], grid=False), "bg_cover.jpg")


# --------------------------------------------------------------------------
# Art crops
# --------------------------------------------------------------------------
def feather_mask(size, side, extent, power=1.8):
    """L mask: 0 at the named edge, 255 beyond the ramp."""
    w, h = size
    n = 1200
    ramp = [int(255 * ((i / (n - 1)) ** power)) for i in range(n)]
    mask = Image.new("L", (w, h), 255)
    px = mask.load()
    extent = max(1, min(extent, (w if side in ("left", "right") else h) - 1))
    if side in ("left", "right"):
        for x in range(w):
            if side == "left":
                idx = min(n - 1, int(x / extent * (n - 1))) if x < extent else n - 1
            else:
                d = w - 1 - x
                idx = min(n - 1, int(d / extent * (n - 1))) if d < extent else n - 1
            a = ramp[idx]
            for y in range(h):
                px[x, y] = a
    else:
        for y in range(h):
            if side == "top":
                idx = min(n - 1, int(y / extent * (n - 1))) if y < extent else n - 1
            else:
                d = h - 1 - y
                idx = min(n - 1, int(d / extent * (n - 1))) if d < extent else n - 1
            a = ramp[idx]
            for x in range(w):
                px[x, y] = a
    return mask


def crop_cover(src, out_w, out_h, focus=0.5, focus_y=0.5):
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


def linear_fade(im, side, extent, colour=INK, max_alpha=252, gamma=1.8, ease=0.0):
    """Fade one edge of the artwork into the page colour.

    side   : the edge that becomes page colour ('left','right','top','bottom')
    extent : ramp length in pixels measured from that edge
    ease   : fraction of the ramp held fully opaque before the falloff
    """
    w, h = im.size
    extent = max(1, int(extent))
    n = 1024

    def alpha_at(t):
        # t: 0 at the faded edge, 1 at the far end of the ramp
        u = max(0.0, (t - ease) / max(1e-6, 1 - ease))
        return int(max_alpha * (min(1.0, u) ** gamma))

    mask = Image.new("L", (w, h), max_alpha)
    px = mask.load()

    if side in ("left", "right"):
        col = [alpha_at(i / max(1, extent - 1)) for i in range(extent)]
        for x in range(w):
            if side == "left":
                a = col[x] if x < extent else max_alpha
            else:
                a = col[w - 1 - x] if (w - 1 - x) < extent else max_alpha
            for y in range(h):
                px[x, y] = a
    else:
        row = [alpha_at(i / max(1, extent - 1)) for i in range(extent)]
        for y in range(h):
            if side == "top":
                a = row[y] if y < extent else max_alpha
            else:
                a = row[h - 1 - y] if (h - 1 - y) < extent else max_alpha
            for x in range(w):
                px[x, y] = a

    layer = Image.new("RGB", (w, h), colour)
    # mask == amount of artwork to keep, so im first
    return Image.composite(im, layer, mask)


PRODUCT_KEYS = ["floatbet", "rebuy", "tanktickets", "trampo", "tankdistro", "iuea", "biopay", "grgc"]


def build_crops():
    # full-bleed cover
    cov = crop_cover(os.path.join(ART, "cover.png"), PW, PH, focus=0.55)
    cov = linear_fade(cov, "left", int(PW * 0.58), INK, 252, gamma=1.9, ease=0.30)
    cov = linear_fade(cov, "bottom", int(PH * 0.34), INK, 235, gamma=2.2, ease=0.20)
    save(cov, "cover_full.jpg", 92)

    # Per-product page plates: the art is baked into the page background with a
    # feathered edge, so there is never a seam or a bounding box in the PDF.
    base_page_img = base_page([
        ((PW * 0.05, PH * -0.05), PW * 0.62, VIOLET, 0.30),
        ((PW * 0.98, PH * 1.02), PW * 0.55, CYAN, 0.20),
    ])
    quiet_img = base_page([
        ((PW * 0.1, PH * 0.05), PW * 0.5, VIOLET, 0.13),
        ((PW * 1.0, PH * 0.95), PW * 0.45, CYAN, 0.10),
    ])

    for p in PRODUCT_KEYS:
        # --- story page: full-height art panel on the right
        pw, ph = int(153 * MM), PH
        panel = crop_cover(os.path.join(ART, p + ".png"), pw, ph, focus=0.45).convert("RGB")
        mask = feather_mask((pw, ph), "left", int(pw * 0.40), power=1.9)
        page = base_page_img.copy()
        page.paste(panel, (PW - pw, 0), mask)
        save(page, f"story_{p}.jpg", 90)

        # --- engineering page: art band near the top
        bw, bh = int(268 * MM), int(52 * MM)
        band = crop_cover(os.path.join(ART, p + ".png"), bw, bh, focus=0.5).convert("RGB")
        m = feather_mask((bw, bh), "left", int(bw * 0.16), power=1.7)
        m2 = feather_mask((bw, bh), "right", int(bw * 0.16), power=1.7)
        m3 = feather_mask((bw, bh), "top", int(bh * 0.16), power=2.0)
        m4 = feather_mask((bw, bh), "bottom", int(bh * 0.20), power=2.0)
        mask = ImageChops.multiply(ImageChops.multiply(m, m2), ImageChops.multiply(m3, m4))
        page = quiet_img.copy()
        page.paste(band, (int(14.5 * MM), int(5 * MM)), mask)
        save(page, f"eng_{p}.jpg", 90)

    # portfolio grid cards: 82mm x 52mm
    for p in PRODUCT_KEYS:
        w, h = int(82 * MM), int(52 * MM)
        im = crop_cover(os.path.join(ART, p + ".png"), w, h, focus=0.5)
        save(im, f"card_{p}.jpg", 88)

    # wide dividers 273 x 44
    for p in PRODUCT_KEYS:
        w, h = int(257 * MM), int(44 * MM)
        im = crop_cover(os.path.join(ART, p + ".png"), w, h, focus=0.5)
        im = linear_fade(im, "left", int(w * 0.26), INK, 250, gamma=1.8, ease=0.3)
        im = linear_fade(im, "right", int(w * 0.14), INK, 250, gamma=1.8, ease=0.3)
        save(im, f"strip_{p}.jpg", 88)

    # small index thumbnails 64 x 41
    for p in PRODUCT_KEYS:
        w, h = int(64 * MM), int(41 * MM)
        im = crop_cover(os.path.join(ART, p + ".png"), w, h, focus=0.5)
        save(im, f"thumb_{p}.jpg", 86)

    # contents band — RGBA so it feathers into the page plate with no seam
    bw, bh = int(297 * MM), int(64 * MM)
    band = crop_cover(os.path.join(ART, "cover.png"), bw, bh, focus=0.5).convert("RGB")
    band = Image.blend(band, Image.new("RGB", band.size, INK), 0.28)
    m = ImageChops.multiply(
        feather_mask((bw, bh), "bottom", int(bh * 0.55), power=1.7),
        feather_mask((bw, bh), "left", int(bw * 0.45), power=1.6))
    band = band.convert("RGBA")
    band.putalpha(m)
    band.save(os.path.join(CACHE, "band_cover.png"), optimize=True)

    # back-cover ornament — RGBA, feathered on two edges
    ow, oh = int(150 * MM), int(150 * MM)
    orn = crop_cover(os.path.join(ART, "cover.png"), ow, oh, focus=0.62).convert("RGB")
    orn = Image.blend(orn, Image.new("RGB", orn.size, INK), 0.30)
    m = ImageChops.multiply(
        feather_mask((ow, oh), "left", int(ow * 0.45), power=1.7),
        feather_mask((ow, oh), "top", int(oh * 0.40), power=1.7))
    orn = orn.convert("RGBA")
    orn.putalpha(m)
    orn.save(os.path.join(CACHE, "orn_back.png"), optimize=True)


# --------------------------------------------------------------------------
# Simple vector-ish glyph tiles used for icons (crisp at print size)
# --------------------------------------------------------------------------
def glyphs():
    size = 256
    specs = {
        "grid":    [(64, 64, 108, 108), (148, 64, 192, 108), (64, 148, 108, 192), (148, 148, 192, 192)],
        "bolt":    None,
        "shield":  None,
        "clock":   None,
    }
    return specs


if __name__ == "__main__":
    plates()
    build_crops()
    print("assets ready in", CACHE)
