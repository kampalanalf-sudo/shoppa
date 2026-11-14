#!/usr/bin/env python3
"""Builds Great Lakes Technology — Portfolio 2026 (investor brochure)."""

import os
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

import content as C
from kit import (Kit, register_fonts, W, H, ML, MR, MT, MB, CONTENT_W, CACHE,
                 INK, INK_DEEP, INK_SOFT, VIOLET, VIOLET_D, CYAN, CYAN_D, GOLD,
                 GOLD_D, WHITE, PAPER, MUTED, MUTED_D, HAIR, EMERALD, ROSE,
                 ACCENTS, rgba, mix)
from reportlab.pdfbase import pdfmetrics

OUT = os.environ.get("BROCHURE_OUT") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..",
    "Great-Lakes-Technology-Portfolio-2026.pdf")

PAGE = 0


def acc(name):
    return ACCENTS[name]


OUTLINE = []


def new_page(c):
    global PAGE
    PAGE += 1
    c.showPage()
    c.setPageSize((W * PT, H * PT))
    c.scale(PT, PT)
    return PAGE


from kit import PT

mm = PT

ASSETS = {
    "bg_page": "bg_page.jpg",
    "bg_quiet": "bg_quiet.jpg",
    "bg_divider": "bg_divider.jpg",
    "bg_back": "bg_back.jpg",
    "bg_cover": "bg_cover.jpg",
    "cover": "cover_full.jpg",
    "band": "band_cover.jpg",
}


def plate(k, name):
    fname = ASSETS.get(name) or (name if "." in name else name + ".jpg")
    return os.path.join(CACHE, fname)


def full_bg(k, name):
    k.image(plate(k, name), 0, 0, W, H)


# ===========================================================================
# 01 — Cover
# ===========================================================================
def page_cover(k):
    full_bg(k, "bg_cover")
    k.image(plate(k, "cover"), 0, 0, W, H)

    # top rule
    k.rule_gradient(ML, H - 22, 46, 0.7, VIOLET, CYAN, alpha=0.95)

    k.label(ML, H - 30.5, "Portfolio · Investor Edition", CYAN, 7.0, 2.4)

    y = 128
    k.text(ML, y + 22, "Great Lakes", "DisplayB", 42, WHITE)
    k.text(ML, y - 2, "Technology", "DisplayB", 42, WHITE)
    k.rule_gradient(ML, y - 9, 64, 0.8, VIOLET, CYAN, alpha=0.9)

    k.text(ML, y - 21, "Eight products. One engineering practice.", "DisplayM", 12.5, PAPER, alpha=0.94)
    k.text(ML, y - 29, "Designed, built and shipped from Kampala, Uganda.", "DisplayM", 12.5, PAPER, alpha=0.94)

    k.hline(ML, 40, 112, HAIR, 0.3, 0.9)
    x = ML
    for i, (cap, val, colr) in enumerate([
            ("Office", "Plot 14 Martyrs Drive, Ntinda", PAPER),
            ("Director", C.DIRECTOR, PAPER),
            ("Contact", C.LINKEDIN, CYAN)]):
        cx = ML + i * 40
        k.text(cx, 33, cap.upper(), "BodySB", 5.6, MUTED_D, tracking=1.6)
        k.text(cx, 27.5, val, "BodyM", 7.6, colr)

    k.link(ML + 80, 26.5, 46, 5.5, "https://linkedin.com/kampalan")
    k.text(W - MR, 14, "2026", "DisplayB", 7.2, MUTED_D, align="right")
    k.text(ML, 14, "Portfolio · Investor Edition", "BodyR", 7.0, MUTED_D)


