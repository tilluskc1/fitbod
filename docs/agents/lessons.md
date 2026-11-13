# Lessons

Read this before planning any task. When a review fails, a merge goes wrong, or the owner corrects
something, add one entry here in the same PR as the fix. Keep each entry to: what happened, the rule,
and how to check it. If a rule can be a script or a test, make it one and say where.

## Planning and briefs

1. **Decide the data model before the heuristic.** #188 took five review rounds because progression
   tried to infer "was this session capped?" from planned loads; every inference leaked. Storing the
   setup on each exercise fixed it in one round.
   Rule: if correctness depends on facts the stored data doesn't hold, raise the stored-data question
   at the plan stop, before building. Check: the brief names every fact the logic needs and where it lives.

2. **Write the edge cases into the brief, not into review.** Most fix rounds found cases the brief
   never named (mid-session switch, midnight rollover, legacy records, empty days, keyboard open).
   Rule: every brief lists the edge cases of its area from this file's "Recurring edge cases" below.

3. **Time-box heuristic text parsing.** The "Tell me about today" parser took seven rounds chasing
   phrasings. The chips were always the safety net.
   Rule: one round of parser fixes per review; after that, err toward the safe reading (skip a
   possibly sore area) and stop. Check: the PR says the text reading is best effort.

4. **Don't fix what only moves a metric.** The Deadlift retag (#191) improved an audit's scoring and
   broke real days in two rounds.
   Rule: before changing catalog data or selection, ask "does a lifter see a better workout?" If not, park it.

## My own mistakes (orchestrator)

5. **Never override an owner decision inside a fix round.** I told a builder to keep a second core
   move "when nothing else fits", which broke the approved core cap and cost a round.
   Rule: a fix round may not change an owner-approved rule; ask instead.

6. **Never commit while a check is red.** I chained `commit` after a failing `npm test`.
   Repeated on #271 (2026-11-08): `npm test ...; git commit` in one command pushed f704f2a with one
   stale test red.
   Rule: commit only in a separate step after reading the counts; never put `git commit` in the same
   command as a check. Check: `scripts`/merge helpers stop on
   `# fail` > 0 (see `.scratch/orchestrate/audit-fixes/m.sh` pattern: commit is the merge itself; re-run tests before `git push`).

7. **Push only the ref you mean.** Fast-forwarding stacked PR bases, I moved a PR's own head branch.
   Rule: to mark a stacked PR merged, fast-forward only its **base** branch to its head commit; print
   `git ls-remote` for both refs before and after.

8. **Merge stacked work early.** Long-lived branches diverged: #202 met 22 conflicts against later work.
   Rule: once a PR passes review, ask to merge before stacking more on its neighbours; keep stacks ≤ 2.

9. **When two paths must give the same answer, make them one path.** #229 first aligned the generator's
   cut with today-only trimming (rank, keep flags); the review showed a saved 45 shortened to 30 still gave 3
   exercises, because a trim can only remove what the longer day already has. Building the short day
   through the generator made them equal by construction and deleted the plumbing.
   Rule: prefer one function over two kept in sync; test the claim from every starting point (saved
   45/60/90), not the one that happens to work. Check: `tests/shortSessions229.test.ts`.

10. **Check what already ships before scoping.** #231 was filed as "loop the two frames instead of
   videos", but `Demo.tsx` had looped them as a hard cut since #5, on every list row too. The real work
   was the crossfade, timing and an off-screen pause, not a new feature.
   Rule: before planning, grep `src/` for the feature's nouns and say in the brief what exists. Check:
   the plan stop names the existing component or says none was found.

11. **Write the story, don't ask whether to.** The owner asked for "plan my workout" and I answered with
   two options and "pick one and I'll write the story"; the owner had to ask twice (#236).
   Rule: an owner idea with no open issue becomes a story in the same turn, with the recommended default
   picked and named so the owner can override (AGENTS.md, Autonomy envelope). Check: the reply to an
   owner idea links an issue number.

12. **An e2e must compare values across screens, not count its own clicks.** The #245 e2e passed while
   only matching `\d+ × \d+` and asserting a tap counter the script itself incremented; review 1 failed it.
   Rule: assert the number one surface shows equals the number the next one uses (Today's last load =
   logger's previous; target load = set 1's prefilled weight). Check: `scripts/e2e/second-workout.mjs`.

13. **Test offline as a first-time visitor, through the real worker.** #251: the app went blank offline
   after one visit because JS and CSS were cached only on a second visit; once precached, the scripts
   still missed because hosts answer `Vary: Origin` and module scripts send an Origin header.
   Rule: any service-worker change runs the offline e2e in a fresh browser context (one online visit,
   then offline reload); cache lookups use `ignoreVary`. Check: `scripts/e2e/offline-first-visit.mjs`,
   `tests/offlineShell251.test.ts`.
   Review also caught two PNGs the e2e had written into the repo root and a cache name that wiped viewed
   photos on every deploy. Rule: e2e scripts write screenshots only when `E2E_SHOTS` is set; runtime
   media lives in its own cache that deploys keep. Check: `git status` is clean after `npm run e2e`.

14. **Anchor a nudge on the event that breaks the plan.** #134's "a fresher day is up" offer counted
   recently trained muscles; two review rounds found it flagging the split's own planned order (a
   hinge marks the back; Pull then Legs repeats two areas before Upper).
   Rule: trigger only on the event that breaks the plan (a skip, a described day), then apply the
   heuristic. Check: the planned-order sweep in `tests/recovery134.test.ts` (splits 2-6, 1-3 days done).

