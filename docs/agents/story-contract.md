# Shared story contract (AS-* stories)

Revision AS-2026-11-06-r3. Every `AS-*` issue on Project 11 obeys this file in addition to its own body.

## Product contract
Owner decisions (2026-10-29): Supabase database, Vercel hosting/functions, Gemini Flash-Lite preferred (or an eligible free model during synthetic testing). These decisions supersede historical no-backend/no-accounts/no-cloud restrictions; retain offline logging and portable export. Program sessions continue in sequence after missed days, without catch-up volume. Finishing shortened work may advance that sequence, but never satisfies an unmet original exercise progression target. Preserve the approved Today v7 light mint design (owner-approved 2026-11-06, #142): https://claude.ai/artifact/22N6X72VCQw3tAEua8sUJ1 version 1794005807-b89c. It replaces the earlier charcoal/lime design. Owner-approved departures from the reference shot: square set-blocks instead of cups, navy text on the blue card, no search or Upgrade on Today, coach / session / lead-lift cards, and a floating white nav pill with a lime Start in the centre.

## Implementation guardrails
Reuse existing session, validation, persistence and training modules. No generator/storage rewrite by default, no UI redesign beyond the approved Today v7 stories (UI7-*), no catalog expansion. Preserve logged actuals and canonical kilograms; distinguish each/total loads and reps/seconds. Never transfer loads between exercise variants, invent weights or exercise IDs, or diagnose pain. New variants need calibration. Relevant regression tests plus existing test/build/lint checks are required; document unavailable checks. Validate touched flows at 390×844 and 360×780.

## Verification and readiness
Reviewed baseline: main at 8ca1b5d2fc5519e60838e7cd137852f933a18f44 on 2026-10-29. All 58 existing Node tests passed in an isolated source copy. Build, lint, browser, physical-device, deployed-build correspondence and live provider checks were not run in this readiness pass. Re-run checks on the implementation branch; this is a specification, not a claim the feature works.
**Readiness means:** the specification can be picked up after its blockers, not that the feature has shipped. Check the current branch and reproduce the relevant path before changing code. Do not import changes from an unrelated public prototype.