# ===========================================================================
# 02 — Contents
# ===========================================================================
def page_contents(k):
    full_bg(k, "bg_quiet")
    k.image(plate(k, "band_cover.png"), 0, H - 64, W, 64, mask="auto")

    k.label(ML, H - 24, "Contents", CYAN, 7.0, 2.4)
    k.text(ML, H - 42, "The book", "DisplayB", 26, WHITE)
    k.text(ML + 44, H - 42, "at a glance", "DisplayM", 26, MUTED_D, alpha=0.55)

    rows = [
        ("I", "The studio", "Mission, positioning, how we work, platform and standards", "03"),
        ("II", "The portfolio", "Eight products, each on a full spread", "10"),
        ("III", "The business", "Traction, roadmap, commercial focus and engagement", "26"),
    ]
    y = 146
    for num, title, sub, page in rows:
        k.hline(ML, y + 12, CONTENT_W, HAIR, 0.3, 0.85)
        k.text(ML, y, num, "DisplayB", 15, VIOLET)
        k.text(ML + 14, y + 1.5, title, "DisplaySB", 13, WHITE)
        k.text(ML + 58, y, sub, "BodyR", 8.0, MUTED)
        k.text(W - MR, y + 1, page, "DisplaySB", 12, CYAN, align="right")
        y -= 26

    # product index grid
    k.label(ML, 60, "Products in this book", MUTED_D, 6.2, 1.9)
    k.hline(ML, 56.5, CONTENT_W, HAIR, 0.3, 0.85)

    col_w = CONTENT_W / 4
    for i, (name, sector, _, accent) in enumerate(C.AT_A_GLANCE):
        cx = ML + (i % 4) * col_w
        cy = 40 - (i // 4) * 15
        k.text(cx, cy, f"{i + 1:02d}", "DisplayB", 7.4, acc(accent))
        k.text(cx + 8, cy, name, "BodySB", 8.2, PAPER)
        k.text(cx + 8, cy - 5.2, sector.upper(), "BodyM", 5.6, MUTED_D, tracking=1.2)

    k.footer(PAGE + 1, "Contents")


# ===========================================================================
# 03 — Mission
# ===========================================================================
def page_mission(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "I · The studio", CYAN, 6.6, 2.2)

    k.text(ML, H - 40, "We build software", "DisplayB", 27, WHITE)
    k.text(ML, H - 52, "for how East Africa", "DisplayB", 27, WHITE)
    k.text(ML, H - 64, "actually works.", "DisplayB", 27, CYAN)

    left_w = 128
    k.block(ML, H - 82, C.MISSION, "BodyR", 8.9, 13.2, MUTED, left_w)

    # pull quote
    k.rect(ML, 52, left_w, 26, fill=VIOLET, alpha=0.07, r=2)
    k.rect(ML, 52, 1.2, 26, fill=VIOLET, alpha=0.9)
    k.block(ML + 7, 71, "Every product in this book runs on the same platform layer — "
                        "identity, data, messaging and delivery we already operate.",
            "DisplayM", 9.0, 13.0, PAPER, left_w - 14)

    k.text(ML, 40, C.DIRECTOR.upper(), "BodySB", 6.6, CYAN, tracking=1.8)
    k.text(ML, 34.5, "Founder & Director", "BodyR", 7.6, MUTED)
    k.text(ML + 42, 34.5, " · ".join(C.ADDRESS), "BodyR", 7.6, MUTED)

    # right column: facts
    x = W - MR - 108
    k.label(x, H - MT - 2, "At a glance", MUTED_D, 6.2, 1.9)
    y = H - 40
    for value, cap in C.TRACTION:
        k.text(x, y, value, "DisplayB", 19, CYAN if value != "100%" else GOLD)
        k.text(x + 26, y, cap, "BodyR", 7.8, MUTED)
        k.hline(x, y - 4.6, 108, HAIR, 0.25, 0.7)
        y -= 17

    k.text(x, y - 1, "Sectors", "BodySB", 6.0, MUTED_D, tracking=1.6)
    sectors = ["Gaming", "Retail", "Events", "Mobility", "Music", "Media", "Fintech", "Institutions"]
    k.chip_row(x, y - 11, sectors, CYAN, w_max=108, size=5.8, h=4.4)

    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 04 — Positioning
# ===========================================================================
def page_positioning(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Why this portfolio is different", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "Four things we do that", "DisplayB", 22, WHITE)
    k.text(ML, H - 45, "most local builders do not.", "DisplayB", 22, MUTED_D)

    col_w = (CONTENT_W - 10) / 2
    for i, (title, body) in enumerate(C.POSITIONING):
        cx = ML + (i % 2) * (col_w + 10)
        cy_top = 144 - (i // 2) * 54
        k.card(cx, cy_top - 44, col_w, 44, VIOLET if i % 2 == 0 else CYAN, r=2.6)
        k.text(cx + 7, cy_top - 12, f"0{i + 1}", "DisplayB", 14,
               VIOLET if i % 2 == 0 else CYAN, alpha=0.85)
        k.text(cx + 20, cy_top - 10.5, title, "DisplaySB", 10.2, WHITE)
        k.block(cx + 7, cy_top - 21, body, "BodyR", 7.7, 11.4, MUTED, col_w - 14)

    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 05 — Capabilities
# ===========================================================================
def page_capabilities(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "Capabilities", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "One team across the whole stack", "DisplayB", 21, WHITE)
    k.text(ML, H - 44, "Design, interface, API, data, delivery and operations — in-house.",
           "BodyR", 8.6, MUTED)

    col_w = (CONTENT_W - 2 * 7) / 3
    for i, (title, items) in enumerate(C.CAPABILITIES):
        cx = ML + (i % 3) * (col_w + 7)
        cy_top = 132 - (i // 3) * 58
        accent = [VIOLET, CYAN, GOLD, EMERALD, ROSE, VIOLET][i]
        k.hline(cx, cy_top, col_w, accent, 0.9, 0.8)
        k.text(cx, cy_top - 7, title, "DisplaySB", 10.0, WHITE)
        yy = cy_top - 15
        for it in items:
            k.circle(cx + 1.0, yy + 1.5, 0.55, accent)
            yy = k.block(cx + 5, yy + 3.4, it, "BodyR", 7.4, 10.6, MUTED, col_w - 6) - 4.6

    k.text(ML, 32, "Every capability above ships in at least one live product in this book.",
           "BodyM", 7.2, MUTED_D)
    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 06 — Method
# ===========================================================================
def page_method(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "How we work", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "A repeatable path from intent to operating", "DisplayB", 21, WHITE)

    y = 152
    for i, (num, title, body) in enumerate(C.METHOD):
        accent = [VIOLET, CYAN, GOLD, EMERALD, ROSE][i]
        k.hline(ML, y + 11, CONTENT_W, HAIR, 0.25, 0.8)
        k.text(ML, y, num, "DisplayB", 13, accent)
        k.text(ML + 16, y + 1, title, "DisplaySB", 11.2, WHITE)
        k.block(ML + 62, y + 4, body, "BodyR", 7.9, 11.6, MUTED, CONTENT_W - 62)
        y -= 22

    k.rect(ML, 26, CONTENT_W, 26, fill=GOLD, alpha=0.06, r=2.4)
    k.rect(ML, 26, CONTENT_W, 26, fill=None, stroke=GOLD, lw=0.3, r=2.4, stroke_alpha=0.22)
    k.label(ML + 7, 44, "Operating principle", GOLD, 6.0, 1.8)
    k.block(ML + 7, 38, "Nothing is described as live unless it is live, and nothing is described as "
                        "secure unless the control is written down and enforced on the server.",
            "DisplayM", 9.4, 13.4, PAPER, CONTENT_W - 14)

    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 07 — Platform
# ===========================================================================
def page_platform(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "The platform layer", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "What is already built", "DisplayB", 21, WHITE)
    k.text(ML, H - 43, "Five products share these rails. A sixth launches on them in weeks.",
           "BodyR", 8.6, MUTED)

    y = 148
    for i, (layer, stack) in enumerate(C.PLATFORM):
        accent = [VIOLET, CYAN, GOLD, EMERALD, ROSE, VIOLET, CYAN][i]
        k.hline(ML, y + 8.6, CONTENT_W, HAIR, 0.25, 0.8)
        k.text(ML, y + 2.4, layer.upper(), "BodySB", 6.4, accent, tracking=1.7)
        k.block(ML + 34, y + 7, stack, "BodyR", 8.0, 11.4, MUTED, CONTENT_W - 34)
        y -= 19.5

    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 08 — Standards
# ===========================================================================
def page_standards(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Standards & posture", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "Security and honesty, written down", "DisplayB", 21, WHITE)

    col_w = (CONTENT_W - 8) / 2
    for i, (title, body) in enumerate(C.STANDARDS):
        cx = ML + (i % 2) * (col_w + 8)
        cy_top = 140 - (i // 2) * 52
        accent = [EMERALD, CYAN, VIOLET, GOLD][i]
        k.rect(cx, cy_top - 42, col_w, 42, fill=WHITE, alpha=0.055, r=2.4)
        k.rect(cx, cy_top - 42, col_w, 42, fill=None, stroke=accent, lw=0.3, r=2.4, stroke_alpha=0.22)
        k.circle(cx + 9, cy_top - 11, 3.4, accent, alpha=0.12)
        k.circle(cx + 9, cy_top - 11, 1.15, accent)
        k.text(cx + 16, cy_top - 9.6, title, "DisplaySB", 10.0, WHITE)
        k.block(cx + 7, cy_top - 21, body, "BodyR", 7.7, 11.4, MUTED, col_w - 14)

    k.text(ML, 24, "Full security model documented in each repository README.",
           "BodyM", 7.2, MUTED_D)
    k.footer(PAGE + 1, "The studio")


# ===========================================================================
# 09 — Divider: the portfolio
# ===========================================================================
def page_portfolio_divider(k):
    full_bg(k, "bg_divider")
    k.label(ML, H - MT - 2, "II · The portfolio", GOLD, 6.8, 2.4)
    k.text(ML, 118, "Eight products", "DisplayB", 40, WHITE)
    k.text(ML, 103, "in production or pilot", "DisplayB", 40, CYAN)
    k.rule_gradient(ML, 94, 70, 0.8, VIOLET, CYAN)

    k.block(ML, 84, "Each product occupies two pages: the proposition and the engineering. "
                    "Four run on live custom domains today; the remainder are pilots with a "
                    "written path to commercial launch.", "BodyR", 8.8, 13.0, MUTED, 120)

    # index list
    x = W - MR - 98
    y = 150
    for i, (name, sector, _, accent) in enumerate(C.AT_A_GLANCE):
        k.text(x, y, f"{i + 1:02d}", "DisplayB", 7.4, acc(accent))
        k.text(x + 10, y, name, "BodySB", 8.0, PAPER)
        k.text(x + 10, y - 4.4, sector.upper(), "BodyM", 5.4, MUTED_D, tracking=1.2)
        y -= 14.5
    k.vline(x - 5, y + 6, 112, HAIR, 0.3, 0.8)

    k.footer(PAGE + 1, "The portfolio")


# ===========================================================================
# Product spreads
# ===========================================================================
def page_product_story(k, p, idx):
    full_bg(k, f"story_{p['art']}")
    accent = acc(p["accent"])

    k.label(ML, H - MT - 2, f"{idx:02d} · {p['kicker']}", accent, 6.6, 2.2)
    k.text(ML, H - 34, p["name"], "DisplayB", 27, WHITE)
    k.hline(ML, H - 38.5, 40, accent, 0.8, 0.9)

    k.block(ML, H - 47, p["tagline"], "DisplayM", 11.4, 15.6, PAPER, 128)

    k.block(ML, H - 72, p["summary"], "BodyR", 8.4, 12.6, MUTED, 126)

    # status row
    y = 96
    k.chip(ML, y, p["status"], accent, size=6.0, h=4.8)
    w = pdfmetrics.stringWidth(p["status"], "BodySB", 6.0) + 7.2
    k.text(ML + w + 3, y + 1.5, p["url"], "BodyM", 6.8, MUTED_D)

    # metrics
    y = 78
    k.hline(ML, y + 10, 128, HAIR, 0.3, 0.85)
    for i, (value, cap) in enumerate(p["metrics"]):
        k.stat(ML + i * 43, y, value, cap, accent, vsize=16, w=40)

    # sector / sector line
    k.text(ML, 46, "SECTOR", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(ML, 40, p["sector"], "BodyM", 8.0, PAPER)
    k.text(ML + 52, 46, "STAGE", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(ML + 52, 40, p["status"].split("·")[0].strip(), "BodyM", 8.0, PAPER)

    k.footer(PAGE + 1, p["name"])


def page_product_engineering(k, p, idx):
    full_bg(k, f"eng_{p['art']}")
    accent = acc(p["accent"])

    k.hline(ML, H - 66, CONTENT_W, accent, 0.35, 0.30)
    k.label(ML, H - 74, "What it does", accent, 6.2, 2.0)

    col_w = (CONTENT_W - 9) / 2
    for i, (title, body) in enumerate(p["highlights"]):
        cx = ML + (i % 2) * (col_w + 9)
        cy_top = 128 - (i // 2) * 36
        k.circle(cx + 1.2, cy_top + 1.6, 0.75, accent)
        k.text(cx + 6, cy_top, title, "DisplaySB", 9.6, WHITE)
        k.block(cx + 6, cy_top - 6.5, body, "BodyR", 7.5, 11.2, MUTED, col_w - 8)
        k.hline(cx, cy_top - 30, col_w, HAIR, 0.25, 0.7)

    # architecture strip
    k.rect(ML, 20, CONTENT_W, 32, fill=WHITE, alpha=0.04, r=2.2)
    k.rect(ML, 20, CONTENT_W, 32, fill=None, stroke=accent, lw=0.3, r=2.2, stroke_alpha=0.16)
    k.label(ML + 6, 45.5, "How it is built", accent, 5.9, 1.8)
    aw = (CONTENT_W - 12) / 4
    for i, (layer, body) in enumerate(p["arch"]):
        ax = ML + 6 + i * aw
        k.text(ax, 39.5, layer.upper(), "BodySB", 5.8, PAPER, tracking=1.4)
        k.block(ax, 35.5, body, "BodyR", 6.6, 9.4, MUTED_D, aw - 4)

    # note
    k.text(ML, 12.5, p["note"], "DisplayM", 8.2, accent, alpha=0.85)
    k.footer(PAGE + 1, p["name"])


# ===========================================================================
# 25 — Traction / at a glance
# ===========================================================================
def page_traction(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "III · The business", GOLD, 6.6, 2.2)
    k.text(ML, H - 34, "Where the portfolio stands", "DisplayB", 21, WHITE)

    # metric band
    y = 152
    for i, (value, cap) in enumerate(C.TRACTION):
        cx = ML + i * (CONTENT_W / 5)
        k.text(cx, y, value, "DisplayB", 20, [CYAN, VIOLET, GOLD, EMERALD, PAPER][i])
        k.block(cx, y - 4, cap, "BodyR", 6.8, 9.4, MUTED_D, CONTENT_W / 5 - 5)
        if i:
            k.vline(cx - 4, y - 1, 16, HAIR, 0.25, 0.7)
    k.hline(ML, y - 16, CONTENT_W, HAIR, 0.3, 0.85)

    # table
    k.label(ML, 122, "Product · market · what is live", MUTED_D, 6.0, 1.8)
    y = 115
    k.hline(ML, y, CONTENT_W, HAIR, 0.3, 0.85)
    for i, (name, sector, detail, accent) in enumerate(C.AT_A_GLANCE):
        k.text(ML, y - 8, f"{i + 1:02d}", "DisplaySB", 7.2, acc(accent), alpha=0.9)
        k.text(ML + 9, y - 8, name, "BodySB", 8.2, PAPER)
        k.text(ML + 74, y - 8, sector.upper(), "BodyM", 5.8, acc(accent), tracking=1.3)
        k.text(ML + 104, y - 8, detail, "BodyR", 7.6, MUTED)
        k.hline(ML, y - 11.4, CONTENT_W, HAIR, 0.22, 0.55)
        y -= 11.8

    k.text(ML, 16.5, "Live status reflects the deployed build as documented in each repository.",
           "BodyR", 6.6, MUTED_D)
    k.footer(PAGE + 1, "The business")


# ===========================================================================
# 26 — Roadmap
# ===========================================================================
def page_roadmap(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Roadmap", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "From built, to commercial, to platform", "DisplayB", 20, WHITE)

    # timeline rail
    rail_y = 100
    k.hline(ML, rail_y, CONTENT_W, HAIR, 0.4, 0.9)

    for i, (when, title, body, accent) in enumerate(C.ROADMAP):
        cx = ML + i * (CONTENT_W / 4) + 2
        a = acc(accent)
        k.circle(cx, rail_y, 2.2, a, alpha=0.18)
        k.circle(cx, rail_y, 0.95, a)
        k.vline(cx, rail_y + 2.2, 6, a, 0.4, 0.40)
        k.text(cx, rail_y + 32, when.upper(), "BodySB", 6.2, a, tracking=1.8)
        k.text(cx, rail_y + 24, title, "DisplaySB", 10.0, WHITE)
        k.block(cx, rail_y + 18, body, "BodyR", 7.4, 11.0, MUTED, CONTENT_W / 4 - 8)

        # lower half: deliverables
    k.hline(ML, 86, CONTENT_W, HAIR, 0.25, 0.7)

    k.label(ML, 79, "Commercial focus", GOLD, 6.0, 1.8)
    focus = [
        ("Rebuy", "Subscription per shop, with a platform take rate on messaging volume.",
         "emerald"),
        ("Tank Tickets", "A transparent fee per issued ticket, paid by the organiser.", "cyan"),
        ("Trampo", "Commission per completed trip once dispatch is licensed.", "violet"),
    ]
    y = 69
    for name, body, accent in focus:
        k.text(ML, y, name, "DisplaySB", 9.6, acc(accent))
        k.block(ML + 40, y + 3, body, "BodyR", 7.6, 11.0, MUTED, CONTENT_W - 40)
        k.hline(ML, y - 8, CONTENT_W, HAIR, 0.22, 0.55)
        y -= 19

    k.footer(PAGE + 1, "The business")


# ===========================================================================
# 27 — Engagement + back cover
# ===========================================================================
def page_engagement(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "Engagement", GOLD, 6.6, 2.2)
    k.text(ML, H - 34, "What we are asking for", "DisplayB", 21, WHITE)

    col_w = (CONTENT_W - 10) / 3
    for i, (title, body) in enumerate(C.ENGAGEMENT):
        cx = ML + i * (col_w + 5)
        accent = [VIOLET, CYAN, GOLD][i]
        k.hline(cx, 150, col_w, accent, 0.9, 0.9)
        k.text(cx, 142, f"0{i + 1}", "DisplayB", 12, accent, alpha=0.8)
        k.text(cx, 132, title, "DisplaySB", 9.8, WHITE)
        k.block(cx, 125, body, "BodyR", 7.6, 11.2, MUTED, col_w)

    # closing statement
    k.rect(ML, 46, CONTENT_W, 52, fill=VIOLET, alpha=0.07, r=2.6)
    k.rect(ML, 46, CONTENT_W, 52, fill=None, stroke=VIOLET, lw=0.35, r=2.6, stroke_alpha=0.30)
    k.label(ML + 9, 88, "In closing", CYAN, 6.0, 1.9)
    k.text(ML + 9, 76, "Eight products, one practice, one city.", "DisplayB", 16, WHITE)
    k.block(ML + 9, 68,
            "Great Lakes Technology has already answered the hardest question for an early "
            "investor: can this team take an idea all the way to a live, secure, well-crafted "
            "product? Eight times over, from Kampala.",
            "BodyR", 8.0, 11.8, MUTED, CONTENT_W - 22)

    k.footer(PAGE + 1, "Engagement")


def page_back(k):
    full_bg(k, "bg_back")
    k.image(plate(k, "orn_back.png"), W - 128, -26, 152, 152, mask="auto")
    k.rule_gradient(ML, H - 24, 46, 0.7, VIOLET, CYAN, alpha=0.95)
    k.label(ML, H - 33, "Portfolio · Investor Edition · 2026", CYAN, 6.8, 2.3)

    k.text(ML, 112, "Great Lakes", "DisplayB", 34, WHITE)
    k.text(ML, 97, "Technology", "DisplayB", 34, WHITE)
    k.text(ML, 84, "Kampala, Uganda", "DisplayM", 12, CYAN)

    k.hline(ML, 68, 96, HAIR, 0.3, 0.9)
    x = ML
    k.text(x, 60, "DIRECTOR", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(x, 54, C.DIRECTOR, "BodyM", 8.4, PAPER)
    k.text(x + 46, 60, "LINKEDIN", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(x + 46, 54, C.LINKEDIN, "BodyM", 8.4, CYAN)
    k.text(x, 44, "OFFICE", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(x, 38, ", ".join(C.ADDRESS), "BodyM", 8.4, PAPER)

    k.text(ML, 75, "Design, engineering and product strategy by the founding team.",
           "BodyR", 6.8, MUTED_D)

    k.text(ML, 14, "© 2026 Great Lakes Technology. All product names and builds described are the "
                   "work of the studio.", "BodyR", 6.2, MUTED_D)


# ===========================================================================
# Build
# ===========================================================================
def build():
    register_fonts()
    c = canvas.Canvas(OUT, pagesize=(W * PT, H * PT))
    c.setTitle("Great Lakes Technology — Portfolio 2026")
    c.setAuthor("Great Lakes Technology")
    c.setSubject("Investor portfolio brochure: eight products built in Kampala, Uganda")
    c.setCreator("Great Lakes Technology")
    c.setKeywords("Great Lakes Technology, Kampala, Uganda, portfolio, investor, SaaS, fintech")

    k = Kit(c)
    global PAGE
    PAGE = 0
    c.setPageSize((W * PT, H * PT))
    c.scale(PT, PT)

    def bookmark(title, level=0, key=None, parent=None):
        nonlocal c
        nm = key or f"pg{PAGE}"
        c.bookmarkPage(nm)
        c.addOutlineEntry(title, nm, level=level, closed=False)

    page_cover(k)                                    # 01
    bookmark("Cover")
    new_page(c)
    page_contents(k)                                 # 02
    bookmark("Contents")
    new_page(c)
    page_mission(k)                                  # 03
    bookmark("The studio", 0)
    bookmark("Mission", 1)
    new_page(c)
    page_positioning(k)                              # 04
    bookmark("Why we are different", 1)
    new_page(c)
    page_capabilities(k)                             # 05
    bookmark("Capabilities", 1)
    new_page(c)
    page_method(k)                                   # 06
    bookmark("How we work", 1)
    new_page(c)
    page_platform(k)                                 # 07
    bookmark("The platform layer", 1)
    new_page(c)
    page_standards(k)                                # 08
    bookmark("Standards & posture", 1)
    new_page(c)
    page_portfolio_divider(k)                        # 09
    bookmark("The portfolio", 0)
    new_page(c)

    for i, p in enumerate(C.PRODUCTS, start=1):
        page_product_story(k, p, i)
        bookmark(p["name"], 1)
        new_page(c)
        page_product_engineering(k, p, i)
        bookmark(f"{p['name']} — engineering", 2)
        new_page(c)

    page_traction(k)                                 # 25
    bookmark("The business", 0)
    bookmark("Where the portfolio stands", 1)
    new_page(c)
    page_roadmap(k)                                  # 26
    bookmark("Roadmap & commercial focus", 1)
    new_page(c)
    page_engagement(k)                               # 27
    bookmark("Engagement", 1)
    new_page(c)
    page_back(k)                                     # 28
    bookmark("Contact")
    c.save()
    return OUT, PAGE


if __name__ == "__main__":
    out, pages = build()
    print(f"wrote {out} ({pages + 1} pages)")
