# Portfolio brochure build

`Great-Lakes-Technology-Portfolio-2026.pdf` (repo root) is generated from this folder.

```bash
python3 -m venv .venv && .venv/bin/pip install reportlab pillow
.venv/bin/python prep_assets.py   # page plates + art crops into cache/ (git-ignored)
.venv/bin/python build.py         # writes ../Great-Lakes-Technology-Portfolio-2026.pdf
```

| File | Role |
| --- | --- |
| `content.py` | All copy and product facts — every claim traces to a repository README |
| `kit.py` | Print kit: palette, type ramp, rules, chips, cards, running furniture |
| `build.py` | Page compositions (A4 landscape, 297 × 210 mm) |
| `prep_assets.py` | Background plates, feathered art panels, per-product page plates |
| `art/` | Source key art (AI-generated, 2048 px) |
| `fonts/` | Space Grotesk + Inter (SIL Open Font License) |

## Outputs (repo root)

| File | Use |
| --- | --- |
| `Great-Lakes-Technology-Portfolio-2026.pdf` | Print master — 19 MB, 200 dpi plates |
| `Great-Lakes-Technology-Portfolio-2026-compressed.pdf` | Share/email version — 7.5 MB, 150 dpi plates |

Build the lighter share version:

```bash
BROCHURE_DPI=150 BROCHURE_Q=76 BROCHURE_CACHE=cache_web \
BROCHURE_OUT=../Great-Lakes-Technology-Portfolio-2026-compressed.pdf \
  .venv/bin/python prep_assets.py && \
BROCHURE_CACHE=cache_web \
BROCHURE_OUT=../Great-Lakes-Technology-Portfolio-2026-compressed.pdf \
  .venv/bin/python build.py
```

Both are 29 pages, A4 landscape, bookmarked, with embedded subset fonts.
