# Your Strength Coach

A private mobile training prototype restored to the user-approved charcoal-and-lime visual reference. Desktop displays a phone preview; phones use the full viewport. It is a browser-local demo, not a production training engine or connected AI service.

## Pages and flows

- Today: workout preview, sample previous/target comparison, exercise details, settings.
- Plan: week, session previews, training preferences, equipment coverage.
- Progress: labeled sample history plus sessions logged in the prototype, record corrections, export.
- Coach: weekly review, preview/approve a shorter-week trial, editable memories, guided demo chat.
- Adapt: time/equipment controls, an honest coverage preview, today-only changes, preserved performed sets.
- Train: editable loads/reps, per-set logging, timestamp rest timer, pause/resume, replacements, early finish and recap.

State is stored in localStorage under a versioned key. The small prototype data volume is deliberate. It is not a backup; settings include JSON export/restore. No credentials, external AI service, telemetry, or account infrastructure are present.

## Run and check

Serve `dist/` using any static server. The Sites development environment uses `sites-preview start` from this checkout. Run `node --check dist/app.js` and `node checks.mjs`.

## Assets

`assets/concept.png` is the image generated in this conversation; UI photography is presented using CSS background crops. Inter font files were downloaded from Google Fonts. The application does not use the Dribbble reference images as shipped assets.

## Mobile design reference

The user's original reference is the visual baseline: large personal greeting, full-width workout photography, inline coach message, outlined Adjust today control, first-exercise comparison, compact exercise rows, lime Start button, and four bottom tabs. The previous desktop dashboard layout has been removed.

`experience.js` and `experience.css` provide the mobile views on the validated engine in `app.js`. The original reference photography is reused through CSS crops; the user-approved image is not flattened into the live app. Text, records and controls remain real HTML. A separate light-photo experiment is not used in this implementation.

## Verification

74 regression checks cover equipment feasibility, shared plan resolution, session sequence, set edits and corrections, restore validation, canonical units, scheduled trials, failed saves, cross-tab conflicts, and synchronous native form cancellation. Browser QA verifies the restored phone preview plus 390px and 360px iframe viewports. The restored-view journey covers time/equipment preview, bodyweight session start, a typed 7-rep set surviving reload, partial finish, history navigation, all four main tabs, and sample chart controls. The previous engine audit also covers per-set corrections, feedback-driven reviews and actual chart values. Narrow layouts were checked for horizontal overflow. These are responsive Chromium checks, not physical-device certification.

Not verified on physical phones. This prototype does not provide AI-derived exercise prescriptions, background/lock-screen alarms, medical assessment, cloud sync, or production offline guarantees. History corrections update recorded sets and the next illustrative target for the same exercise. A production progression engine remains unimplemented. See audit/REPORT.md for the repaired failure paths.
