# 02: Holds are labelled in seconds

**What to build:** An isometric hold reads as a duration everywhere in the session, not as a rep
count. On the plank the logger's set summary, the log button, the saved-set line and the set editor
all say seconds; the prescribed target already says "45s". Rep-based movements keep saying "reps".

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Logging the plank shows sets, the log button and saved sets in seconds
- [ ] The set editor's rep field is labelled in the movement's own unit
- [ ] Dumbbell floor press, goblet squat and dumbbell row are unchanged and still read in reps
- [ ] Session history, the recap and the export format are unchanged: no new stored field and no
      migration
- [ ] The unit choice lives in one place shared by every surface that prints a set, so adding a
      second timed movement later needs no new label code
- [ ] Problem: seconds are still stored in the existing rep field, with a one-line code comment
      naming that limit and when to add a real unit field.
