---
title: "Diff-quality scoring: the metric I killed before shipping"
date: 2026-07-15
draft: false
weight: 1
tags: ["eval-reliability", "coding-agents", "clinescope", "diff-scoring"]
summary: "I built a diff-quality scorer no eval framework ships, then proved my own minimality metric rewards the wrong behavior on real patches."
---

I killed the more impressive version of my own metric before shipping it. And if you're building evaluators or shipping coding agents, this post is for you five minutes because everything I write here about obvious signals for scoring a "wasteful" diff paid off when run against real diffs: every single one of them rewarded the exact behavior I was trying to penalize! The scorer I ended up shipping detects one particular class of mistakes and its docstring even tells you what it doesn't account for. This is the story of what went wrong , why I think it happened, and the bet that ultimately got me to build a diff-quality scorer in the first place. The bet is captured in this one PR: [clinescope#9](https://github.com/minh2416294/clinescope/pull/9).

## The metric that inverted on me

"Wasteful" felt easy to measure: a wasteful diff rewrites more than the change needs. The obvious signals were context-line count (a bloated patch drags in more surrounding context) and line-similarity (a patch that retypes lines nearly identical to the originals is churning for nothing). Both feel right. Both are wrong, and I only found that out by running them against real `apply_patch` bodies instead of trusting my intuition.

Context-line count inverts because context is load-bearing. Cline's `apply_patch` needs the surrounding lines to find the hunk in the file; strip them and the patch stops applying. More context is not more wasteful, it's what makes the patch work, so a metric that punishes context penalizes the well-formed patches most.

Line-similarity also inverts for the same kind of reason. Tight surgical edits create new lines that look extremely similar to the ones they replaced, because the change was made at the level of a single token. High line-similarity is the defining characteristic of the minimal edit I think should be rewarded. My metric would have correctly identified it as such.

Every single context-count and line-similarity “metric” I tried ended up rewarding the good patches more than the bad, so I killed the whole family of them. The rule I took away from it, which hopefully makes this post worth your time: before shipping any quality metric, build a counterexample where it rewards the behavior you wanted to punish, and vice versa. This way, you know you have a demonstrator, not an evaluator.

## Why I was building this at all

I went looking for what nobody scores. Most eval tooling scores whether the answer is right. For a coding agent, "right" usually means the tests passed, which tells you the code ran and nothing about whether the diff that got you there was a one-liner or a shotgun surgery. An agent that passes by rewriting an entire function, when it could have made the minimal change to make the tests pass, is worse, not better.

From the frameworks I surveyed, none scored that. DeepEval scores tool selection, not the patch. promptfoo, Langfuse, and Braintrust give you the harness and leave the diff scorer to you. UK AISI's Inspect runs SWE agents but ships no diff-quality scorer. (That's my read of their docs at the time, not a claim from theirs; check your own version.) Reading incumbents for what they leave to you is how you find an un-served problem without chasing a trend. The wedge was there. Minimality was the first piece, and it was the one that inverted.

## The one shape that survived

What survives is narrow and provable from the patch text alone: a blind whole-block rewrite. Inside an `*** Update File` hunk, a run of three or more deleted lines immediately followed by three or more added lines, with no anchor line kept. Delete the block, retype the block, keep nothing. You can detect that without a reference, because it's a structural property of the patch, not a comparison with some hypothetical perfect patch I don't have.

```
score = 1 - (blind_rewrite_hunks / hunks_with_body)   # floored to a 1/4 grid
```

The threshold is a stated choice, not a magic number. `FLOOR = 3`: a one or two line delete-then-retype is the commonest legitimate surgical edit, so penalizing it would reintroduce the inversion I just escaped. A run of three or more is the text-provable "rewrote the whole block."

The part that interests me most is what the author thinks the scorer would refuse to say. Its own docstring explains what bloat it can't see, and why the obvious fix would be invalid:

It doesn't recognize its own bloat. It has a docstring that names the bloat it can't see, and says why the obvious fix would be invalid.

> It is **BLIND to the other, more common bloat: dragging large unchanged context.** It deliberately does NOT threshold on context-line count, because context is what `apply_patch` needs to anchor a hunk, penalizing it would *invert* the metric on well-formed patches.

That "because context is what `apply_patch` needs to anchor a hunk" is the whole proof in one clause. And the scorer refuses to let you misread a low score:

> A LOW score means "contains a large blind rewrite" (which MAY be necessary, read it as *large-block*, not *wasteful*); a HIGH score means "no blind rewrite", NOT "minimal".

A scorer that overstates the implications of a number is dangerous, because the someone downstream will gate on the number. This one tells you that this number is a fact about the patch text as a structure. There is no reference or repo checkout in a trace that isn't in a repo, so comparing churn to an ideal would be theater. The narrow signal is better than the dishonest broader one.

## What this cost

Killing the obvious metric made me lose the version of the tool which would look more appealing. The minimal scorer which would also report the context count sounds like a tool that would cover all the aspects, thus making it hard to miss something essential. Instead, the choice to go with the narrower option made my product do less, therefore stating that it does less, which might be a harder sell than the README suggests.

The tradeoff I'd flag for anyone building the same thing is that a reference-free structural signal is both honest and partial - it'll catch the blind rewrites, but not the patches that carry fifty lines of context that weren't rewritten at all. That hole in the solution is real, and the scorer names it rather than trying to paper over the issue with a signal I already watched invert.

## Open questions

- If you've built a diff or code-quality scorer, what signal did you use for "wasteful", and did you check it against real patches or against your intuition about them?
- Is there a reference-free way to catch the large-unchanged-context bloat that doesn't invert the way context-count does? I couldn't find one, so I left it as a stated gap.
