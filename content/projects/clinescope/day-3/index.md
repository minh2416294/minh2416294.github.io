---
title: "Day 3: Validation corpus: the failure mode no free model would produce"
date: 2026-07-14
draft: false
weight: 3
tags: ["eval-reliability", "coding-agents", "clinescope", "validation"]
summary: "I validated my scorers on real captured agent failures, and shipped the one failure mode I couldn't capture as a documented gap instead of faking a trace."
---

To demonstrate that an eval scorer catches a failure, you need a trace that actually fails that way. I could show the failures that I cared about from the free local models, except one. The last one would not come from any of the models I had run, so I chose to document that as a gap rather than fabricate a trace to round out the four-of-four. This is why circular self-validation is valueless to a skeptic, and why a documented hole is worth more points than a padded score. It rests on the committed corpus: [examples/corpus](https://github.com/minh2416294/clinescope/tree/main/examples/corpus).

## The temptation, and why it fails

The most straightforward way to evaluate scorers' quality is to write some traces, which the scorers would fail on in the way outlined in my question. This is a valueless test, and a maintainer would explain why in one sentence. The person creating traces has to make the same assumptions about the code as the person creating the scorer. If I were to write a 'wasteful patch' trace by hand, then I would be writing exactly the wasteful patch that my supposed test is looking for. The only thing such a test would demonstrate is that I can score according to my own specifications, not that the scorer is somehow magically correct. A self-graded argument is just a demonstration.

So the corpus is actually composed of real captured failures, six traces in total, none of which were authored by us. Each trace is a real Cline trial against a local model paired with an expected per-scorer profile, and the runners have been scored on each trace and exited non-zero if any trace was incorrectly labeled. The traces are real, the failures are real, and the runners all caught all the failures and were silent on the clean runs.

## Getting real traces for free

The obvious problem: capturing real agent failures usually means burning API budget on a frontier model. I had none to spend, so I needed free failures.

The unlock was in Cline's own routing code. Cline decides whether to give a model the `apply_patch` tool by a substring match on the model id: if the id contains `"gpt"`, it routes to `apply_patch`, provider-agnostic. OpenAI's open-weights `gpt-oss` contains `"gpt"`. So `gpt-oss:20b` run locally through Ollama routes to `apply_patch` exactly like a hosted GPT model, at zero cost and no key. That gave me a real coding agent emitting real patches on my own machine. (That's the routing behavior I read at the time; check Cline's current source before relying on it.)

With that, the failures came cheap. Two simple local models gave me two different failure modes captured in the traces: one hallucinated a tool, but did not make a patch envelope according to Cline's algorithm, and the second one spat out some plain text code and did not make a tool call at all.

## The failure I could not force

The corpus covers three of the four failure modes in the taxonomy with real traces. The fourth, `blind_rewrite`, is the one my whole diff-minimality scorer exists to catch: a patch that is valid enough to apply but bloated, a whole block deleted and retyped. To capture it I needed a trace that is both things at once: a *valid* `apply_patch` (so it parses and applies) that is *also* a blind whole-block rewrite.

No local model I ran produced one, and the reasons turn out to be informative as to what I observed on my own machine, rather than general truths about these models. Across the models I ran locally: the weak coders hallucinated a tool or dumped code earlier, at the level of tool-calls, leading to malformed patches that were never valid-but-bloated. `gpt-oss:20b` did produce valid patches, but when asked to rewrite an entire function it reasoned out the blind rewrite in its thinking, then stalled before the apply_patch call, thus no valid bloated patch was present in the trace. One model I ran refused to use the tool entirely. The mode is in between "too weak to emit a valid patch" and "not weak enough to avoid over-writing in the first place". Only two of the models I ran resulted in a trace I would consider worth committing to; the rest are observations, and I am careful to make that distinction, below.

I had two options. Author a synthetic blind-rewrite trace and claim four-of-four. Or ship three-of-four with the fourth documented as a stated gap. I shipped the gap.

## Why the gap beats the fake

A synthetic trace here would be the precise circular evidence I dismissed at the beginning. I would be writing exactly the bloated patch my scorer is looking for, then proceeding to present the scorer catching it as validation. The number would say four-of-four; the evidence would be worth zero. No maintainer who has seen one padded benchmark will take the entire corpus of traces seriously after finding a single obviously authored trace in it.

The documented gap costs me a round number and buys me a corpus a skeptic can trust end to end. The `blind_rewrite` scorer is still exercised by unit tests against authored patch bodies, so the code path is covered. What is missing is a real captured *trace* of the mode, and I say so, in the corpus README, with the per-model reason each one failed to produce it. Coverage of modes with real evidence is worth more than a round number with a synthetic.

The rule that I would give to someone who wants to build an eval corpus is that if the person who wrote the code also wrote the traces that it is being graded against, the eval is a demo. Captured failures are the only evidence that a skeptic cannot dismiss, and a documented gap excels a padded score.

## Open questions

- If you validate an eval tool on captured runs, how do you handle the failure mode you cannot reproduce on demand? Author it, or ship the gap?
- Weak local models fail at the tool-call stage; strong ones do not over-rewrite. Is there a reliable way to make a capable model emit a valid-but-bloated patch on purpose, without hand-editing the trace?