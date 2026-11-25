# Design System — Buddy Elder AI

## Aesthetic Direction
- **Senior Application**: Warm, calm, high-legibility touch-first design (`10_mobile_touch_apps.md`). Soft warm ivory canvas (`#FAF8F5` light / `#0F172A` dark) paired with deep forest teal (`#0F5156`) primary actions and warm terracotta (`#C2592B`) accents. No generic purple gradients, no decorative pulsing dots, no pill clutter.
- **Caregiver & Admin Portal**: Clean, trustworthy editorial dashboard (`3_saas_dashboard.md`) with sidebar navigation on desktop, single-elevation flat cards with subtle `1px` borders, tabular numerals (`tabular-nums`), and semantic status indicators pairing icon + label + color (`#16A34A` Green, `#D97706` Amber, `#DC2626` Crimson).

## Typography
- **Display / Headings**: `Plus Jakarta Sans` (weights 600, 700)
- **Body / Reading**: `DM Sans` (or `Plus Jakarta Sans` 400/500) with generous line-height (`1.6`)
- **Numeric / Data**: `JetBrains Mono` / `tabular-nums`

## Accessibility & Ergonomics
- Minimum touch target: `48px x 48px` for all senior buttons; `44px x 44px` minimum across caregiver controls.
- Dynamic root text scale classes on `<html>`:
  - `text-scale-sm` (`15px`), `text-scale-normal` (`18px`), `text-scale-lg` (`21px`), `text-scale-xl` (`24px`).
- High-contrast mode (`data-contrast="high"`): sharpens borders, deepens ink (`#000000` / `#FFFFFF`), removes subtle tints.
- Light/Dark mode (`@custom-variant dark (&:where(.dark, .dark *));` in `src/index.css`).
- Visible keyboard focus rings (`focus-visible:outline-3 focus-visible:outline-teal-700`).
- Reduced motion mode (`data-reduced-motion="true"` + `@media (prefers-reduced-motion: reduce)`).
- Never convey state by color alone (always combine icon + explicit text label such as `GREEN — No obvious risk found`, `YELLOW — Be Careful`, `RED — Likely Scam`).
