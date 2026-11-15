# DeepCode Studio — brand identity

Status: as built, 2026-11-15 (owner request: light web portal + a real mark).

## 1. Idea

**The split D.** A geometric `D` whose vertical stem is the cyan split line from
the product's signature move: an Arabic (RTL) interface and LTR code living in
one workspace. The bowl is paper; the stem is the accent. Two colours, one
shape — it reads at 16 px and in monochrome.

The mark says "code editor" without drawing a literal terminal, bracket or
gradient. The wordmark stays plain text so it inherits the product's typography.

## 2. Colours

| Role | Value | Use |
|---|---|---|
| Ink | `#111827` | mark tile, primary text |
| Paper | `#F8FAFC` | the D bowl in the mark |
| Page | `#F7F8FA` | web page background |
| Card | `#FFFFFF` | elevated surfaces |
| Action cyan | `#0E7490` | links, primary buttons, focus ring (WCAG AA on white) |
| Mark cyan | `#22D3EE` | the stem inside the mark only |
| Indigo | `#4F46E5` | secondary chart series / hero accent only |

The mark colours are fixed (not theme tokens) so the logo is identical on any
surface. UI colours are semantic tokens in `apps/web/src/app/globals.css`; the
web portal is light-only (owner decision 2026-11-15).

## 3. Files

| File | Purpose |
|---|---|
| `apps/web/src/components/brand.tsx` | `BrandMark` + `BrandWordmark` used by the portal |
| `apps/web/src/app/icon.svg` | favicon (Next.js metadata convention) |
| `apps/web/src/app/apple-icon.png` | 180×180 Apple touch icon |
| `apps/web/public/brand/deepcode-mark.svg` | standalone mark for docs/external use |
| `apps/web/public/brand/icon-192.png`, `icon-512.png` | raster app icons |

## 4. Usage

- **Clear space:** at least 25% of the mark's height on every side.
- **Minimum size:** 16 px for the mark; below that use the favicon file as-is.
- **Lockup:** mark + "DeepCode Studio". `DeepCode` is 600 weight; `Studio` is the
  quiet 400-weight qualifier in `--color-fg-muted`. Keep the pair on one line.
- **Do not:** add gradients, shadows, outlines or extra glyphs to the mark;
  rotate it; change the tile radius; place the mark on a busy photo; or recolor
  the stem. If a monochrome version is needed, use the tile silhouette only.
- **Arabic:** the wordmark is Latin in both locales (brand name); surrounding
  copy follows the locale's font and direction.

## 5. Accessibility

- The mark is decorative (`aria-hidden`) because every use is adjacent to a
  visible wordmark or link label.
- Ink-on-paper is 16.7:1; action cyan on white is 5.36:1; the mark cyan is only
  used as a non-text accent inside the tile.
