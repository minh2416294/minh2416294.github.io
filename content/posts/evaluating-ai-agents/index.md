---
title: "Evaluating AI Agents"
images: ["share.png"]
date: 2026-07-15
weight: 1
draft: false
tags: ["eval-reliability", "coding-agents", "llm-evaluation", "ai-engineering"]
summary: "Everyone evaluates the agent's loop: its trajectory, its reliability, its tool calls. Almost nobody evaluates the artifact it produces, which is exactly where AI code fails."
---

A code agent I was observing passed my test suite, correctly calling all the utilities in order to get to `end_turn`. It worked, by every metric I had. Then I look at the diff, and see that it had deleted a working forty-line function and retyped it almost verbatim in order to change one branch, hiding the one-line change in a huge chunk of code that any reviewer would have to read in entirety to be properly confident in the correctness of the change. The tests were passing; the behavior was correct. The diff was, objectively, bad code. But nothing I measured could see that.

That is the gap this whole post is about. We have gotten good at evaluating whether an agent reached the goal and how it got there. We are still not evaluating whether the thing it produced is any good.

I wrote a version of this argument before, for RAG, in [Pitfalls in RAG Evaluation](/posts/your-rag-eval-is-lying/): a faithfulness score of 0.91 while users got wrong answers, because the panel measured the generation layer and never looked at retrieval. This is the same mistake, one domain over. For a coding agent, the layer nobody measures is the diff.

## The layer everyone skips

Open any existing agent evaluation guide, and you would find the same set of criteria: score the task completion, score the trajectory (reasonableness of tool calls in the execution path), and defer the rest to an LLM judge. This reflects a real set of concerns, most of which I address in my own evaluations. But there is still one layer missing.

Scoring the task completion is the equivalent of RAG's faithfulness score; it is a downstream metric that rarely fails when an upstream process has failed. An agent's task completion is successful, but the code it wrote to get there may not be easy to review, minimally invasive, and generally acceptable for a human to accept. That is the question that determines whether a code change should be merged.

I sought existing tools that could score this sort of code change, but in my survey, none of the frameworks I tested had the ability to judge the quality of the code change beyond the tool selection. DeepEval judges the tool selection, but not the patch. promptfoo, Langfuse, Braintrust, and UK AISI's Inspect all score the harness around the agent, not the change it made. (This is based on my understanding of that product's documentation at the time of this writing; you are encouraged to consult the tool's documentation for yourself.) The test harness is great, but it does not judge the patch.

