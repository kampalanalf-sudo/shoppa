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

Output: 29 pages, A4 landscape, PDF bookmarks, embedded subset fonts, 200 dpi plates.
