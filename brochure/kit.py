#!/usr/bin/env python3
"""Print engine for the Great Lakes Technology brochure.

A small layout kit on top of ReportLab: colour tokens, type ramps,
rules, chips, cards, image plates and running furniture.
Canvas is in millimetres — A4 landscape, 297 x 210.
"""

import os
from reportlab.pdfgen import canvas
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
CACHE = os.path.join(HERE, "cache")

# ---------------------------------------------------------------- page geometry
PT = 72 / 25.4          # points per millimetre
W, H = 297.0, 210.0     # page, in millimetres (drawing space)
ML, MR = 20.0, 20.0
MT, MB = 16.0, 15.0
CONTENT_W = W - ML - MR

# ---------------------------------------------------------------- palette
INK       = HexColor("#08080F")
INK_DEEP  = HexColor("#050509")
INK_SOFT  = HexColor("#0E0F1A")
VIOLET    = HexColor("#7C5CFF")
VIOLET_D  = HexColor("#4B32C3")
CYAN      = HexColor("#2FE3EC")
CYAN_D    = HexColor("#12A0AA")
GOLD      = HexColor("#F2B65A")
GOLD_D    = HexColor("#C8873A")
WHITE     = HexColor("#FFFFFF")
PAPER     = HexColor("#F4F2FF")
MUTED     = HexColor("#A9A6C9")
MUTED_D   = HexColor("#6F6C93")
HAIR      = HexColor("#2A2A44")
EMERALD   = HexColor("#34D399")
ROSE      = HexColor("#FB7185")

ACCENTS = {
    "violet": VIOLET,
    "cyan": CYAN,
    "gold": GOLD,
    "emerald": EMERALD,
    "rose": ROSE,
}


def rgba(col, a):
    return Color(col.red, col.green, col.blue, alpha=a)


def mix(a, b, t):
    return Color(a.red + (b.red - a.red) * t,
                 a.green + (b.green - a.green) * t,
                 a.blue + (b.blue - a.blue) * t)


# ---------------------------------------------------------------- fonts
FAMILIES = {}
_registered = False


def register_fonts():
    global _registered
    if _registered:
        return
    spec = {
        "D":  [("Display", "SpaceGrotesk-{}.ttf", ["400", "500", "600", "700"])],
        "T":  [("Body", "Inter-{}.ttf", ["400", "500", "600", "700"])],
    }
    weights = {"400": "R", "500": "M", "600": "SB", "700": "B"}
    for prefix, entries in spec.items():
        for base, pattern, ws in entries:
            for w in ws:
                name = f"{base}{weights[w]}"
                path = os.path.join(FONTS, pattern.format(w))
                pdfmetrics.registerFont(TTFont(name, path))
                FAMILIES[name] = name
    _registered = True


# ---------------------------------------------------------------- text helpers
def wrap_text(text, font, size, max_w, tracking=0.0):
    """Greedy wrap; honours explicit newlines. Returns list of lines."""
    out = []
    for para in str(text).split("\n"):
        words = para.split()
        if not words:
            out.append("")
            continue
        line = words[0]
        for word in words[1:]:
            trial = line + " " + word
            if string_width(trial, font, size, tracking) <= max_w:
                line = trial
            else:
                out.append(line)
                line = word
        out.append(line)
    return out


def string_width(text, font, size, tracking=0.0):
    w = pdfmetrics.stringWidth(text, font, size)
    if tracking:
        w += tracking * max(0, len(text) - 1)
    return w