So I built the missing layer, as a small tool called [clinescope](https://pypi.org/project/clinescope/), and the rest of this post is the framework it taught me, with the uncomfortable parts pointed at my own work.

## The layers of an agent, and what breaks in each

Here is the stack I actually evaluate a coding agent on, each level of which is tied to a particular scorer, and the failure it detects and does not detect. The blind-spot column is what I think is important, since a scorer that does not recognize its blind spot is worse than useless, in that someone may be misled into trusting the score.

| Layer | The question | What it catches | Its named blind spot |
|---|---|---|---|
| **Tool trajectory** | Did it call the tools the task needed? | An agent that never invoked the tool the job required. | Invocation, not success. An errored call still counts as "used"; selection is not the same as a working call. |
| **Patch syntax** | Is the patch well-formed against the agent's real grammar? | A patch that will not parse or apply at all. | Grammar from the patch text alone, not apply-against-a-real-file success. There is no repo checkout in a captured trace to match against. |
| **Edit quality** | Is the edit surgical, or a blind whole-block rewrite? | Deleting a block and retyping it wholesale instead of editing in place. | Exactly one bloat shape. It is deliberately blind to dragging large unchanged context, because penalizing context inverts the metric (see below). |
| **Recovery** | When a patch failed, did the agent recover? | An agent that hit a failed apply and gave up or looped. | Trajectory recovery, not fix-correctness. A "recovered" patch is one the agent got to apply, not one verified right. |

The edit-quality layer is where the interesting failure lives, and it is where I nearly shipped a metric that lied. "Wasteful" felt easy to measure: a bloated diff drags in more context, or retypes lines nearly identical to the ones it replaced. Both of those signals invert on real patches. Context is load-bearing, the agent's patch format needs it to locate a hunk, so penalizing context punishes the well-formed patches hardest. And a tight surgical edit produces added lines that look almost exactly like the originals, so high line-similarity is the signature of the *good* edit, not the wasteful one. I killed both signals and shipped the one reference-free shape that survives: a run of deleted lines immediately retyped with no anchor kept. The full autopsy is in [the metric I killed before shipping](/posts/diff-quality-scoring/) (PR [clinescope#9](https://github.com/minh2416294/clinescope/pull/9)). The lesson that generalizes past diffs: before you ship any quality metric, construct the real case where it rewards the behavior you meant to punish. If it inverts, you have a demo, not an evaluator.

This is also why whole-system pass/fail is not enough on its own. I have [made the compounding-error argument before](/posts/your-agent-has-no-ground-truth/): five steps at 75% each is 24% end to end, and a single top-line number cannot tell you which step collapsed. Per-layer scoring is how you find out which factor in that product went to zero.

## Validate your evaluator, then bench it

There is a layer above all of those, and it is the one the field says to do and almost nobody shows the result of: validate your evaluator.

Three of my four layers are deterministic, no model, same input same output. The edit-quality layer has a fuzzy edge the heuristic cannot reach, so I added an optional LLM judge for the subtler wasteful edits. Then I did the thing everyone recommends: I measured whether the judge agrees with a human, on a set a human labeled blind, using chance-corrected agreement (Cohen's kappa, because raw agreement flatters a judge on an unbalanced set).

It came back at kappa 0.0496. Chance is zero. On a balanced set, the judge catches 3 of the 24 genuinely wasteful patches. And it got there the honest way: an earlier, smaller, friendlier set had read 0.2353, and when I grew the set to fifty harder, balanced, blind-labeled cases, the number dropped toward chance and I kept the worse number. The full account, including why I did not tune the prompt until the number looked better, is in [the number I let get worse](/posts/llm-as-judge-validation/) (PR [clinescope#50](https://github.com/minh2416294/clinescope/pull/50)).

So the judge advises, and it never gates. My CI gate runs on the deterministic layers only and imports none of the judge code, and a test parses the gate's source and fails if it ever does:

```python
forbidden = {"judge", "judge_run", "agreement", "gold", "label_gold"}
leaked = imported & forbidden
assert not leaked, f"gate.py must not import judge-arc modules, found: {leaked}"
```

That is the whole point of validating an evaluator: not to produce a number you can put in a README, but to know which signals you are allowed to gate on. A metric you measured at chance has no business deciding pass or fail. Everyone says calibrate your judge. The part almost nobody publishes is the calibration coming back bad, and acting on it anyway.

## Evidence a skeptic can't wave away

One more level below that, what are the scorers validated against? This is where the field provides the answer, hiding "look at your data" behind the production of real evals from real failures, and it's right but not often followed through to the artifact, only the sermon.

The artifact is a corpus of real traces, six in my case, none of which I wrote myself. They are all real scored runs against a local model, and a runner scores every single one and fails if it misses any of the expected labels. What it means to be real and not written is critical: if I were to write out the traces myself, I would have had to write exactly the failures my scorers are looking for, and the fact that I can write them is why they should be distrusted as proof of anything beyond my own skill as a writer. If you are a maintainer and you see one of my traces, the one you have written, in your benchmark, you are just as likely to take it as evidence of your own skill to write your own.

It also reveals a gap, left visible on purpose: one of the four failure modes represented in the artifact, blind whole block rewrites, is one no free local model I tried would ever produce cleanly, so the corpus scores three of every four failures as real traces, and one as a documented gap, because I cannot fill it with a trace without writing it myself. This is the cost of the full story told in the corpus, and a necessary one if you expect a skeptic to take it as anything beyond window dressing. The full story, including the routing trick that made real traces free, is in [the failure mode no free model would produce](/posts/validation-corpus/). A documented gap costs a round number and buys a corpus a skeptic can trust end to end.

## What I'd do differently

If I were to design a coding-agent eval from scratch today, three things stand out to me.

First, I would think in layers. Before even writing code for any agent, think through what “working” means at every level: trajectories, syntax, edits, recovery, etc., and which of those you can judge deterministically. That is, if you can’t measure it yourself, you will spend weeks chasing ghosts in production. It is the same advice I would give for designing a RAG eval, and it has served me well in the transition to agents.

Second, I would treat the diff as a first class eval target, not an afterthought to tests-pass. Tests-pass is a necessary condition, but an insufficient one, and the diff is what a human has to actually accept. It is also the layer with the least amount of tooling and the most room for error.

Third, and finally, and perhaps most importantly, I am not confident that I scored the bloat I explicitly left out, the context dragging that comes from large context windows correctly. Every signal I tried for it was inverted. So I released the narrow honest scorer and called out the gap. I believe there is a reference-less way to score context-drag that does not punish patches that legitimately need the context, and I have not found it yet, but I think there is one. If you think you know it, tell me!

The pattern that unites all of these is the same discipline that underlies every choice in this tool’s development: making the tool return true statements, even when they hurt. A judge that only scores at chance level, that fails to even get into production. A metric that gets removed because it rewarded poor behavior. A corpus that ships with three out of four signals having the gap noted. An evaluator that is only useful insofar as it can say ‘this thing you made, this model you trained, this agent you are shipping in production, this assistant answer, this hallucination, this red herring’ is bad, including when the thing it is evaluating is the evaluator itself

## Open questions

- For coding agents specifically: is anyone scoring diff quality as a first-class eval dimension, separate from tests-pass and trajectory? If so, what signal do you use, and did you check it against real patches or against your intuition about them?
- Is there a reference-free way to catch the large-unchanged-context bloat that does not invert the way a raw context-line count does? I could not find one, so I shipped the narrow scorer and left it as a stated gap.