15. **Merge only what a review passed.** #236 was merged at WIP 20cc161 without review ("owner: merge
   without review"); a review then found a pain bug, and the fix that passed review (d020980) came after
   the merge, so production carried the bug.
   Rule: merge only a SHA a separate review passed, and name it in the merge commit. Check: before
   pushing main, `git merge-base --is-ancestor <reviewed SHA> <merge commit>` exits 0.

16. **A shrunk viewport is not a phone keyboard.** #256's first e2e "opened the keyboard" with
   `setViewportSize(h - 330)`, which shrinks the layout; iPhone (and Android without
   `interactive-widget=resizes-content`) keeps the layout and covers it, so the pinned bar sat under
   the keyboard and review failed it. Rule: keyboard checks keep the layout height and shrink only the
   visual viewport, and assert the action sits inside the visible band. Check:
   `scripts/e2e/planner-reach.mjs` (fake `visualViewport`), `src/lib/keyboardInset.ts`.
   Round 2: the lifted bar then covered the field the phone had already revealed. The app re-reveals the
   focused field after setting `--kb`; the e2e no longer scrolls for the app and also shifts `offsetTop`.

17. **Carry what the generator added; don't infer it.** #96 failed review three times, each over how the
   "third" exercise was identified (unmarked, then by its position after core).
   Rule: when a later step must undo something the generator added, carry that fact on the in-memory
   object that already flows to it (`Program.thirds`), never infer it from shape or position (lesson 1).
   Check: `tests/muscleCap96.test.ts`, a trim drops exactly `program.thirds`.

18. **"Can I close it?" is a question, not an order.** The owner asked whether they could close their
   chats; I archived the "Photo frame loop" dev chat myself and the owner lost it mid-work (unarchived
   the same turn). Rule: never archive, close or delete a chat, PR, branch or issue unless the owner
   says to do it now; answer the question, say what is safe, and let the owner act. Check: the turn's
   tool calls contain no archive/close/delete the owner did not ask for in that message.
   Exception (owner, 2026-11-09): a dev chat archives itself after it has started the next dev session
   and everything is pushed (AGENTS.md, "Sessions and models"). Nothing else changes.

19. **A dismissal answers one thing, not a flag.** #236 kept "It's only soreness" as a boolean, and
   "Nothing" set it too, so pain typed afterwards built a day. Rule: a safety override stores what it
   answered (the text it saw) and lapses when that changes; only the explicit answer may set it.
   Check: `tests/planToday236.test.ts` (pain stop test).
20. **Two reviewed PRs can each pass and still break each other.** #276's e2e asserted the old
   "skipped for today" message after a logged set; #105, reviewed earlier, made that message say the
   logged set is kept. Each passed alone; the merged result failed e2e. Rule: before each merge, run the
   full suite on the merged result, not only on the branch, and when it fails fix it on the branch and
   re-review at the new SHA. Check: `npm run e2e` on the local `merge/*` branch before pushing `main`.

21. **Apply the product default; the owner overrides, not the dev.** #259's story said toasts last
   "at most 4 s"; the build kept 5 s on the dev's own reading-time argument and left it "for the owner
   to override", which flips the rule. Review flagged it. Rule: a default picked by product ships as
   written; a better idea goes in the issue comment as a question, not in the code. Check: every
   "default picked by product" line in the issue matches the diff, or the issue is parked `needs-info`.

22. **A UI bug report shows the screen.** I filed UI stories from the owner's screenshots as text only;
   the owner had to ask to see what I meant. Rule: every UI story product files carries current-state
   screenshots from `main` at 390x844 (and 360x780 when width matters), shown to the owner in chat and
   linked in the issue body under `docs/product/screens/<story>/`. Check: the issue body has an image
   link and the chat reply sent the file.

