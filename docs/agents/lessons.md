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
   Rule: commit only in a separate step after reading the counts. Check: `scripts`/merge helpers stop on
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

## Recurring edge cases (put the relevant ones in every brief)

- **Sessions:** running vs not started; a swap mid-session; finishing early; a session open across midnight; legacy records without newer fields.
- **Gear:** saved setup vs today-only (Travel gym, Bodyweight, Bands); gym kit with a stale stored rack; no-gear profiles (saved setup is bodyweight).
- **Time:** shorter and longer than the saved length; 15/20 min floors; ≈ when under half.
- **Days:** planned vs described; empty days; Limited must name its reason.
- **Data:** older data without a new field; export/restore round trip; validate rejects bad values.
- **Phones:** 390×844 and 360×780; a 650px-tall visible area (iPhone Chrome); keyboard open; iPhone Home Screen app has its own storage.

## Efficiency

- Reviewers should reuse committed sweep tests instead of rewriting sweep scripts each round. When a
  reviewer's probe finds a bug, turn the probe into a test in the fix.
- Briefs should point to this file and `AGENTS.md` instead of repeating global constraints in full.
