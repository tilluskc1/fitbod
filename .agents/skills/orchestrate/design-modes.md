# Design modes

Pick the mode in the Clarify step from what the user gave.

| Input | Mode |
|---|---|
| No UI or visual change (CLI, API, backend) | None: skip mockup and design check |
| Final design: artifact, Figma link, screenshot, HTML file | Match |
| Reference only, or nothing | Create |
| Unclear whether a reference is final or inspiration | Ask once in Clarify (counts toward the 3 questions) |

## Match mode

The given design is the acceptance criterion. Build to it. Do not invent a different look, layout or copy.

## Create mode

Before the plan stop, build a quick mockup in the reference's style:
- app screens, dashboards, settings, forms: `impeccable`
- public pages, landing pages, marketing: `design-taste-frontend`

Show its screenshot at the plan stop. Once approved, the mockup is the final design and the build runs in match mode.

## Design check

1. Start the project's preview (the dev server on a fresh listener, registered in the browser panel; or the artifact URL).
2. Screenshot the build and the design at the same width.
3. List every difference: layout, spacing, type, color, copy, states.
4. Send load-bearing differences to the implementer as fix-round defects. Report the rest.
5. Report plainly: matches, or what differs.

If the preview cannot start, report "design not visually checked". Never mark it passed.
