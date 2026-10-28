# OpenCode implementation handoff

Source snapshot: `91e80f01e2c14806e906fe7a506e22be62fd7a15`. This is the restored, approved mobile version, not the abandoned desktop dashboard.

## What to open

- `reference/approved-design.png`: Krishna's approved visual direction.
- `reference/current-prototype.jpg`: the actual implemented mobile screen.
- `dist/index.html`: mobile frame, app root and bottom navigation.
- `dist/style.css`: shared base styles and form primitives.
- `dist/experience.css`: final mobile design rules, including the final overrides at the bottom.
- `dist/app.js`: prototype data, logging, plan resolution, storage validation, actions and sheets.
- `dist/experience.js`: final mobile views and render/navigation overrides; loaded after app.js.
- `checks.mjs`: 74 prototype regression checks. These run a Node VM harness, not a real React browser app.
- `OPENCODE_PROMPT.txt`: exact first-milestone implementation prompt.

## Run the reference

From this `mobile-reference` directory:

```sh
python3 -m http.server 8000 --directory dist
```

Open http://localhost:8000. No install or build is required for this reference. The real application should keep its own framework and run commands.

For reference checks:

```sh
node --check dist/app.js
node --check dist/experience.js
node checks.mjs
```

## Scope and status

The prototype is static HTML/CSS/plain JavaScript, with ten exercise entries and browser-local storage under `strength-coach-prototype-v1`. Coach chat uses guided responses. Working weights/targets are illustrative or reused from records; a production progression engine is not implemented. There is no connected live model, cloud sync, account backend, telemetry, or physical-phone certification.

The original fitness repository described in the conversation is a different application, reportedly React/Vite with 51 exercises. Inspect it before assuming file paths, dependencies, counts or persistence details. This package is a visual and interaction reference, not a replacement for that application's catalog or infrastructure.

The prototype uses global functions and a later view override layer for iteration. Port behavior into the real application's component/state architecture; do not blindly transplant that structure. Preserve corrections and safety checks when separating the modules.

## Fixed design direction

Charcoal background (`#0d120c`), lime accent (`#c5f777`), personal greeting, wide workout photograph, quiet inline coach, outlined adjustment action, first-exercise comparison, compact exercise rows, prominent Start button, four bottom tabs. Phones use the viewport; desktop shows a phone preview. Keep the final mobile overrides in mind when reading CSS.

The UI must remain live and interactive. Counts, names, exercises, working loads and recorded performance come from real state. The approved screenshot's example values are not hardcoded product requirements.

## Assets

The bundled `concept.png` is the generated design reference used for CSS photography crops. The final UI text and controls are real DOM elements. It is not a full-screen image pretending to be an application. Inter font files are bundled; Apple platforms prefer the system font stack. No Fitbod branding or scraped Fitbod/Dribbble media is bundled. Audit media licensing and production suitability before release.

## Verified reference behavior

74 checks passed for this snapshot. Browser QA includes phone-width layouts, navigation, time/equipment adjustment, matching session start, typed seven-rep logging, refresh/resume of those exact seven reps, early finish, and history navigation. Earlier regression checks cover canonical set corrections, units, malformed restores, failed writes, stale tabs and progression-sequence continuity. Revalidate these in the actual application.

## Later milestones, after this integration passes

1. Deterministic progression, separate from exercise selection; equipment-specific increments; user calibration for unseen exercises; explicit rules for incomplete sessions and confirmed preferences.
2. Live AI: server-side intent parsing with a strict validated constraint schema. A deterministic engine builds the proposal; the user confirms it. Keep temporary circumstances separate from confirmed memory and immutable recorded sets. The model must not invent exercise IDs, working weights or medical advice. Use a server-held secret and test failure/timeout/fallback behavior. Do not select a model or API version based on an old report without checking current official documentation.
3. Evaluate actual outcomes and retention before adding wearables, form analysis or more catalog surface area.

Hosting IDs, Git credentials, deployment configuration, historical backups and personal workout data have intentionally been excluded from this package. There is no authorization to overwrite the existing hosted Site from another project.
