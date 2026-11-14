# #380 Logger redesign: phase 1 mocks

Static HTML/CSS only, not wired to the app. Tokens from `DESIGN.md`. Open `option-a.html?s=a` (states `a`–`d`) from a server at the repo root, or run `node docs/product/mocks/380/shoot.mjs <outDir>` to render all 16 PNGs (390×844 and 360×780) with a sideways-scroll and clipping check.

States: (a) first set of exercise 1, new lifter, no history; (b) sets 1–2 done, history, rest running; (c) superset pair, round 2; (d) keyboard open on set 3's weight (layout height kept, keyboard covers it, lesson 16).

## Every control the logger has on main (2aca432), and where it goes

| Control today | Option A | Option B |
| --- | --- | --- |
| Back (minimize), session name, Finish | top row | top row |
| Elapsed clock | top, beside the progress bar | top, above the progress ticks |
| Progress bar + "x of y sets" (was bottom) | top | top, one tick per set, grouped by exercise |
| Warm-up card: note, check, start/stop timer | one card, timer + check on the right; one line once done or skipped | same |
| Superset band (#88) | kept | kept, plus a round-by-round list (A1, B1, A2...) |
| Photo: tap = how-to player, hold = actions menu (#379) | kept | kept (the only How-to entry outside More) |
| Exercise name (opens actions sheet), meta: n of N · target · rest | kept | kept |
| ⋮ more actions | kept | replaced by the More chip (same sheet) |
| Chips: How-to, History, Replace, Later (#151, #369) | 4 equal chips in one row, fit at 360 | History, Replace, More (How-to and Later in More) |
| Coach line (suggested start / first time / go heavier / target note) | kept, "45 lb, the empty bar" | same |
| Last time note (#372) | kept, own line | kept |
| Set rows: weight + reps cells typed in place (#309), carry-forward (#306) | kept in every row; current row big, done rows one line, later rows quiet | current set in the card; later rows stay editable in the list |
| Previous column | only when there is history | "Previous 130 × 5" in the card, only with history |
| Weight label "lb total / lb each" | "lb", "lb each"; "bar" under 45 when it is the empty bar | same |
| Log ✓ per set | black ✓ on the current row; quiet ✓ on later rows | "Log set N" button in the card; later rows' circles |
| Ramp rows W (#300) | two rows until ticked, then one line | same |
| Row notes: needs-load reason, refusal, Big jump heads-up (#327) | under the current row, unchanged | under the card's fields |
| − / + weight steps (#371) | inside the current row | on the weight field |
| Up next | kept | kept |
| Skipped today + Return | kept, below Up next (not in these states) | same |
| Rest dock: time, +30s, Pause/Resume, Mute | kept at the bottom | same |
| All-logged review state | unchanged | unchanged |

## Cost

- **A:** build medium (markup and CSS in `TrainScreen.tsx`, two display rules: "bar" label, hide Previous without history); review large tier (core flow). E2e likely touched: `warm-up`, `second-workout`, `weight-steps-371`, `tap-targets`, `standalone-fit`.
- **B:** build large (log button leaves the row, focus-after-log moves, later rows become the editing path, Later moves into More). E2e likely touched: `inline-sets`, `carry-forward`, `big-jump`, `ramp-rows`, `supersets`, `weight-steps-371`, `warm-up`, `second-workout`, `tap-targets`, `later-369`, `howto-379`.

## Pick

Ship **A**: it fixes all six complaints in #380 and keeps every set editable where it is, at about half the e2e churn of B.
