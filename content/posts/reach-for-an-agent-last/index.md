---
title: "Picking the Right LLM Architecture"
date: 2026-03-21
draft: false
tags: ["llm-architecture", "agents", "system-design", "ai-engineering"]
summary: "A decision framework for picking LLM architecture by asking what failure costs first and why agents are the right answer less often than you think."
---

The first question I ask when shown an agent architecture is not "does it work?" It is "what happens when it does not?"

That question can turn a positive response into a negative one. Most people are thinking of agents as a way to tackle a really hard problem. Complexity is not the litmus test for an agent, however. If the steps are knowable before seeing the input, then you have a workflow, not an agent. A workflow is much easier to build, execute, and debug than an agent.

Here's how I actually think through it.

## The one question that does most of the work

> Can I draw the exact steps and their order before seeing the input?

If yes: it's a workflow. Pick the simplest workflow shape that fits.
If no: it might need an agent. But not yet — there are cheaper stops first.

This seems obvious, but I've seen teams fall into the "multi agent" trap for customer support tickets, when a 3-way routing would handle 95% of the volume at 1/10th the cost and complexity. The task was not open-ended, but it wasn't obvious until we started diagramming.

## The cost-of-failure lens

When choosing an architecture, I'm going to do one more reality check: what is the cost of getting wrong answers?

Irreplaceable work, a regulatory requirement, or something that can't be undone - these are reasons to prefer a controlled process over an agent. A workflow with checkpoints and human review is safer ground if an error in thinking leads to catastrophic consequences.

On the other hand, if mistakes are easily undone or have little downside, I'm much more tolerant of "wrong" output from an agent.

In short: agents' ability to go off-road is much less valuable when wrong steps lead to irreversible outcomes. A workflow failure at a specific step has predictable consequences - bad results at step 3 were caused by some kind of error in step 2, and you can see how step 3's output was produced. An agent can produce invalid output in any number of ways: loops, tangents, hallucinations, or just running out of thinking budget before returning a result that doesn't account for all relevant information. Wrong answers from an agent have more varied consequences, and when those consequences are expensive to repair, I'll favor a workflow with clearer stopping points.

## The climb, in order

I think of LLM systems as a ladder. The rule: go up one rung only when the rung below provably can't do the job.

```
Tier 0:  No LLM           — structured input, deterministic rules, sub-10ms latency
Tier 1:  Augmented LLM    — single-turn Q&A, doc summarization, RAG
Tier 2:  Workflows        — prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer
Tier 3:  Single agent     — open-ended task, unknown path, exploration
Tier 4:  Multi-agent      — 2+ distinct expertise domains, parallel exploration, context overflow
```

Most tasks fall in Tier 1 or Tier 2. Supporting an FAQ line with grounded responses is T1. Same with the translation pipeline, which has a T2 prompt chain plus a parallel fan out for the per language substeps. Code reviews across multiple dimensions are T2 parallelized (security, performance, style) rather than one big multi-layered prompt each time.

The use case for agents is where the path is not apparent at design time: research, debugging, open ended coding. It's a capability that's needed when there isn't anything lower tier that can handle the task.

## Consider the multi-agent question specifically

Multi-agent is where I think people make most expensive mistakes.

A 2026 paper (arxiv 2604.02460) finds that, when controlling for total compute (i.e., number of tokens allocated to thinking), single agents perform as good or better than multi-agent systems on multi-hop reasoning tasks across three model families and five mas architectures. The reason most benchmarks find MAS useful is precisely because they are allocated more total compute. Controlling for that variable, it disappears.

The practical implication is that multi-agent is often primarily a way to distribute compute rather than a capability improvement; it has costs associated with context management at the supervisor level and emergent behaviors that can be exceptionally difficult to reverse engineer.

My personal rule of thumb for using multi-agent at all is if one of more of the following is true:

1. The task requires multiple genuinely distinct areas of expertise (law + finance + compliance, etc.) rather than just "is complicated"
2. The task requires genuine parallelization of distinct lines of thought
3. The task requires more context than fits in a single model's context window (or can be summarized/transposed via context editing)

MAS is often substantially more expensive (in tokens) than using a single model. The number is ballpark 10–15x but could be higher depending on the task. This is primarily because of the agent loop; the overhead of repeatedly querying the model adds up quadratically to the number of hops. A 20 step agent loop (not uncommon) has a 50x overhead vs a single model query once you start including the cost of history in each response.

Whatever you're trying to accomplish with MAS, first ask yourself: can a single model do it with skills? Because it almost certainly can.

## The thing nobody says about observability

It is no secret that observability is critical for the functioning of large-scale LLMs. What is less apparent is that it is no longer optional beyond tier 1.

The type of generic request latency, error rate, and uptime metrics one usually gets from conventional application performance monitoring solutions offer limited insight into the root causes of issues in an LLM-based system. In order to effectively troubleshoot and optimize such a system, one would need to collect:

- All prompts provided and responses generated by the system
- Which branches, tools, or agents were called for a particular prompt and why

- What information was retrieved for a given response
- The token usage per call and per turn

Non-deterministic behavior is a common source of silent failures. A hallucinating agent will not self-correct, even if it strays miles away from the intended task, and a retrieval step that returns irrelevant documents will not throw an error. Routing classifiers, too, are not perfect, and if a support ticket gets routed down the wrong agent chain, it may be challenging to detect until an audit. These examples highlight the importance of observability in LLMs - without it, debugging becomes guesswork.

I've observed companies choose to forgo investing in observability in order to accelerate product development. This can lead to weeks of debugging a productionized tier 2 agent system before identifying a systemic issue in the agent's decision-making logic. A properly instrumented tier 2 agent would substantially outperform a non-observable tier 3 agent in most cases, as the value of the tier 2 agent's responses would be immediately apparent.

## Where I land

The default position for anything that promises to be complex by nature should be scepticism and seeking for simplest practical alternative. Agents are powerful, but they are also costly, risky, and have poor feedback loops. It’s not a question of if my task is complex enough to warrant an agent, but whether the simplest possible viable solution has been exhausted.

The mnemonic that I find helpful here is No LLM -> (Augmented) -> (Chain) -> Route -> (Parallel) -> Orchestrate -> Evaluate -> Agent -> Multi-agent. Each higher step is only attempted if the lower one has provably failed; and the choice should be written down with reasons for all dismissed options.

The second point I want to make is that the decision is best formalised and made visible somewhere. It is not typical to later revisit the justification for choosing a single orchestrator-worker combination over an entire agent due to some emergent properties of the subtask decomposition, and even less common to reverse the decision. By writing the reasoning down you get to keep track of the tradeoffs against the emergent properties of the chosen architecture, which may not be obvious at the time of designing the system, but will become apparent later.

The third point is that I want to think through my own uncertainties. Where exactly does the line between single-agent and multi-agent solutions lie in terms of task horizon and degree of subtask autonomy, given roughly equal computational budget? I think that we are beginning to see the theory that informs such choices, but I do not think that the practical guidance is mature enough yet.

Thank you so much for reading this. If you interested, please reach out to me at my [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/tbmkunn_/)