23. **A slot is a position, not a search.** #300's first build gave ramp sets to `leadCompoundId` of the
   whole session, so a lead swapped to a fly or push-up before set 1 handed the ramp rows to a lift
   further down; review 1 failed it. Rule: when a rule applies to "the day's lead", read the slot itself
   (the session's first exercise and whether it can lead), never the first match further down. Check:
   `tests/warmUp300.test.ts` (swap to `cable-fly` and `push-up`, push-up-first day).

24. **One "counts as none" rule covers every view of the same records.** #294 hid Progress's zero tiles
   for users whose only record was empty or all-skipped, but Session history still checked
   `sessions.length` and listed a "0 sets" row; review 1 failed it. Rule: when a story defines what counts
   (a finished workout, a logged set), grep every surface that lists or counts those records and use the
   one helper (`finishedWorkouts` in `src/lib/progressTotals.ts`). Check: `tests/progressEmpty294.test.ts`
   renders Overview, Session history and Coach for the same empty-record fixture.

25. **Screenshots on the issue are not screenshots shown.** Prod 3 merged #298 (PR 320) and queued six
   more UI PRs without sending the owner a single image; the shots were only linked on the issues. It
   had also skipped reading this file at start-up, so lesson 22 never applied. Rule: product reads this
   file before its first action. Before it merges a UI story, or reports one as merged, it sends the
   before/after images to the owner in chat (SendUserFile, rendered) with one line per problem it sees.
   A dev chat's report of a UI story isn't passed on without the images. Check: the chat turn that
   reports a UI merge contains a file send of that story's screenshots.

26. **A keystroke is not an edit.** #306's carry decided "which later sets follow set 1" on every
   keystroke and stepper tap, so typing 1, 10, 100 (or stepping reps 8, 7, 6, 5) passed through a
   hand-typed value and took that set along; review 1 failed it. Rule: when an input writes per
   keystroke, decide anything that depends on "the value before" once, at the start of the burst, and
   carry that decision through the burst, even when the first keystroke decides "nobody" (review 2
   found that case still leaked). Check: `tests/carryForward306.test.ts` (review probes) and
   `scripts/e2e/carry-forward.mjs`, which types one key at a time and backspaces (a cleared field
   alone hid the bug); confirm a new e2e step fails on the old code before trusting it.

27. **A removed control takes its tests with it.** #309 replaced the logger's set editor with inputs in
   the row; 19 tests then failed, every one asserting the old panel's markup (pills, Confirm, Skip,
   `Edit weight for set N`) rather than a value the lifter sees.
   Rule: when a UI story removes a control, list the tests and e2e scripts that name it before building
   (`grep -rn "<control text>" tests scripts`), and put that list in the brief; assert the value a cell
   shows, not the element that showed it. Check: `tests/inlineSets309.test.ts` reads cell values by
   accessible name, so the next markup change does not move it.
   Review 1 found the other half: the removed `LoadEntry` wrote the focus value back on a refused
   keystroke, the new cell did not, and only the pure `typedLoad` was tested, so a "not saved" load
   stayed stored. Rule: when a control is replaced, carry over what its handlers *did*, not only what
   it rendered; test the stored value after the keystroke, in the e2e. Check: "review-1" block in
   `scripts/e2e/inline-sets.mjs`.

28. **A refusal undoes the burst, not just the cell.** #309 review 2: set 1 empty, typing 1, 3, 5, 9
   carried 1359 lb to sets 2 to 4; the next 9 was refused and only set 1 went back, so "That load was not
   saved" sat over three sets holding 1359, and set 2 logged it in one tap. The cause was #306's rule that a
   0 is never carried, applied to the fallback too.
   Rule: when an edit fans out, a refusal or an emptied field reverts everything the edit fanned out to (what
   Undo restores), and a typed key past a limit is capped at the field so it never fans out at all. Check:
   `tests/inlineSets309review2.test.ts` and the "review-2" blocks in `scripts/e2e/inline-sets.mjs` (they paste
   to reach the refusal, since typing is capped; each step was run against a469d89 and failed there).

29. **A screenshot waits for the screen to settle.** #307's install-sheet shot was taken while the sheet
   was still sliding in; product had to ask for a reshoot (2026-11-10). Rule: before a shot, wait for every
   finite animation to finish (an endless photo loop never does, so skip it; a Done toast's own 4 s life is
   skipped too). Check: `settle` in `scripts/e2e/notice-kinds.mjs` and the sheet shot in
   `scripts/e2e/install-note.mjs`.

30. **A rule about "a Problem" covers every place a Problem comes from.** #295 review 1: "a Problem
   removes the toast" was built into the one message slot, but a failed save and a tab conflict live in
   their own state, so "Workout saved." showed beside "Not saved." Rule: when a story states a rule
   about a kind of message, grep every state that renders that kind (`notice`, `saveUi`, `conflict`) and
   apply it to each. Check: "toast goes, Problem stays" in `scripts/e2e/notice-kinds.mjs` (it fails on
   c5c05cf).

