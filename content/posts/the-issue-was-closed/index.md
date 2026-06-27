---
title: "the issue was closed before I wrote a line"
date: 2026-06-18
draft: true
tags: ["open-source", "contributing", "cline", "github"]
summary: "I had a correct fix planned for a good-first-issue. Then I checked the issue's status: closed, not planned. The fix was right and the merge path was dead."
---

I picked a clean first issue in [cline/cline](https://github.com/cline/cline) — issue #5886, "MCP Tool Call Arguments are not word wrapped." Labeled Good First Issue. Unassigned. A self-contained webview fix. I'd written the whole plan: the branch name, the component, the two-line change, the `Fixes #5886` in the PR description. The fix was correct — cline's own maintainer-bot had even posted the same recipe on the issue.

Then I looked at the issue's actual state, which I should have done first. `CLOSED`, as `NOT_PLANNED`, since March. And three open PRs already taking a swing at it.

The fix was right. The merge path was dead. Those are independent facts, and I'd spent all my attention on the first one.

## A correct fix that can't merge is worth zero

This is the trap, and it's easy to fall into because writing the fix *feels* like the work. The fix was genuinely correct — same diagnosis as the bot, same patch I'd have shipped. But the issue was closed `NOT_PLANNED`, which is a maintainer saying, on the record, "we've decided not to do this." A `Fixes #5886` PR walks straight into that decision. Best case it's ignored; likely case it's closed with a polite link back to the original rejection.

And even if it had been open, three other people were already on it. A first-time contributor's PR competing against three existing ones for a beginner-bait issue is not a merge — it's a queue.

So the real metric for an OSS contribution isn't "is my fix correct." It's "will this merge," and correctness is only one input to that. The others — is the issue open, has a maintainer signalled they want it, is anyone already working it — sit entirely outside the code, and I'd checked none of them before planning the patch.

## What "reachable" actually means

I started over with a different first question. Not "can I fix this?" but "if I fix this, can it merge?" Concretely, an issue is reachable when:

- it's **open** (not closed `NOT_PLANNED` / `COMPLETED`),
- it has **no competing open PR** already in review,
- a maintainer has **signalled they'd take a fix** (a label like Help Wanted, a comment, a triage decision — not just an unanswered report),
- and the change is **small enough** that a stranger's PR is low-risk to accept.

Then I ran that filter across the repo, and watched the obvious categories fail it one by one.

**Good First Issues:** only three were open and unassigned — and they get picked clean instantly, because every newcomer filters for that exact label. Chasing them reproduces the #5886 problem: maximum competition, minimum reachability. The label that's supposed to welcome beginners is the most crowded shelf in the store.

**Help Wanted (non-GFI):** more promising precisely because they're less newcomer-bait, so less crowded. Better, but several still had competing PRs.

**Recent, unassigned, zero open PRs, any label:** this was the category with actual openings. Filtering to issues from the last ~30 days with no competing PR surfaced a handful of genuinely reachable targets — and the most reachable were documentation fixes: low-risk, not worth PR-farming, and maintainer-friendly. Three came back with zero competing PRs:

```
#11688 — open, 0 PRs
#11670 — open, 0 PRs   ← docs(mcp): JSON example omits `type` field
#11620 — open, 0 PRs
```

That's the difference between fishing where everyone fishes and fishing where the merge is actually available.

## The order that matters

The mistake wasn't picking a bad issue. #5886 was a perfectly good *bug*. The mistake was sequencing: I diagnosed and planned the fix before checking whether the fix could ever land. Those steps were in the wrong order, and the cheap one — `gh issue view 5886`, ten seconds — was the one I did last instead of first.

For contributing to a repo you don't own, the reachability check is upstream of the code. Open the issue's live state, scan for competing PRs, look for a maintainer signal, *then* decide whether to write anything. Reordering those two steps is the whole lesson. It costs one CLI command and saves you from the specific, deflating experience of finishing a correct fix that was never going to merge.

What I'm still chewing on: whether the most reachable issues — uncontested docs fixes — are reachable *because* they're low-value, and whether optimizing for "will it merge" quietly steers a first contribution toward work that doesn't actually demonstrate much. There's a real tension between a PR that lands and a PR that shows you can do the hard part, and "pick the reachable one" optimizes for the first at some cost to the second. I don't yet know how I'd balance those for a second or third contribution, once the goal shifts from "land anything" to "land something that matters."
