---
title: "Day 2: LLM-as-judge validation: the number I let get worse"
date: 2026-07-14
draft: false
weight: 2
tags: ["eval-reliability", "llm-as-judge", "clinescope", "cohens-kappa"]
summary: "I validated my eval tool's own LLM judge against human labels, watched a bigger honest set drive the number toward chance, and kept the worse number out of the gate."
---

I built an LLM judge to be a quality signal inside my eval tool, calibrated it to my own human labels, and then benched it from the pass/fail gate on principle while it still looked salvageable. Then a bigger, more honest test set pushed the number towards chance, and I shipped the worse number. This post is the decision and its reversal, in the order they happened, with both numbers stated explicitly. It's grounded on the committed validation doc and gold set: [clinescope#50](https://github.com/minh2416294/clinescope/pull/50).

If you gate anything on an LLM-as-judge, the check at the end is worth stealing.

## The judge, and what it was for

The four core scorers in Clinescope described its deterministic algorithm, because for all of them, the same input yields the same output. But among the deterministic scorers, the implementation of the diff-minimality has a built-in uncertainty. The deterministic scorer was able to detect a wasteful edit when the whole block was replaced by a new one (e.g., deleted and retyped). In the docstring, the authors claimed that more subtle cases of wasteful edits were outside the scope of this scorer. Hence, I added an optional judge, which was implemented as a local gpt-oss:20b model over Ollama. It was asked one specific question about the patch provided as context.

Any tool that makes judgements based on a model should be able to give you one simple answer: does the judge agree with a human? And so I set out to measure it, and the measuring was actually interesting.

## Label theater is the failure mode nobody mentions

The first trap has undermined most self-evaluations. By letting the model help produce the labels that it is then graded against, you have made agreement a performance against itself, which is not really a test at all. I called this the number one threat to the value of the process before writing the harness.

As described in the paper, the labels are created blind, by hand, not automatically. The human labeler sees only the item id and the patch text; they do not see the deterministic score, the judge’s guess, or the notes. The labels are all the individual’s own; none are produced by an automatic algorithm. The labeling module is designed in such a way that it does not import the scorer or the judge, meaning that a label cannot contain information about the thing it is supposed to be evaluating. A labeler’s ground truth cannot be produced automatically by an evaluator and be independent of it, for then, the number would not reflect the opinion of the one who provides it

## Raw agreement flatters. Chance-correction is the point

The naive measure for reporting this is true positive rate: how often is the judge correct given that the human was correct. This is probably a fine metric for my data set, but it's also completely useless, since the data set is skewed. If most patches are not wasteful, then a judge that always says "not wasteful" will have a good true positive rate while actually learning nothing.

Chance-corrected agreement gives just that. Cohen's kappa basically asks the question "how much better than random guessing according to the base rates in the data would the two raters do," as the two raters are applied to a binary question, with an unbalanced set of cases. Cohen's kappa is the metric that prevents one from getting inflated agreement scores when the answer is always "yes." That's why I report Cohen's kappa and not raw accuracy.

## The decision, before the number got bad

The first honest measurement, on a 26-item gold set, came back at Cohen's kappa = 0.2353 (95% CI [0.0, 0.5229], N=26). That is already below the 0.5 floor I had set for trusting a judge, so it fired the advisory tripwire, and that is where the decision got made.

The decision: the CI gate would run on the deterministic scorers only, and would never call the judge. Gating a build on a signal I'd just determined to be untrustworthy would contradict the whole point of the validation in the first place. And I had no interest in making this a promise in a docstring that would rot. The gate module doesn't import any of the judge-arc modules, and a test parses the gate's source and asserts it:

```python
forbidden = {"judge", "judge_run", "agreement", "gold", "label_gold"}
leaked = imported & forbidden
assert not leaked, f"gate.py must not import judge-arc modules, found: {leaked}"
```

If a future refactor tries to wire the judge into the gate, that test goes red. The restraint is mechanical, not a comment I have to remember.

Worth being precise about what I did *not* do here. A low `num_predict` cap was truncating the model's answer on exactly the reasoning-heavy cases, which were the WASTEFUL detections, so a tight cap was systematically dropping WASTEFUL verdicts and biasing kappa toward zero. Sizing that cap correctly is a correctness fix. Rewriting the judge's prompt until kappa cleared my floor would have been metric-gaming, and I did not do it. The 0.24 was the first honest number, not a tuned one.

## Then honest data made it worse, and I kept the worse number

My 26-item set was small, and skewed toward "not-wasteful", which flattered a judge that implicitly favors "not-wasteful". So I expanded the gold set to 50 items: a larger set of more challenging cases, carefully balanced (but still blind-labeled).

It drove the number down.

```
cohen_kappa:  0.0496    95% CI: [-0.1200, 0.2175]    N = 50

confusion (rows = human, cols = judge):
                       judge WASTEFUL   judge NOT-WASTEFUL
  human WASTEFUL              3                21
  human NOT-WASTEFUL          2                24
```

Chance is zero. The judge sits at 0.0496, and its confidence interval straddles zero. The confusion matrix says it plainly: on a balanced set, the judge catches 3 of the 24 genuinely wasteful patches. It calls almost everything fine.

This is the fork the post is named for. I could have kept reporting the 0.24 from the smaller, friendlier set. It was a real number I really measured. Instead I published the 0.0496 as the honest floor, and wrote down *why* the earlier number was inflated: the small set was not-wasteful-heavy, and a biased judge looks good on a set that shares its bias. The bigger, balanced set is the truer test, and the truer test is worse. Keeping the worse number is the whole point. The alternative is picking the sample that makes your tool look best, which is the eval-integrity failure this whole exercise exists to avoid.

## The judge is not even stable

One more thing surfaced, and it is the reason I do not report the kappa as a hard constant. I had a test asserting the judge is deterministic at temperature 0. An adversarial check disproved it: on one flip-prone item, with SHA-verified identical input at `temperature=0, top_p=1, seed=0`, the model flips its verdict between WASTEFUL and NOT-WASTEFUL run to run, about a third of the time. Temperature-0 plus a fixed seed does not suppress the GPU and cache nondeterminism underneath.

My own little stab at a stableness check was, well, lucky. So why not say so? I took the reported kappa and labeled it a single draw from a much broader sampling distribution, then built a whole multi-draw harness around it for good measure: draw the judge’s verdict K times, report the deviation of headline kappa from one draw to the next, calculate the judge’s self-consistency on all the draws with Fleiss’ kappa and report that. If it turns out not to be stable, the best thing to do is not to cite it as if it were, but to quantify how much it isn’t.

## What you can steal

Before you gate anything on an an LLM judge, compute chance-corrected agreement (Cohen’s kappa) against a sample labeled blind to the judge by a human. If it’s not substantially higher than zero, you have a rubber stamp, not an evaluator, regardless of raw agreement. An advisory signal that has no hope of being reliably correct (i.e. substantially better than chance) is not fit to decide whether anything should pass or not. I advise, but I do not decide. You can reproduce the whole process from the committed cache with no model calls, using the command: `python -m clinescope.judge_run --report-only`.

## Open questions

- If you run an LLM-as-judge in production, have you computed its kappa against blind human labels, and did the number survive a bigger, balanced set?
- The judge flips about a third of the time on hard items at temperature 0. For anyone gating on a judge: are you drawing it once, or multiple times and voting, and how do you report a number that moves run to run?
