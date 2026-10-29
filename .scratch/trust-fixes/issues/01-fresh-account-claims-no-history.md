# 01: A fresh account claims no history

**What to build:** A user who has never completed a session sees no number anywhere that claims they
trained before. Today's first workout row, the coach insight, the live logger's "Last session" line,
the target sheet and the exercise guide all report having no record. After one real session, real
numbers appear and never fall back to sample values.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] With zero completed sessions, no screen, sheet or coach line states or implies a prior session
      for any exercise
- [ ] The first-session copy ("First session on the …") is what a new user sees on Today
- [ ] After completing one workout, the completed sets appear as the last session on Today, in the
      logger and in the target sheet, and reloading the page keeps them
- [ ] The per-exercise lookup that answers "what did I do last time" exists once in shared code and
      is covered by a test asserting it returns nothing for an empty history
- [ ] Sample/session history data is not reachable from shipped screen code
- [ ] Problem: the prescription (sets, rep targets, load) is unchanged. Only claims about what the
      user did are removed.