class Kit:
    """Drawing kit bound to one canvas."""

    def __init__(self, c: canvas.Canvas):
        self.c = c

    # drawing space is millimetres; type and strokes are specified in points
    @staticmethod
    def fs(size):
        return size / PT

    @staticmethod
    def lw(pts):
        return pts / PT

    # ------------------------------------------------------------ primitives
    def rect(self, x, y, w, h, fill=None, alpha=1.0, stroke=None, lw=0.3,
             r=0.0, stroke_alpha=1.0):
        c = self.c
        c.saveState()
        if fill is not None:
            c.setFillColor(rgba(fill, alpha))
        if stroke is not None:
            c.setStrokeColor(rgba(stroke, stroke_alpha))
            c.setLineWidth(self.lw(lw))
        mode = 0
        if fill is not None and stroke is not None:
            mode = 1
        elif fill is None and stroke is not None:
            mode = 1
        if r:
            c.roundRect(x, y, w, h, r, stroke=0 if fill is not None else 1,
                        fill=1 if fill is not None else 0)
            if stroke is not None:
                c.roundRect(x, y, w, h, r, stroke=1, fill=0)
        else:
            c.rect(x, y, w, h, stroke=1 if stroke is not None else 0,
                   fill=1 if fill is not None else 0)
        c.restoreState()

    def hline(self, x, y, w, col=HAIR, lw=0.3, alpha=1.0):
        c = self.c
        c.saveState()
        c.setStrokeColor(rgba(col, alpha))
        c.setLineWidth(self.lw(lw))
        c.line(x, y, x + w, y)
        c.restoreState()

    def vline(self, x, y, h, col=HAIR, lw=0.3, alpha=1.0):
        c = self.c
        c.saveState()
        c.setStrokeColor(rgba(col, alpha))
        c.setLineWidth(self.lw(lw))
        c.line(x, y, x, y + h)
        c.restoreState()

    def text(self, x, y, s, font="BodyR", size=9, col=PAPER, tracking=0.0,
             alpha=1.0, align="left"):
        c = self.c
        c.saveState()
        c.setFillColor(rgba(col, alpha))
        fs = self.fs(size)
        c.setFont(font, fs)
        if align != "left":
            w = string_width(s, font, size, tracking) / PT
            x = x - w if align == "right" else x - w / 2
        if tracking:
            t = c.beginText()
            t.setTextOrigin(x, y)
            t.setFont(font, fs)
            t.setCharSpace(tracking / PT)
            t.setFillColor(rgba(col, alpha))
            t.textOut(s)
            c.drawText(t)
        else:
            c.drawString(x, y, s)
        c.restoreState()

    def block(self, x, y_top, s, font="BodyR", size=9, leading=None,
              col=MUTED, max_w=100, align="left", first_baseline=None):
        """Draw wrapped paragraph; returns y of the baseline of the last line."""
        leading_mm = (leading or size * 1.52) / PT
        c = self.c
        c.saveState()
        c.setFont(font, self.fs(size))
        c.setFillColor(col)
        fb = first_baseline if first_baseline is not None else size
        y = y_top - fb / PT
        lines = wrap_text(s, font, size, max_w * PT)
        for ln in lines:
            if align == "left":
                c.drawString(x, y, ln)
            elif align == "right":
                c.drawRightString(x, y, ln)
            else:
                c.drawCentredString(x, y, ln)
            y -= leading_mm
        c.restoreState()
        return y + leading_mm

    def measure(self, s, font, size, max_w):
        lines = wrap_text(s, font, size, max_w * PT)
        return len(lines) * size * 1.52 / PT

    # ------------------------------------------------------------ components
    def label(self, x, y, s, col=CYAN, size=6.4, tracking=1.9):
        self.text(x, y, s.upper(), "BodyB", size, col, tracking=tracking)

    def rule_gradient(self, x, y, w, h=None, c1=VIOLET, c2=CYAN, steps=180,
                      alpha=1.0):
        h = h or 0.55
        c = self.c
        seg = w / steps
        for i in range(steps):
            t = i / (steps - 1)
            c.saveState()
            c.setFillColor(rgba(mix(c1, c2, t), alpha))
            c.rect(x + i * seg, y, seg * 1.06, h, stroke=0, fill=1)
            c.restoreState()

    def chip(self, x, y, s, accent=CYAN, size=6.2, pad_x=2.4, h=4.6,
             fill_alpha=0.10, text_col=None, border=True, tracking=0.9):
        w = string_width(s, "BodySB", size, tracking) / PT + pad_x * 2
        self.rect(x, y, w, h, fill=accent, alpha=fill_alpha, r=h / 2)
        if border:
            self.rect(x, y, w, h, fill=None, stroke=accent, lw=0.35, r=h / 2,
                      stroke_alpha=0.55)
        self.text(x + pad_x, y + h / 2 - size * 0.35, s, "BodySB", size,
                  text_col or accent, tracking=tracking)
        return w

    def chip_row(self, x, y, items, accent=CYAN, gap=1.6, w_max=None,
                 size=6.2, h=4.6):
        cx = x
        for s in items:
            w = string_width(s, "BodySB", size, 0.9) / PT + 4.8
            if w_max and cx + w > x + w_max:
                cx = x
                y -= h + 1.6
            self.chip(cx, y, s, accent, size=size, h=h)
            cx += w + gap
        return y

    def stat(self, x, y, value, cap, accent=CYAN, vsize=17, csize=6.2,
             w=40):
        self.text(x, y, value, "DisplayB", vsize, accent)
        self.text(x, y - 4.6, cap.upper(), "BodySB", csize, MUTED_D, tracking=1.3)

    def card(self, x, y, w, h, accent=VIOLET, r=2.4, lift=0.055,
             border_alpha=0.20, fill_alpha=0.055):
        self.rect(x, y, w, h, fill=WHITE, alpha=fill_alpha, r=r)
        self.rect(x, y, w, h, fill=None, stroke=accent, lw=0.3, r=r,
                  stroke_alpha=border_alpha)

    def image(self, path, x, y, w, h, mask=None, alpha=1.0):
        c = self.c
        c.saveState()
        c.setFillAlpha(alpha)
        c.drawImage(ImageReader(path), x, y, w, h, mask=mask)
        c.restoreState()

    def link(self, x, y, w, h, url):
        self.c.linkURL(url, (x, y, x + w, y + h), relative=0)

    def glow_dot(self, x, y, r, col, a1=0.30, rings=4):
        for i in range(rings):
            t = i / rings
            self.circle(x, y, r * (1 + t * 1.9), col, alpha=a1 * (1 - t) ** 1.6)

    def circle(self, x, y, r, col, alpha=1.0, stroke=None, lw=0.3):
        c = self.c
        c.saveState()
        if col is not None:
            c.setFillColor(rgba(col, alpha))
        if stroke is not None:
            c.setStrokeColor(rgba(stroke, alpha))
            c.setLineWidth(self.lw(lw))
        c.circle(x, y, r, stroke=1 if stroke is not None else 0,
                 fill=1 if col is not None else 0)
        c.restoreState()

    # ------------------------------------------------------------ furniture
    def footer(self, page, section="", dark=True):
        y = 8.6
        col = MUTED_D
        self.hline(ML, y + 3.4, CONTENT_W, HAIR, 0.25, 0.75)
        self.text(ML, y, "GREAT LAKES TECHNOLOGY", "BodySB", 5.6, col, tracking=1.5)
        self.text(ML + 44, y, "·", "BodyR", 5.6, col)
        self.text(ML + 47, y, section.upper(), "BodyM", 5.6, col, tracking=1.5)
        self.text(W - MR, y, f"{page:02d}", "DisplaySB", 7.4, PAPER, align="right")
        self.text(W - MR - 9, y, "PORTFOLIO 2026", "BodyM", 5.6, col,
                  tracking=1.4, align="right")

    def page_number_only(self, page, col=MUTED_D):
        self.text(W - MR, 8.6, f"{page:02d}", "DisplaySB", 7.4, col, align="right")
