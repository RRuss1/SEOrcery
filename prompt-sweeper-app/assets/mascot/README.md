# Slop Hog Mascot Assets

The menu-bar mascot needs 4 states. Each is an 18x18 PNG for the tray icon.

## Required files

| File | State | Description |
|------|-------|-------------|
| `idle.png` | Sleeping | Pig with closed eyes, small Z above. Default state. |
| `alert.png` | Ears perked | Eyes open, ears up. Slop detected in clipboard. |
| `eating.png` | Chomping | Mouth open, eating motion. During auto-fix. |
| `full.png` | Belly full | Visible stomach bulge, content face. Post-scan. |

## Mac template variants (recommended)

For macOS menu-bar auto theme-adaptation (black on light mode, white on dark mode), also provide:

- `idleTemplate.png`
- `alertTemplate.png`
- `eatingTemplate.png`
- `fullTemplate.png`

Template images must be **black + alpha only** (no color). macOS auto-inverts for dark mode.

## Style notes

- Base color: pink `#FFB3C7` (skin), navy `#0B1F3A` (outlines)
- Accent: subtle cyan circuit lines `#00C4D9` to tie to Russell SPC brand
- Friendly, slightly cartoony, not too detailed (it's 18x18)
- High contrast so it reads clearly at small size

## Provisional fallback

If these files are missing, the tray will show a blank icon (no crash). Ship these before first release.
