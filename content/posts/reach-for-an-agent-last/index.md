---
title: "reach for an agent last, not first"
date: 2026-03-21
draft: true
tags: ["llm-architecture", "agents", "system-design", "ai-engineering"]
summary: "A decision framework for picking LLM architecture by asking what failure costs first — and why agents are the right answer less often than you think."
---

The first question I ask when someone shows me their agent architecture isn't "does it work?" It's "what happens when it doesn't?"

That question changes the decision almost every time.

Most teams reach for agents because the task feels complex. Complexity is the wrong signal. The right signal is whether the steps are knowable before you see the input. If they are, you don't have an agent problem. You have a workflow problem — and workflows are cheaper, faster, and debuggable in ways agents simply aren't.

Here's how I actually think through it.

## The one question that does most of the work

> Can I draw the exact steps and their order before seeing the input?

If yes: it's a workflow. Pick the simplest workflow shape that fits.
If no: it might need an agent. But not yet — there are cheaper stops first.

This sounds obvious. It isn't. I've seen teams reach for multi-agent systems to handle customer support tickets, when a routing workflow with three branches would have served 95% of the volume at a tenth of the cost. The task felt open-ended. It wasn't.

## The cost-of-failure lens

Before picking any architecture, I run one more check: what does wrong output actually cost?

- Financial loss, compliance breach, irreversible action → bias toward control. Workflows, hooks, human sign-off. Not agents.
- Wrong output is cheap and recoverable → more flexibility is affordable.

This matters because agents fail in open-ended ways. A workflow fails at a known point — step 2 produced garbage, so step 3 is also garbage, and you can trace it. An agent can loop, drift from the goal, hallucinate tool arguments, or exhaust its context window without a clean failure signal. When failure is expensive, that unpredictability is a liability you're paying for whether you know it or not.

## The climb, in order

I think of LLM systems as a ladder. The rule: go up one rung only when the rung below provably can't do the job.

```
Tier 0:  No LLM           — structured input, deterministic rules, sub-10ms latency
Tier 1:  Augmented LLM    — single-turn Q&A, doc summarization, RAG
Tier 2:  Workflows        — prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer
Tier 3:  Single agent     — open-ended task, unknown path, exploration
Tier 4:  Multi-agent      — 2+ distinct expertise domains, parallel exploration, context overflow
```

Most tasks land on Tier 1 or Tier 2. Support FAQ with grounded answers? Tier 1. Translation pipeline across 30 languages? Tier 2 prompt chain with a parallel fan-out for the per-language step. Code review across multiple dimensions? Tier 2 parallelization — separate calls for security, performance, and style beats one diffuse call every time.

Agents enter when the path is genuinely unknown until runtime: research, debugging, open-ended coding. Not because they're powerful. Because nothing below them can handle it.

## The multi-agent question specifically

Multi-agent is where I see the most expensive mistakes.

A 2026 paper (arXiv 2604.02460) found that when you control for total compute — same number of thinking tokens — single agents match or beat multi-agent systems on multi-hop reasoning across three model families and five MAS architectures. The reason most benchmarks show MAS winning is that they give MAS more total compute. Control for that, and the gap shrinks or inverts.

The practical implication: multi-agent isn't a capability upgrade. It's a distribution of compute. And distributing compute has coordination overhead — context management at the supervisor, inter-agent communication, emergent behavior that's hard to reproduce and harder to debug.

I reach for multi-agent only when I can answer yes to at least one of:
1. The task spans 2+ genuinely distinct expertise domains (legal + financial + compliance, not just "it's complex").
2. The task requires parallel exploration of truly independent directions simultaneously.
3. The task exceeds a single agent's context window in a way that can't be solved by summarization or context editing.

The cost is real: multi-agent systems use roughly 10–15× more tokens than a single agent on equivalent tasks. That's not a folk heuristic — it follows from quadratic token accumulation across the agent loop. A 20-step agent loop can cost 50× more than a single-pass baseline once you account for history being re-sent on every call.

Before justifying that cost, I ask whether single agent + skills would do the job. Usually it would.

## The thing nobody says about observability

Everyone agrees observability matters for LLM systems. What's underappreciated is that it's not optional at any tier above Tier 1.

Standard application monitoring — request latency, error rates, uptime — tells you almost nothing about why an LLM system failed. You need:
- Every prompt sent and every response received
- Which branch, tool, or agent was chosen and why
- What was retrieved for each generation
- Token consumption per call and per turn

Non-deterministic systems fail silently. An agent that drifts from the goal doesn't throw an exception. A retrieval step that returns irrelevant docs doesn't 500. A routing classifier that misclassifies 8% of tickets looks like a working system until someone audits the output. You can only catch these things if you're tracing them.

I've seen teams skip observability infrastructure to ship faster, then spend weeks debugging a multi-agent system that "works most of the time." A well-observed Tier 2 workflow beats an unobserved Tier 3 agent almost every time — not because it's smarter, but because you can see what it's doing.

## Where I land

The default should be skepticism toward complexity, not excitement about it. Agents are powerful. They're also expensive, unpredictable, and hard to debug when things go wrong. The question isn't whether your task is complex. It's whether the simplest thing that could work has been genuinely ruled out.

The mnemonic I use: *No LLM → Augmented → Chain → Route → Parallel → Orchestrate → Evaluate → Agent → Multi-agent.* Go up only when the step below provably fails. Write down what you picked and why you rejected the others.

That last part matters. Decisions made under deadline pressure and excitement about a new pattern rarely get revisited. Writing down "I picked orchestrator-workers over a single agent because the subtasks emerge from the input and I need auditable planning steps" forces the tradeoff to be explicit — and gives you something to check against when the system behaves unexpectedly six months later.

What I'm still unsure about: where exactly the crossover point is between single agent and multi-agent, in terms of task horizon and subtask independence, when compute budgets are held equal. The research is starting to formalize this, but the practitioner guidance isn't there yet.
