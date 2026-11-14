#!/usr/bin/env python3
"""Builds Great Lakes Technology — Portfolio 2026 (investor brochure)."""

import os
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

import content as C
from kit import (Kit, register_fonts, W, H, ML, MR, MT, MB, CONTENT_W, CACHE,
                 INK, INK_DEEP, INK_SOFT, PAGE_BG, PAGE_TINT, PAGE_EDGE,
                 VIOLET, VIOLET_D, CYAN, CYAN_D, GOLD,
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

    # brand rule + label
    k.rule_gradient(ML, H - 24, 52, 0.9, VIOLET, CYAN, alpha=1.0)
    k.label(ML, H - 33, "Portfolio · Investor Edition 2026", VIOLET, 7.0, 2.4)

    k.text(ML, 118, "Great Lakes", "DisplayB", 44, INK)
    k.text(ML, 96, "Technology", "DisplayB", 44, INK)
    k.text(ML, 84, "Kampala, Uganda", "DisplayM", 13, CYAN)

    k.block(ML, 74,
            "Eight software products designed, built and shipped in-house — "
            "from casino game engines and retail retention to event commerce, "
            "mobility and proximity infrastructure.",
            "BodyR", 9.2, 14.0, MUTED, 116)

    # art inset, right
    k.image_frame(plate(k, "cover_full.jpg"), 146, 52, 131, 118, r=3.2)

    # contact strip
    k.hline(ML, 42, 118, HAIR, 0.4)
    for i, (cap, val) in enumerate([("Director", C.DIRECTOR),
                                    ("Email", C.EMAIL),
                                    ("LinkedIn", C.LINKEDIN)]):
        cx = ML + i * 40
        k.text(cx, 35, cap.upper(), "BodySB", 5.6, MUTED_D, tracking=1.6)
        k.text(cx, 29.5, val, "BodyM", 7.2, INK)

    k.text(ML, 14, "Plot 14 Martyrs Drive, Ntinda, Kampala", "BodyR", 7.0, MUTED_D)
    k.text(W - MR, 14, "2026", "DisplayB", 7.2, MUTED_D, align="right")


def page_contents(k):
    full_bg(k, "bg_quiet")

    k.label(ML, H - 14, "Contents", VIOLET, 6.8, 2.3)
    k.text(ML, H - 30, "The book at a glance", "DisplayB", 26, INK)
    k.rule_gradient(ML, H - 37, 58, 0.8, VIOLET, CYAN, alpha=0.85)

    rows = [
        ("I", "The studio", "Mission, positioning, how we work, platform and standards", "03"),
        ("II", "The portfolio", f"{len(C.PRODUCTS)} products, each on a spread", "10"),
        ("III", "The economics", "Revenue model, pricing and market opportunity", "32"),
        ("IV", "The ask", "USD 85,000 to 200,000, allocated by product", "35"),
        ("V", "The business", "Roadmap, commercial focus and engagement", "37"),
    ]
    y = 150
    for num, title, sub, page in rows:
        k.hline(ML, y + 10, CONTENT_W, HAIR, 0.4)
        k.text(ML, y, num, "DisplayB", 15, VIOLET)
        k.text(ML + 14, y + 1.5, title, "DisplaySB", 13, INK)
        k.text(ML + 58, y, sub, "BodyR", 8.0, MUTED)
        k.text(W - MR, y + 1, page, "DisplaySB", 12, CYAN, align="right")
        y -= 18.5

    # product index with thumbnails
    k.label(ML, 66, "Products in this book", MUTED_D, 6.2, 1.9)
    k.hline(ML, 62, CONTENT_W, HAIR, 0.4)

    col_w = CONTENT_W / 6
    for i, pr in enumerate(C.PRODUCTS):
        cx = ML + (i % 6) * col_w
        cy = 47 - (i // 6) * 23
        a = acc(pr["accent"])
        if os.path.exists(plate(k, f"thumb_{pr['art']}")):
            k.image_frame(plate(k, f"thumb_{pr['art']}"), cx, cy, 22, 13, r=1.5)
        k.text(cx, cy - 3.6, f"{i + 1:02d} · {pr['name']}", "BodySB", 6.2, INK)
        k.text(cx, cy - 7.2, pr["sector"].upper(), "BodyM", 4.8, a, tracking=0.9)

    k.footer(PAGE + 1, "Contents")


def page_mission(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "I · The studio", VIOLET, 6.6, 2.2)

    k.text(ML, H - 40, "We build software", "DisplayB", 28, INK)
    k.text(ML, H - 53, "for how East Africa", "DisplayB", 28, INK)
    k.text(ML, H - 66, "actually works.", "DisplayB", 28, CYAN)

    left_w = 126
    k.block(ML, H - 84, C.MISSION, "BodyR", 9.0, 13.4, MUTED, left_w)

    k.rect(ML, 50, left_w, 28, fill=VIOLET, alpha=0.055, r=2.4)
    k.rect(ML, 50, 1.4, 28, fill=VIOLET, alpha=1.0)
    k.block(ML + 8, 71, "Every product in this book runs on the same platform layer — "
                        "identity, data, messaging and delivery we already operate.",
            "DisplayM", 9.4, 13.4, INK, left_w - 16)

    k.text(ML, 38, C.DIRECTOR.upper(), "BodySB", 6.6, VIOLET, tracking=1.8)
    k.text(ML, 32.5, "Founder & Director", "BodyR", 7.6, MUTED)
    k.text(ML + 44, 32.5, C.EMAIL, "BodyR", 7.6, MUTED)

    # right column: facts
    x = W - MR - 104
    k.label(x, H - MT - 2, "At a glance", MUTED_D, 6.2, 1.9)
    y = H - 40
    for value, cap in C.TRACTION:
        k.text(x, y, value, "DisplayB", 19, VIOLET if value != "100%" else GOLD)
        k.text(x + 26, y, cap, "BodyR", 7.6, MUTED)
        k.hline(x, y - 4.6, 104, HAIR, 0.35)
        y -= 16

    k.text(x, y - 1, "Sectors", "BodySB", 6.0, MUTED_D, tracking=1.6)
    sectors = ["Gaming", "Retail", "Events", "Mobility", "Music", "Media",
               "Fintech", "Institutions", "Proximity"]
    k.chip_row(x, y - 11, sectors, CYAN, w_max=104, size=5.8, h=4.4)

    k.footer(PAGE + 1, "The studio")


def page_positioning(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Why this portfolio is different", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "Four things we do that", "DisplayB", 22, INK)
    k.text(ML, H - 45, "most local builders do not.", "DisplayB", 22, MUTED)

    col_w = (CONTENT_W - 10) / 2
    for i, (title, body) in enumerate(C.POSITIONING):
        cx = ML + (i % 2) * (col_w + 10)
        cy_top = 144 - (i // 2) * 48
        a = VIOLET if i % 2 == 0 else CYAN
        k.card(cx, cy_top - 40, col_w, 40, a, r=2.6, fill_alpha=0.85)
        k.text(cx + 7, cy_top - 12, f"0{i + 1}", "DisplayB", 14, a)
        k.text(cx + 20, cy_top - 10.5, title, "DisplaySB", 10.2, INK)
        k.block(cx + 7, cy_top - 19, body, "BodyR", 7.8, 11.6, MUTED, col_w - 14)

    k.footer(PAGE + 1, "The studio")


def page_capabilities(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "Capabilities", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "One team across the whole stack", "DisplayB", 21, INK)
    k.text(ML, H - 44, "Design, interface, API, data, delivery and operations — in-house.",
           "BodyR", 8.6, MUTED)

    col_w = (CONTENT_W - 2 * 7) / 3
    for i, (title, items) in enumerate(C.CAPABILITIES):
        cx = ML + (i % 3) * (col_w + 7)
        cy_top = 134 - (i // 3) * 54
        a = [VIOLET, CYAN, GOLD, EMERALD, ROSE, VIOLET][i]
        k.hline(cx, cy_top, col_w, a, 1.1, 1.0)
        k.text(cx, cy_top - 7, title, "DisplaySB", 10.0, INK)
        yy = cy_top - 15
        for it in items:
            k.circle(cx + 1.0, yy + 1.5, 0.55, a)
            yy = k.block(cx + 5, yy + 3.4, it, "BodyR", 7.4, 10.6, MUTED, col_w - 6) - 4.6

    k.text(ML, 30, "Every capability above ships in at least one live product in this book.",
           "BodyM", 7.2, MUTED_D)
    k.footer(PAGE + 1, "The studio")


def page_method(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "How we work", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "A repeatable path from intent to operating", "DisplayB", 21, INK)

    y = 152
    for i, (num, title, body) in enumerate(C.METHOD):
        a = [VIOLET, CYAN, GOLD, EMERALD, ROSE][i]
        k.hline(ML, y + 11, CONTENT_W, HAIR, 0.35)
        k.text(ML, y, num, "DisplayB", 13, a)
        k.text(ML + 16, y + 1, title, "DisplaySB", 11.2, INK)
        k.block(ML + 62, y + 4, body, "BodyR", 7.9, 11.6, MUTED, CONTENT_W - 62)
        y -= 22

    k.rect(ML, 26, CONTENT_W, 26, fill=GOLD, alpha=0.06, r=2.4)
    k.rect(ML, 26, CONTENT_W, 26, fill=None, stroke=GOLD, lw=0.4, r=2.4, stroke_alpha=0.45)
    k.label(ML + 7, 44, "Operating principle", GOLD, 6.0, 1.8)
    k.block(ML + 7, 38, "Nothing is described as live unless it is live, and nothing is described as "
                        "secure unless the control is written down and enforced on the server.",
            "DisplayM", 9.4, 13.4, INK, CONTENT_W - 14)

    k.footer(PAGE + 1, "The studio")


def page_platform(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "The platform layer", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "What is already built", "DisplayB", 21, INK)
    k.text(ML, H - 43, "Every product in this book shares these rails.",
           "BodyR", 8.6, MUTED)

    y = 148
    for i, (layer, stack) in enumerate(C.PLATFORM):
        a = [VIOLET, CYAN, GOLD, EMERALD, ROSE, VIOLET, CYAN][i]
        k.hline(ML, y + 8.6, CONTENT_W, HAIR, 0.35)
        k.text(ML, y + 2.4, layer.upper(), "BodySB", 6.4, a, tracking=1.7)
        k.block(ML + 34, y + 7, stack, "BodyR", 8.0, 11.4, MUTED, CONTENT_W - 34)
        y -= 19.5

    k.footer(PAGE + 1, "The studio")


def page_standards(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Standards & posture", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "Security and honesty, written down", "DisplayB", 21, INK)

    col_w = (CONTENT_W - 8) / 2
    for i, (title, body) in enumerate(C.STANDARDS):
        cx = ML + (i % 2) * (col_w + 8)
        cy_top = 140 - (i // 2) * 52
        a = [EMERALD, CYAN, VIOLET, GOLD][i]
        k.rect(cx, cy_top - 42, col_w, 42, fill=WHITE, alpha=0.92, r=2.4)
        k.rect(cx, cy_top - 42, col_w, 42, fill=None, stroke=PAGE_EDGE, lw=0.4, r=2.4)
        k.circle(cx + 9, cy_top - 11, 3.4, a, alpha=0.16)
        k.circle(cx + 9, cy_top - 11, 1.15, a)
        k.text(cx + 16, cy_top - 9.6, title, "DisplaySB", 10.0, INK)
        k.block(cx + 7, cy_top - 21, body, "BodyR", 7.7, 11.4, MUTED, col_w - 14)

    k.text(ML, 24, "Full security model documented in each repository README.",
           "BodyM", 7.2, MUTED_D)
    k.footer(PAGE + 1, "The studio")


def page_portfolio_divider(k):
    full_bg(k, "bg_divider")
    k.label(ML, H - MT - 2, "II · The portfolio", GOLD, 6.8, 2.4)
    k.text(ML, 118, "Products", "DisplayB", 40, INK)
    k.text(ML, 103, "in production or pilot", "DisplayB", 40, CYAN)
    k.rule_gradient(ML, 94, 70, 0.8, VIOLET, CYAN)

    k.block(ML, 84, "Each product occupies two pages: the proposition and the engineering. "
                    "Live custom domains are noted per product; the remainder are pilots with "
                    "a written path to commercial launch.", "BodyR", 8.8, 13.0, MUTED, 122)

    x = W - MR - 96
    y = 152
    for i, pr in enumerate(C.PRODUCTS):
        k.text(x, y, f"{i + 1:02d}", "DisplayB", 7.4, acc(pr["accent"]))
        k.text(x + 10, y, pr["name"], "BodySB", 8.0, INK)
        k.text(x + 10, y - 4.4, pr["sector"].upper(), "BodyM", 5.2, MUTED_D, tracking=1.2)
        y -= 12.4
    k.vline(x - 5, y + 6, 152 - y, HAIR, 0.35)

    k.footer(PAGE + 1, "The portfolio")


def page_product_story(k, p, idx):
    full_bg(k, "bg_page")
    a = acc(p["accent"])

    # art inset on the right
    k.image_frame(plate(k, f"story_{p['art']}"), 152, 40, 108, 132, r=3.0)
    k.caption(152, 35, f"{idx:02d} — {p['name']}", a)

    k.label(ML, H - MT - 2, f"{idx:02d} · {p['kicker']}", a, 6.6, 2.2)
    k.text(ML, H - 34, p["name"], "DisplayB", 26, INK)
    k.rule_gradient(ML, H - 39, 36, 0.8, a, mix(a, WHITE, 0.35))

    k.block(ML, H - 48, p["tagline"], "DisplayM", 11.2, 15.4, PAPER, 122)
    k.block(ML, H - 60, p["summary"], "BodyR", 8.3, 12.2, MUTED, 122)

    y = 92
    w = k.chip(ML, y, p["status"], a, size=6.0, h=4.8, fill_alpha=0.12)
    k.text(ML + w + 4, y + 1.6, p["url"], "BodyM", 6.8, MUTED_D)

    if p.get("inferred"):
        k.rect(ML, 100, 122, 9, fill=GOLD, alpha=0.09, r=1.6)
        k.text(ML + 4, 103, "Positioning inferred from product naming — confirm against the "
                            "repository.", "BodyR", 6.6, GOLD_D)

    y = 74
    k.hline(ML, y + 10, 126, HAIR, 0.4)
    for i, (value, cap) in enumerate(p["metrics"]):
        k.stat(ML + i * 42, y, value, cap, a, vsize=16, w=40)

    k.text(ML, 44, "SECTOR", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(ML, 38, p["sector"], "BodyM", 8.0, INK)
    k.text(ML + 52, 44, "STAGE", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(ML + 52, 38, p["status"].split("·")[0].strip(), "BodyM", 8.0, INK)

    k.footer(PAGE + 1, p["name"])


def page_product_engineering(k, p, idx):
    full_bg(k, "bg_quiet")
    a = acc(p["accent"])

    k.image_frame(plate(k, f"eng_{p['art']}"), W - MR - 108, 122, 108, 66, r=2.8)
    k.label(ML, H - MT - 2, f"{p['name']} · engineering", a, 6.4, 2.1)
    k.text(ML, H - 32, "What it does, and how it is built", "DisplayB", 20, INK)

    left_w = W - MR - 108 - ML - 9
    col_w = (left_w - 8) / 2
    for i, (title, body) in enumerate(p["highlights"]):
        cx = ML + (i % 2) * (col_w + 8)
        cy_top = 128 if i < 2 else 74
        k.circle(cx + 1.2, cy_top + 1.6, 0.75, a)
        k.text(cx + 6, cy_top, title, "DisplaySB", 9.2, INK)
        k.block(cx + 6, cy_top - 6.5, body, "BodyR", 7.2, 10.8, MUTED, col_w - 6)

    # architecture strip
    k.rect(ML, 22, CONTENT_W, 27, fill=WHITE, alpha=0.92, r=2.2)
    k.rect(ML, 22, CONTENT_W, 27, fill=None, stroke=PAGE_EDGE, lw=0.4, r=2.2)
    k.label(ML + 6, 42, "How it is built", a, 5.9, 1.8)
    aw = (CONTENT_W - 12) / 4
    for i, (layer, body) in enumerate(p["arch"]):
        ax = ML + 6 + i * aw
        k.text(ax, 36.5, layer.upper(), "BodySB", 5.8, INK, tracking=1.4)
        k.block(ax, 32.5, body, "BodyR", 6.6, 9.4, MUTED, aw - 4)

    k.text(ML, 16.2, p["note"], "DisplayM", 8.2, a)
    k.footer(PAGE + 1, p["name"])


def page_econ_intro(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "III · The economics", GOLD, 6.6, 2.2)
    k.text(ML, H - 34, "Where the revenue comes from", "DisplayB", 22, INK)
    k.text(ML, H - 45, "Six products with a pricing basis today.", "DisplayB", 22, MUTED)

    k.block(ML, H - 62, C.REVENUE_INTRO, "BodyR", 8.4, 12.6, MUTED, 176)

    # model table
    y = 118
    k.hline(ML, y + 6, CONTENT_W, INK, 0.7, 0.55)
    heads = [("Product", ML), ("Model", ML + 34), ("Price basis", ML + 88),
             ("Cost note", ML + 140), ("Annual potential", ML + 196)]
    for h, x in heads:
        k.text(x, y, h.upper(), "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.hline(ML, y - 2, CONTENT_W, HAIR, 0.4)

    y -= 9
    for name, model, price, margin, potential, accent in C.REVENUE_TABLE:
        a = acc(accent)
        k.text(ML, y, name, "BodySB", 8.0, INK)
        k.text(ML + 34, y, model, "BodyR", 7.2, MUTED)
        k.text(ML + 88, y, price, "BodyM", 7.2, INK)
        k.text(ML + 140, y, margin, "BodyR", 6.9, MUTED_D)
        k.text(ML + 196, y, potential, "BodyM", 7.2, a)
        k.hline(ML, y - 4.0, CONTENT_W, HAIR, 0.3)
        y -= 11.8

    k.rect(ML, 23, CONTENT_W, 24, fill=GOLD, alpha=0.07, r=2.2)
    k.rect(ML, 23, CONTENT_W, 24, fill=None, stroke=GOLD, lw=0.4, r=2.2, stroke_alpha=0.4)
    k.label(ML + 7, 41, "Read this first", GOLD, 5.8, 1.8)
    k.text(ML + 7, 35, "Modelled unit economics, not reported revenue — no figure here has been billed.",
           "BodyM", 8.2, INK)
    k.text(ML + 7, 29, "Each input is an assumption that should be replaced with live trading data "
                       "before this section is shown outside the studio.",
           "BodyR", 7.2, MUTED)

    k.footer(PAGE + 1, "The economics")


def page_econ_unit(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Unit economics", CYAN, 6.6, 2.2)
    k.text(ML, H - 34, "How each line actually earns", "DisplayB", 21, INK)

    col_w = (CONTENT_W - 10) / 3
    for i, (name, why, proof, accent) in enumerate(C.REVENUE_UNIT):
        cx = ML + i * (col_w + 5)
        a = acc(accent)
        k.hline(cx, 152, col_w, a, 1.2, 1.0)
        k.text(cx, 144, name, "DisplaySB", 12, INK)
        k.block(cx, 137, why, "BodyR", 7.5, 11.2, MUTED, col_w)
        k.text(cx, 98, "WHAT SUPPORTS IT", "BodySB", 5.4, MUTED_D, tracking=1.4)
        k.block(cx, 92, proof, "BodyR", 6.9, 10.4, MUTED_D, col_w)

    # market rows
    k.hline(ML, 72, CONTENT_W, HAIR, 0.4)
    k.label(ML, 65, "Who pays", GOLD, 6.0, 1.8)
    y = 57
    for who, desc, products in C.MARKET:
        k.text(ML, y, who, "BodySB", 7.8, INK)
        k.block(ML + 44, y + 2.6, desc, "BodyR", 7.2, 10.4, MUTED, 118)
        k.text(ML + 170, y, products, "BodyM", 6.9, VIOLET)
        k.hline(ML, y - 6.4, CONTENT_W, HAIR, 0.3)
        y -= 15

    k.footer(PAGE + 1, "The economics")


def page_econ_cost(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "Cost base & assumptions", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "What it costs to run, and what to check", "DisplayB", 20, INK)

    col_w = (CONTENT_W - 10) / 2
    for i, (title, body) in enumerate(C.COST_BASE):
        cx = ML + (i % 2) * (col_w + 10)
        cy_top = 136 - (i // 2) * 30
        k.text(cx, cy_top, f"0{i + 1}", "DisplayB", 11, VIOLET)
        k.text(cx + 9, cy_top, title, "DisplaySB", 10.0, INK)
        k.block(cx + 9, cy_top - 7, body, "BodyR", 7.6, 11.2, MUTED, col_w - 10)
        k.hline(cx, cy_top - 23, col_w, HAIR, 0.3)

    k.label(ML, 74, "Assumptions register", GOLD, 6.0, 1.8)
    y = 67
    for note in C.ECON_NOTES:
        k.circle(ML + 1.2, y + 1.4, 0.7, GOLD)
        k.text(ML + 6, y, note, "BodyR", 7.6, MUTED)
        y -= 8.6

    k.rect(ML, 18, CONTENT_W, 24, fill=VIOLET, alpha=0.05, r=2.2)
    k.rect(ML, 18, CONTENT_W, 24, fill=None, stroke=VIOLET, lw=0.4, r=2.2, stroke_alpha=0.3)
    k.label(ML + 7, 36, "Why we present it this way", CYAN, 5.8, 1.8)
    k.block(ML + 7, 31, "An investor document that invents revenue is worth nothing. "
                        "This section is deliberately conservative and auditable.",
            "DisplayM", 8.6, 11.6, INK, CONTENT_W - 14)

    k.footer(PAGE + 1, "The economics")


def page_ask_summary(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "IV · The ask", GOLD, 6.6, 2.2)
    k.text(ML, H - 36, "The raise", "DisplayB", 24, INK)

    # headline figures
    pb, pc, sb, sc = C.ask_totals()

    k.rect(ML, 118, 104, 52, fill=VIOLET, alpha=0.06, r=3)
    k.rect(ML, 118, 104, 52, fill=None, stroke=VIOLET, lw=0.5, r=3, stroke_alpha=0.35)
    k.label(ML + 8, 160, "Base case · 18 months", VIOLET, 6.0, 1.9)
    k.text(ML + 8, 142, "USD 85,000", "DisplayB", 26, INK)
    k.text(ML + 8, 133, "Two hires and compliance only where revenue is already possible.",
           "BodyR", 7.4, MUTED)
    k.text(ML + 8, 124, f"Product lines {pb:,}   ·   Shared {sb:,}", "BodyM", 7.0, VIOLET)

    k.rect(ML + 112, 118, 104, 52, fill=CYAN, alpha=0.06, r=3)
    k.rect(ML + 112, 118, 104, 52, fill=None, stroke=CYAN, lw=0.5, r=3, stroke_alpha=0.35)
    k.label(ML + 120, 160, "Ceiling · 18 months", CYAN, 6.0, 1.9)
    k.text(ML + 120, 142, "USD 200,000", "DisplayB", 26, INK)
    k.text(ML + 120, 133, "Adds ProxiCore engineering, field kits and wider go-to-market.",
           "BodyR", 7.4, MUTED)
    k.text(ML + 120, 124, f"Product lines {pc:,}   ·   Shared {sc:,}", "BodyM", 7.0, CYAN)

    # use of funds
    k.label(ML, 102, "Use of funds", GOLD, 6.0, 1.8)
    y = 95
    for name, pct, note in C.USE_OF_FUNDS:
        bar_w = 96 * pct / 55.0
        k.text(ML, y, name, "BodySB", 7.8, INK)
        k.rect(ML + 52, y - 0.4, bar_w, 2.8, fill=GOLD, alpha=0.55, r=1.4)
        k.text(ML + 52 + bar_w + 2.5, y, f"{pct}%", "BodyM", 7.0, GOLD)
        k.text(ML + 168, y, note, "BodyR", 6.9, MUTED)
        y -= 9.4

    # terms — stacked, label column then body column
    k.hline(ML, 46, CONTENT_W, HAIR, 0.4)
    y = 40
    for title, body in C.ASK_TERMS:
        k.text(ML, y, title.upper(), "BodySB", 5.8, VIOLET, tracking=1.4)
        k.block(ML + 62, y + 2.6, body, "BodyR", 6.9, 9.6, MUTED, CONTENT_W - 62)
        y -= 8.6

    k.footer(PAGE + 1, "The ask")


def page_ask_breakdown(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Allocation by product", CYAN, 6.6, 2.2)
    k.text(ML, H - 33, "Where every dollar goes", "DisplayB", 21, INK)
    k.text(ML, H - 42, "18-month allocation. Base case and ceiling both reconcile exactly to "
                       "the headline ask.", "BodyR", 8.2, MUTED)

    pb, pc, sb, sc = C.ask_totals()

    y = 148
    k.hline(ML, y + 5, CONTENT_W, INK, 0.7, 0.5)
    for h, x, al in [("Product", ML, "left"), ("USD base", ML + 108, "right"),
                     ("USD ceiling", ML + 138, "right"), ("What it buys", ML + 146, "left")]:
        k.text(x, y, h.upper(), "BodySB", 5.5, MUTED_D, tracking=1.4, align=al)
    k.hline(ML, y - 2, CONTENT_W, HAIR, 0.4)

    y -= 8.4
    for name, base, ceil, what in C.ASK_ROWS:
        zero = ceil == 0
        k.text(ML, y, name, "BodySB", 7.6, INK if not zero else MUTED_D)
        k.text(ML + 108, y, f"{base:,}" if not zero else "—", "BodyM", 7.4,
               INK if not zero else MUTED_D, align="right")
        k.text(ML + 138, y, f"{ceil:,}" if not zero else "—", "BodyM", 7.4,
               CYAN if not zero else MUTED_D, align="right")
        k.block(ML + 146, y + 2.2, what, "BodyR", 6.2, 8.0, MUTED_D, CONTENT_W - 146)
        k.hline(ML, y - 3.6, CONTENT_W, HAIR, 0.25)
        y -= 8.4

    # shared rows
    for name, base, ceil, what in C.ASK_SHARED:
        k.text(ML, y, name, "BodySB", 7.6, GOLD)
        k.text(ML + 108, y, f"{base:,}", "BodyM", 7.4, GOLD, align="right")
        k.text(ML + 138, y, f"{ceil:,}", "BodyM", 7.4, GOLD, align="right")
        k.block(ML + 146, y + 2.2, what, "BodyR", 6.2, 8.0, MUTED_D, CONTENT_W - 146)
        k.hline(ML, y - 3.6, CONTENT_W, HAIR, 0.25)
        y -= 8.4

    # totals row
    k.hline(ML, y + 3.4, CONTENT_W, INK, 0.8, 0.6)
    k.text(ML, y - 1, "TOTAL ASK", "DisplaySB", 9.4, INK)
    k.text(ML + 108, y - 1, f"{pb + sb:,}", "DisplaySB", 9.4, INK, align="right")
    k.text(ML + 138, y - 1, f"{pc + sc:,}", "DisplaySB", 9.4, CYAN, align="right")
    k.text(ML + 146, y - 1, "Reconciles to the headline figure in both cases.",
           "BodyM", 6.8, MUTED)

    k.footer(PAGE + 1, "The ask")


def page_traction(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "IV · The business", GOLD, 6.6, 2.2)
    k.text(ML, H - 34, "Where the portfolio stands", "DisplayB", 21, INK)

    y = 152
    for i, (value, cap) in enumerate(C.TRACTION):
        cx = ML + i * (CONTENT_W / 5)
        k.text(cx, y, value, "DisplayB", 20, [CYAN, VIOLET, GOLD, EMERALD, INK][i])
        k.block(cx, y - 4, cap, "BodyR", 6.8, 9.4, MUTED_D, CONTENT_W / 5 - 5)
        if i:
            k.vline(cx - 4, y - 1, 16, HAIR, 0.35)
    k.hline(ML, y - 16, CONTENT_W, HAIR, 0.4)

    k.label(ML, 122, "Product · market · what is live", MUTED_D, 6.0, 1.8)
    y = 115
    k.hline(ML, y, CONTENT_W, HAIR, 0.4)
    for i, pr in enumerate(C.PRODUCTS):
        k.text(ML, y - 8, f"{i + 1:02d}", "DisplaySB", 7.2, acc(pr["accent"]))
        k.text(ML + 9, y - 8, pr["name"], "BodySB", 8.2, INK)
        k.text(ML + 74, y - 8, pr["sector"].upper(), "BodyM", 5.8, acc(pr["accent"]), tracking=1.2)
        k.text(ML + 104, y - 8, pr["status"], "BodyR", 7.4, MUTED)
        k.hline(ML, y - 11.4, CONTENT_W, HAIR, 0.3)
        y -= 10.6

    k.text(ML, 16.5, "Live status reflects the deployed build as documented in each repository.",
           "BodyR", 6.6, MUTED_D)
    k.footer(PAGE + 1, "The business")


def page_roadmap(k):
    full_bg(k, "bg_quiet")
    k.label(ML, H - MT - 2, "Roadmap", VIOLET, 6.6, 2.2)
    k.text(ML, H - 34, "From built, to commercial, to platform", "DisplayB", 20, INK)

    rail_y = 100
    k.hline(ML, rail_y, CONTENT_W, HAIR, 0.5)
    for i, (when, title, body, accent) in enumerate(C.ROADMAP):
        cx = ML + i * (CONTENT_W / 4) + 2
        a = acc(accent)
        k.circle(cx, rail_y, 2.2, a, alpha=0.20)
        k.circle(cx, rail_y, 0.95, a)
        k.vline(cx, rail_y + 2.2, 6, a, 0.5, 0.45)
        k.text(cx, rail_y + 32, when.upper(), "BodySB", 6.2, a, tracking=1.8)
        k.text(cx, rail_y + 24, title, "DisplaySB", 10.0, INK)
        k.block(cx, rail_y + 18, body, "BodyR", 7.4, 11.0, MUTED, CONTENT_W / 4 - 8)

    k.hline(ML, 86, CONTENT_W, HAIR, 0.35)
    k.label(ML, 79, "Commercial focus", GOLD, 6.0, 1.8)
    focus = [
        ("Rebuy", "Subscription per shop, with a platform take rate on messaging volume.", "emerald"),
        ("Tank Tickets", "A transparent fee per issued ticket, paid by the organiser.", "cyan"),
        ("Trampo", "Commission per completed trip once dispatch is licensed.", "violet"),
        ("ProxiCore", "Per-location or per-device subscription for proximity infrastructure.", "gold"),
    ]
    y = 69
    for name, body, accent in focus:
        k.text(ML, y, name, "DisplaySB", 9.6, acc(accent))
        k.block(ML + 40, y + 3, body, "BodyR", 7.6, 11.0, MUTED, CONTENT_W - 40)
        k.hline(ML, y - 8, CONTENT_W, HAIR, 0.3)
        y -= 17

    k.footer(PAGE + 1, "The business")


def page_engagement(k):
    full_bg(k, "bg_page")
    k.label(ML, H - MT - 2, "Engagement", GOLD, 6.6, 2.2)
    k.text(ML, H - 34, "What we are asking for", "DisplayB", 21, INK)

    col_w = (CONTENT_W - 10) / 3
    for i, (title, body) in enumerate(C.ENGAGEMENT):
        cx = ML + i * (col_w + 5)
        a = [VIOLET, CYAN, GOLD][i]
        k.hline(cx, 150, col_w, a, 1.1, 1.0)
        k.text(cx, 142, f"0{i + 1}", "DisplayB", 12, a)
        k.text(cx, 132, title, "DisplaySB", 9.8, INK)
        k.block(cx, 125, body, "BodyR", 7.6, 11.2, MUTED, col_w)

    k.rect(ML, 46, CONTENT_W, 52, fill=VIOLET, alpha=0.05, r=2.6)
    k.rect(ML, 46, CONTENT_W, 52, fill=None, stroke=VIOLET, lw=0.5, r=2.6, stroke_alpha=0.35)
    k.label(ML + 9, 88, "In closing", CYAN, 6.0, 1.9)
    k.text(ML + 9, 76, "One practice, one city, a portfolio already shipping.",
           "DisplayB", 16, INK)
    k.block(ML + 9, 68,
            "Great Lakes Technology has already answered the hardest question for an early "
            "investor: can this team take an idea all the way to a live, secure, well-crafted "
            "product? Repeatedly, from Kampala.",
            "BodyR", 8.0, 11.8, MUTED, CONTENT_W - 22)

    k.footer(PAGE + 1, "Engagement")


def page_back(k):
    full_bg(k, "bg_back")
    k.rule_gradient(ML, H - 24, 52, 0.9, VIOLET, CYAN)

    k.text(ML, 118, "Great Lakes", "DisplayB", 34, INK)
    k.text(ML, 103, "Technology", "DisplayB", 34, INK)
    k.text(ML, 90, "Kampala, Uganda", "DisplayM", 12, CYAN)

    k.hline(ML, 74, 108, HAIR, 0.4)
    for i, (cap, val) in enumerate([("Director", C.DIRECTOR),
                                    ("Email", C.EMAIL),
                                    ("LinkedIn", C.LINKEDIN)]):
        cx = ML + i * 42
        k.text(cx, 66, cap.upper(), "BodySB", 5.6, MUTED_D, tracking=1.5)
        k.text(cx, 60, val, "BodyM", 8.0, INK if i < 1 else CYAN)
    k.text(ML, 50, "OFFICE", "BodySB", 5.6, MUTED_D, tracking=1.5)
    k.text(ML, 44, ", ".join(C.ADDRESS), "BodyM", 8.0, INK)

    k.text(ML, 20, "© 2026 Great Lakes Technology. All product names and builds described "
                   "are the work of the studio.", "BodyR", 6.2, MUTED_D)

    k.image_frame(plate(k, "cover_full.jpg"), 170, 60, 107, 100, r=3.0)


# ===========================================================================
# Build
# ===========================================================================
def build():
    register_fonts()
    c = canvas.Canvas(OUT, pagesize=(W * PT, H * PT))
    c.setTitle("Great Lakes Technology — Portfolio 2026")
    c.setAuthor("Great Lakes Technology")
    c.setSubject("Investor portfolio brochure: eleven products built in Kampala, Uganda")
    c.setCreator("Great Lakes Technology")
    c.setKeywords("Great Lakes Technology, Kampala, Uganda, portfolio, investor, "
                  "ProxiCore, Rebuy, Tank Tickets, Trampo")

    k = Kit(c)
    global PAGE
    PAGE = 0
    c.setPageSize((W * PT, H * PT))
    c.scale(PT, PT)

    def bookmark(title, level=0):
        nm = f"pg{PAGE}"
        c.bookmarkPage(nm)
        c.addOutlineEntry(title, nm, level=level, closed=False)

    page_cover(k)
    bookmark("Cover")
    new_page(c)
    page_contents(k)
    bookmark("Contents")
    new_page(c)
    page_mission(k)
    bookmark("I — The studio")
    bookmark("Mission", 1)
    new_page(c)
    page_positioning(k)
    bookmark("Why we are different", 1)
    new_page(c)
    page_capabilities(k)
    bookmark("Capabilities", 1)
    new_page(c)
    page_method(k)
    bookmark("How we work", 1)
    new_page(c)
    page_platform(k)
    bookmark("The platform layer", 1)
    new_page(c)
    page_standards(k)
    bookmark("Standards & posture", 1)
    new_page(c)
    page_portfolio_divider(k)
    bookmark("II — The portfolio")
    new_page(c)

    for i, p in enumerate(C.PRODUCTS, start=1):
        page_product_story(k, p, i)
        bookmark(f"{i:02d} {p['name']}", 1)
        new_page(c)
        page_product_engineering(k, p, i)
        new_page(c)

    page_econ_intro(k)
    bookmark("III — The economics")
    bookmark("Revenue model", 1)
    new_page(c)
    page_econ_unit(k)
    bookmark("Unit economics & who pays", 1)
    new_page(c)
    page_econ_cost(k)
    bookmark("Cost base & assumptions", 1)
    new_page(c)

    page_ask_summary(k)
    bookmark("IV — The ask")
    bookmark("The raise", 1)
    new_page(c)
    page_ask_breakdown(k)
    bookmark("Allocation by product", 1)
    new_page(c)

    page_traction(k)
    bookmark("V — The business")
    bookmark("Where the portfolio stands", 1)
    new_page(c)
    page_roadmap(k)
    bookmark("Roadmap & commercial focus", 1)
    new_page(c)
    page_engagement(k)
    bookmark("Engagement", 1)
    new_page(c)
    page_back(k)
    bookmark("Contact")
    c.save()
    return OUT, PAGE


if __name__ == "__main__":
    out, pages = build()
    print(f"wrote {out} ({pages + 1} pages)")