31. **A rule that stops a carry stops every carry.** #327 review 1: the 10% hold stopped the keystroke carry,
   but logging the held set still ran #182's log carry, so on a "go heavier" day (later sets empty) 80 reached
   every set under "Applied to set 1 only". Apply to all's Undo also used values from before the log, so it
   reversed the reps the log had carried. Rule: when a story says a value "does not carry", grep every path
   that writes later sets (`editSet`, `logSet`, `setRemaining`, Apply to all) and test each from empty and
   prefilled sets; Undo restores what its own action found. Check: steps F and G in
   `scripts/e2e/big-jump.mjs` (both fail at fce9f92) and the "review 1" tests in `tests/bigJump327.test.ts`.

32. **"Fails on main" means the main you were given.** #332: the lesson-26 check ran the new e2e
   steps against `git checkout main -- src/App.tsx`, but the clone's local `main` sat at 9d4285a, older
   than the base beadabe; the steps passed there and looked useless. Against beadabe they failed.
   Rule: run the "fails on old code" check against the named base SHA (`git show <base>:<file>`), never
   a local branch name. Check: the issue comment names the SHA the e2e failed on.

33. **A grouping that later steps must keep is stored, not derived.** #88 reviews 1 and 2 failed on the
   same point: supersets were derived from the session's list, so a swap re-paired exercises nobody touched
   (563 of 4,553 swap-sheet swaps). Walking slots instead of entries (eb2e17c) only moved the leak: skip,
   log the next pair, Return, Replace still re-paired started work, and a swap before set 1 moved another
   pair in 544 of 4,557 options. Storing `WorkoutExercise.pair` at Start fixed it (lesson 1).
   Rule: when a change to one item must leave the others' grouping alone, store the grouping when the
   session starts; a change clears its own group only, and nothing re-derives after start. Raise the
   stored key at the plan stop, not after two reviews. Check: the swap-sheet sweep in
   `tests/supersets88.test.ts` (before and after set 1, 0 untouched pairs moved) and the review 2 repro test.

34. **A product switch is not a test fixture.** #88's older tests set `pairExercises: false` to keep their
   straight-set numbers, so no sweep ever checked a paired described day. Once they ran paired, one did
   fail: a 30-minute "arms, legs, core" day left Glutes out "for time" beside a second Quads move (#211),
   because the cover check timed a partial day whose pairs differ from the final one.
   Rule: when a feature changes the model a test checks (time, sets, order), move the test onto the new
   model; pin the old output only where the feature is off by design (Beginner, over 45, switch Off), and
   say so in the test. Check: `grep -rn "pairExercises" tests` lists only the supersets tests.

35. **A calendar-day e2e pins its clock.** #296 review 2: the switch-picks e2e seeded sessions "26 h" and
   "40 h" ago and asserted "trained yesterday" and "trained 2 days ago"; at some hours (and in some time
   zones) those land on another calendar day, so the suite failed by time of day. Review 1 had also failed
   on a cut label that only the longest text ("trained 2 days ago") showed, which the first e2e never seeded.
   Rule: an e2e that asserts a calendar-day word fixes the page clock (`page.clock.setFixedTime(local noon)`)
   and seeds the longest label it can show. Check: `scripts/e2e/switch-picks.mjs` passes under
   `TZ=Europe/Moscow` and `TZ=Asia/Tokyo`; its 5f58f9c version fails under Moscow.

## Recurring edge cases (put the relevant ones in every brief)

- **Sessions:** running vs not started; a swap mid-session; finishing early; a session open across midnight; legacy records without newer fields.
- **Gear:** saved setup vs today-only (Travel gym, Bodyweight, Bands); gym kit with a stale stored rack; no-gear profiles (saved setup is bodyweight).
- **Time:** shorter and longer than the saved length; 15/20 min floors; ≈ when under half.
- **Days:** planned vs described; empty days; Limited must name its reason.
- **Data:** older data without a new field; export/restore round trip; validate rejects bad values.
- **Offline:** first visit then offline; a new deploy replacing cached assets; photos never loaded online.
- **Phones:** 390×844 and 360×780; a 650px-tall visible area (iPhone Chrome); keyboard open; iPhone Home Screen app has its own storage.

## Efficiency

- Reviewers should reuse committed sweep tests instead of rewriting sweep scripts each round. When a
  reviewer's probe finds a bug, turn the probe into a test in the fix.
- Briefs should point to this file and `AGENTS.md` instead of repeating global constraints in full.
