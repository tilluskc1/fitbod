# DESIGN.md: Light Mint system

A phone-first design system for focused, single-purpose apps: one screen tells you what to do next, and every number on it is real. Built for Home Strength (this repo) and written to be lifted into another project as-is.

Source of truth in this repo: the `:root` block in `src/index.css`. Approved reference: the Today v7 mockup (https://claude.ai/artifact/22N6X72VCQw3tAEua8sUJ1). Measured values below come from the shipped CSS, not from the mockup.

---

## 1. Principles

1. **One next action per screen.** Each screen has one black primary button. Everything else is a pill, a row or a link.
2. **Calm surface, loud signal.** The page is pale mint and the cards are white. Lime appears only where something is live or ready: the Start button, today's state chip, logged-set ticks. If lime is everywhere it stops meaning anything.
3. **Large thin numbers.** Key figures are big and light (weight 200 to 300). The number carries the screen; the label under it is small and muted.
4. **Honest content beats decoration.** Never show a number the app did not compute or the user did not log. If something is not possible, say so in the state chip and offer the fix, rather than hiding the gap.
5. **Photo for mood, never for data.** One photo hero per screen at most, always under a dark gradient so white text passes contrast.

---

## 2. Colour

### Core tokens

| Token | Hex | Use |
|---|---|---|
| `--surface` | `#e6f2f1` | Page background (mint) |
| `--card` | `#ffffff` | Cards, sheets' rows, nav pill |
| `--surface-container-low` | `#f6fbfa` | Sheet background |
| `--surface-container-high` | `#eef7f6` | Icon wells, secondary buttons, tinted cards |
| `--surface-container-highest` | `#dde8e6` | Hairlines, dividers |
| `--on-surface` | `#141a1a` | Body text |
| `--on-surface-muted` | `#3d4847` | Secondary text |
| `--on-surface-variant` (`--muted`) | `#56615f` | Labels, captions, inactive tabs |
| `--outline` | `#8a9896` | Decorative strokes only, never text |
| `--primary` (lime) | `#d6f05c` | Live and ready fills: Start button, Ready chip |
| `--on-primary` | `#1c2406` | Text and icons on lime |
| `--accent-text` | `#4f5d0c` | Accent text on white or mint (lime itself is unreadable there) |
| `--accent-edge` | `#a3b83a` | Decorative lime borders |
| `--btn` | `#121515` | Primary buttons, dark chips |
| `--on-btn` | `#ffffff` | Text on `--btn` |
| `--sky` | `#a3d1e5` | The one blue card (week / streak) |
| `--on-sky` | `#0f2f3c` | Text on sky (navy, not white) |
| `--amber` | `#8a5300` | Warning text |
| `--danger` | `#a03224` | Destructive text and links |

### State colours (a chip on the hero)

| State | Fill | Text | Meaning |
|---|---|---|---|
| Ready | `#d6f05c` | `#1c2406` | Everything the plan needs is available |
| Limited | `#f2c14e` | `#2b1d00` | Runs, but some of the plan is missing |
| Not enough | `#ff9a8c` | `#3a0b05` | Cannot run as planned; offer the fix |

### Measured contrast (WCAG)

| Pair | Ratio | Verdict |
|---|---|---|
| Text on mint | 15.4 : 1 | AAA |
| Muted on white / on mint | 6.4 / 5.6 : 1 | AA |
| Accent text on white | 7.2 : 1 | AAA |
| Text on lime | 12.6 : 1 | AAA |
| White on black button | 18.4 : 1 | AAA |
| Navy on sky | 8.6 : 1 | AAA |
| Limited chip / Not-enough chip | 9.8 / 8.3 : 1 | AAA |
| Danger / amber on white | 7.1 / 6.3 : 1 | AA |
| **Lime as a line on white** | **1.3 : 1** | **Fails. Never use lime for text, icons on white, borders that matter, or focus rings** |
| `--accent-edge` on white | 2.2 : 1 | Decoration only |

Rule: lime is a **fill** with dark text on it. It is never a foreground colour on a light background.

---

## 3. Typography

- **Family:** Outfit variable (200 to 700), self-hosted woff2 with `font-display: swap`. Fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`.
- **Base:** 16px, line-height 1.45, antialiased.
- **Headings:** weight 500, line-height 1.12, letter-spacing -0.035em.

| Role | Size | Weight | Tracking | Notes |
|---|---|---|---|---|
| Hero title | 28px | 400 | -0.02em | max 12ch, `text-wrap: balance`, white on photo |
| Greeting name | 28px | 700 | -0.035em | "Alex." with the full stop; "Good morning," above in 15px |
| Card title | 18px | 500 | -0.01em | |
| Big numeral (card) | 38px | 200 | -0.03em | line-height 1, unit in 14px/300 muted |
| Hero numeral (chart card) | 52px | 300 | -0.04em | line-height 0.9 |
| Stat value | 18px | 400 | 0 | label 12px muted under it |
| Body | 15 to 16px | 400 | 0 | |
| Pill / button label | 15 to 16px | 500 to 700 | 0 | primary 700, pills 500 |
| Eyebrow / caption | 12 to 13px | 400 to 500 | 0 | muted |
| Table header | 11px | 500 | uppercase | the only place 11px is allowed |

Use tabular numerals (`font-variant-numeric: tabular-nums`) anywhere numbers update live: timers, set tables, counters.

---

## 4. Shape, space and elevation

- **Radius:** cards and hero 26px (`--radius-card`); sheets 26px top corners; pills and buttons 999px; icon wells 50%; small blocks 5px (16px squares) and 12px (40px squares).
- **Screen padding:** 17px sides, 10px top, 26px bottom. Keep at least 16px at 360 wide.
- **Card padding:** 18px. Hero padding: 20px. Gap between cards: 12px.
- **Touch targets:** 44px minimum height for every pill, row and icon button. Primary buttons 52px.
- **Elevation:** almost none. Cards are flat white on mint; separation comes from colour, not shadow. Two exceptions:
  - Nav pill: `0 10px 30px -12px rgba(20, 40, 40, 0.35)`.
  - Centre action: a 6px ring in the page colour (`box-shadow: 0 0 0 6px var(--surface)`) so it reads as cut out of the nav.
- **Sheet backdrop:** `rgba(20, 26, 26, 0.4)`.

---

## 5. Layout

- **Phone first.** Design at 390×844 and verify at 360×780. Nothing may scroll sideways at 360. On desktop the app sits in a centred 390px phone frame with a soft shadow (`0 30px 80px -30px rgba(30, 60, 58, 0.35)`).
- **Today screen order (top to bottom):** greeting and avatar → controls row (pills) → photo hero with state chip → main content card → coach card → blue week card → stats card → chart card. The sticky bottom area holds the one primary CTA above the nav.
- **Floating nav:** a white pill 72px tall, radius 36px, 16px from the screen edges, 14px above the safe area. Grid `1fr 1fr 92px 1fr 1fr`: two tabs, the centre action, two tabs. Tabs are icon over 12px label; the active tab is ink at weight 600, the others are muted.
- **Centre action:** a 72px lime circle raised 24px above the pill, with a play icon. During a session it becomes Resume and shows a progress ring of logged sets.

---

## 6. Components

**Primary button.** Black pill, full width, 52px, white 16px/700 label, optional trailing arrow icon. One per screen.

**Secondary button.** Pill, 52px, `#eef7f6` fill, 1px `#dde8e6` border, ink 15px/500.

**Text link / destructive link.** No fill. Destructive uses `--danger`, centred, below the buttons.

**Control pill (filter / menu).** White pill, 44px, 0 14px padding, 15px/500 label, leading 16px icon in muted, trailing chevron when it opens a menu. A row of them stays on one line: below 400px wide drop the leading icons and keep the chevrons; let the longest label truncate last. Disabled pills drop to 55% opacity.

**Card.** White, 26px radius, 18px padding, no shadow. Header row: a 38px round icon well (`#eef7f6`) + 18px title on the left; a light 18px number or a 14px muted note on the right.

**Photo hero.** 220px min height, 26px radius. Photo `object-fit: cover`, subject placed right (`object-position: 72% center`). Overlay: a left-to-right dark gradient (0.8 → 0.5 → 0.06) plus a bottom-up one (0.6 → 0) in `rgb(24, 40, 41)`. Content in white: eyebrow 13px, title 28px/400, meta 14px, then the state chip.

**State chip.** Pill 34px tall, 14px/600, leading icon, coloured by state (section 2).

**Dark chip.** `--btn` fill, white 12px/500, 5px 12px padding. For tags such as "Adjusted for today".

**Blue card.** The single `--sky` card per screen, navy text, a 7-column grid of 16px squares (radius 5px): empty `#e4f2f8`, filled `#2f6f88`. A segmented toggle (Today / Week) sits bottom-right in 44px translucent white pills.

**Progress ticks.** A row of equal bars 36px tall, 3px gap, radius 3px: empty `#e6eeec`, done `#c5dd3c`. One bar per planned unit.

**Bottom sheet.** `#f6fbfa`, 26px top radius, 1px top border, 10px 22px padding plus safe area, max 88% height, a 46px drag handle. A title + optional subtitle on the left and a round close button on the right. Focus starts on close, Tab and Shift+Tab wrap inside, everything behind is inert, Escape closes, and focus returns to the control that opened it.

**Option row (inside sheets).** Grid `44px 1fr 22px`, 60px min height, divider between rows. Left: a 44px badge (value or icon). Middle: label + one-line consequence ("≈32 min · 14 sets"). Right: check for the current choice. Rows that cannot work stay visible, greyed, with the reason.

**Set table (logger).** Columns: Set / Previous / Load / Reps / Log. Header 11px uppercase muted. Log is a 44px round check button; when done it fills lime and the row tints lime at 20%. Inputs are tappable cells, never tiny steppers.

**Quick-action pills.** Under an item header: How-to, History, Replace as 44px white pills with a 16px muted icon, 14px/500 label.

**Empty state.** Dashed 1px border card, centred muted text that says what is missing and the one action that fixes it.

---

## 7. Icons

Material Symbols Outlined, subset to the ligatures you use (keeps the font small). 16px in pills, 18 to 20px in rows, 22px in the nav. Icons are always muted grey or ink, never lime on light backgrounds. Every icon-only button carries an `aria-label`.

---

## 8. Motion

- Sheets rise over 220ms (`cubic-bezier(0.22, 0.61, 0.36, 1)`); the backdrop fades over 160ms.
- The centre action scales on press (`transform 0.15s ease`).
- Progress bars animate width over 400ms.
- `prefers-reduced-motion: reduce` turns off sheet and backdrop animation and the press transition.
- No looping animation, no parallax, no confetti.

---

## 9. Accessibility checklist

- Text contrast at least 4.5:1, large numerals at least 3:1 (all core pairs above pass).
- **Focus ring:** 2px solid `--btn` (`#121515`) with a 3px offset, plus a 2px white inner ring on dark or lime fills. Do not use lime: it measures 1.3:1 on white.
- 44px minimum targets; 8px minimum between adjacent targets.
- Modal sheets trap focus, make the page behind `inert`, close on Escape and return focus to the opener.
- Live numbers (timers, set counts) are announced politely, not on every tick.
- Every chart has a text equivalent ("5 of 21 sets logged"), and a chart with no data says so instead of drawing a fake line.

---

## 10. Voice

- Short, plain, factual. "Push · 45 min · 14 sets", not "Let's crush it!".
- Every limit gets a reason and a fix: "Limited · no calf work. Add Machine".
- Never claim what was not measured: no estimated calories, no invented personal records, no "saved" before the save is confirmed.
- Numbers keep their units next to them: "25 lb each", "≈32 min", "90 s".

---

## 11. Don'ts

- No dark mode in this system (it was tried and rejected; the light mint is the identity).
- No gradients on buttons, no glows, no drop shadows on cards.
- No lime text, lime icons or lime outlines on white or mint.
- No second primary button on a screen.
- No search bar or upsell banner on the home screen.
- No layout that needs a sideways scroll at 360 wide.
- No raw hex values in components: read the tokens.

---

## 12. Drop-in token block

```css
@font-face {
  font-family: 'Outfit';
  font-style: normal;
  font-weight: 200 700;
  font-display: swap;
  src: url('/fonts/outfit-latin-var.woff2') format('woff2');
}

:root {
  color-scheme: light;
  /* Surfaces */
  --surface: #e6f2f1;
  --card: #ffffff;
  --surface-container-low: #f6fbfa;
  --surface-container-high: #eef7f6;
  --surface-container-highest: #dde8e6;
  /* Text */
  --on-surface: #141a1a;
  --on-surface-muted: #3d4847;
  --muted: #56615f;
  --outline: #8a9896;
  /* Accent */
  --primary: #d6f05c;
  --on-primary: #1c2406;
  --accent-text: #4f5d0c;
  --accent-edge: #a3b83a;
  /* Actions */
  --btn: #121515;
  --on-btn: #ffffff;
  /* Feature card */
  --sky: #a3d1e5;
  --on-sky: #0f2f3c;
  /* Status */
  --state-ready: #d6f05c;      --on-state-ready: #1c2406;
  --state-limited: #f2c14e;    --on-state-limited: #2b1d00;
  --state-none: #ff9a8c;       --on-state-none: #3a0b05;
  --amber: #8a5300;
  --danger: #a03224;
  /* Shape */
  --radius-card: 26px;
  --radius-pill: 999px;
  --tap: 44px;
  --tap-primary: 52px;
  /* Elevation */
  --shadow-nav: 0 10px 30px -12px rgba(20, 40, 40, 0.35);
  --scrim: rgba(20, 26, 26, 0.4);
}

body {
  margin: 0;
  background: var(--surface);
  color: var(--on-surface);
  font: 400 16px/1.45 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 { font-weight: 500; line-height: 1.12; letter-spacing: -0.035em; margin: 0; }

:focus-visible { outline: 2px solid var(--btn); outline-offset: 3px; }

.btn-primary {
  min-height: var(--tap-primary); width: 100%;
  border: 0; border-radius: var(--radius-pill);
  background: var(--btn); color: var(--on-btn);
  font-weight: 700; font-size: 16px;
}

.pill {
  min-height: var(--tap); padding: 0 14px;
  border: 0; border-radius: var(--radius-pill);
  background: var(--card); color: var(--on-surface);
  font-weight: 500; font-size: 15px; white-space: nowrap;
}

.card { background: var(--card); border-radius: var(--radius-card); padding: 18px; }
```

---

## 13. Before you ship a screen

1. One primary button, black.
2. Lime only as a fill with dark text.
3. Checked at 390×844 and 360×780: no sideways scroll, nothing wraps or clips that should not.
4. Every target 44px or more; focus visible with the dark ring.
5. Every number traceable to data or user input; every limit has a reason and a fix.
