---
title: "your agent has no ground truth about itself"
date: 2026-06-21
draft: true
tags: ["agents", "observability", "ai-engineering", "reliability"]
summary: "Context degradation, silent failure, and miscalibrated escalation look like three separate problems. They're all the same instrumentation gap."
---

Three hours into a long-running coding agent session, the agent's behavior changed. Tool calls that had been precise started missing edge cases. Context it had explicitly gathered earlier stopped showing up in its reasoning. It didn't crash. It didn't error. It just quietly got worse, and there was no signal in the logs that anything had happened.

This is the instrumentation gap: agents generate plenty of logs, but almost none of them measure the things that matter — context quality, reasoning coherence, escalation calibration, and the fidelity of what survives a compaction event. Without those measurements, you have an agent that is either working or broken, with nothing in between observable.

## The calibration cascade nobody does the math on

Multi-step agents compound errors silently. If a single step has 75% accuracy — a reasonable estimate for moderately complex reasoning tasks — a three-step pipeline has 0.75³ = 42% system reliability. A five-step pipeline: 0.75⁵ = 24%.

```python
def system_reliability(per_step_accuracy: float, steps: int) -> float:
    return per_step_accuracy ** steps

# What most people assume they have:
system_reliability(0.95, 5)   # → 0.77

# What they may actually have:
system_reliability(0.75, 5)   # → 0.24
```

The math isn't the insight. The insight is that nobody runs it at design time. Per-step accuracy is treated as "good enough" for each step in isolation, without computing the product. A 5-step research agent where each step is solid feels robust. At 75% per step, one in four runs produces a wrong answer — and the wrong answer looks like a right answer, because the agent completed normally.

The right design question before building a multi-step agent: what per-step accuracy does this task need, and what does that imply about step count? If you need 85% system reliability, two steps at 92% per-step gets you there. The same two-step design at 80% per-step gives you 64%.

## What `/compact` actually destroys

In a long codebase exploration session, a model builds a dense mental model: which files call which, where the state lives, what the constraints are on the data layer. That model takes 30–45 minutes to develop and sits in 80,000 tokens of context.

`/compact` summarizes that to roughly 2,000 tokens. What survives is the skeleton — file names, high-level relationships, the main findings. What's destroyed is the texture: the specific edge case in `auth.ts` line 247, the implicit constraint that two modules can't both hold session state, the reason a particular approach was ruled out three hours ago.

The agent doesn't know what was lost. It continues from the summary as if it still has the full model. When a task touches something that was in the lost texture, the agent makes a plausible-looking error — it has enough context to attempt the task but not enough to do it correctly. The failure is invisible in the output.

The fix isn't avoiding compaction — long sessions require it. The fix is treating compaction as a precision event: before it runs, write a state manifest to a scratchpad file.

```python
# Write this before compaction, update as work progresses
state_manifest = """
## Active investigation
Task: Refactor auth middleware to support OAuth alongside session tokens.

## Confirmed facts (do not re-derive)
- Session tokens stored in Redis, 24h TTL, key pattern: session:{user_id}:{nonce}
- auth.ts:247 has a known race condition on concurrent refresh — do not touch
- middleware.ts imports from auth.ts but NOT from session.ts directly
- The `is_admin` flag comes from the user record, not the token

## Ruled-out approaches
- JWT: rejected because existing mobile clients don't support it (established in first pass)
- Dual-auth flag: creates state machine complexity the team explicitly didn't want

## Current position
Halfway through updating middleware.ts. auth.ts refactor complete and tested.
session.ts not yet modified.
"""
```

After compaction, the agent loads this file first. It has the texture back — the specific line number, the ruled-out approaches, the current position. What's in the scratchpad file is accurate because a human-readable tool write it explicitly; what was in the compressed context was a lossy summary generated without knowing what would matter later.

## Silent failure is a monitoring design problem

A 2026 paper on LLM agent failure modes frames silent failure as structurally inevitable — an entropy principle, not a bug to fix. Failures accumulate gradually before manifesting as visible errors. By the time the output looks wrong, several intermediate steps have already degraded.

This means detection has to happen before the terminal failure. The events worth logging aren't just tool calls and responses — they're the signals that predict degradation:

```python
import json
from datetime import datetime

class AgentObservabilityLogger:
    def __init__(self):
        self.log = []

    def record_turn(
        self,
        turn: int,
        tool_calls: int,
        context_tokens: int,
        tool_result_tokens: int,
        reasoning_references_prior_facts: bool,
        confidence: float | None,
    ):
        self.log.append({
            "turn": turn,
            "ts": datetime.utcnow().isoformat(),
            "context_tokens": context_tokens,
            "tool_calls_this_turn": tool_calls,
            "tool_result_tokens": tool_result_tokens,
            "prior_fact_reference": reasoning_references_prior_facts,
            "confidence": confidence,
        })

    def degradation_signal(self) -> str | None:
        if len(self.log) < 3:
            return None
        recent = self.log[-3:]
        # Flag if context grew >40% in 3 turns with no compaction
        token_growth = recent[-1]["context_tokens"] / recent[0]["context_tokens"]
        if token_growth > 1.4:
            return f"context grew {token_growth:.1f}x in 3 turns — approaching noise floor"
        # Flag if tool result tokens dominate context growth
        result_fraction = recent[-1]["tool_result_tokens"] / recent[-1]["context_tokens"]
        if result_fraction > 0.6:
            return f"tool results are {result_fraction:.0%} of context — trim or summarize"
        return None
```

None of these metrics exist in default agent frameworks. They require adding instrumentation before you run the agent, because you can't reconstruct them from after-the-fact output logs.

The timing matters as much as the content. Tool result verbosity is cumulative — a tool that returns 600 tokens when 20 would do burns 580 tokens of attention budget on noise. But the damage isn't just on the turn it happens. Every subsequent turn, the model re-reads those 600 tokens. A PostToolUse hook that normalizes verbose tool output to a structured summary is a compounding investment:

```python
# Without normalization: 600 tokens enter context, re-read every subsequent turn
raw_tool_result = {
    "customer_id": "C-48291",
    "name": "Alice Chen",
    "account_status": "active",
    "created_at": "2019-03-14T09:22:11Z",
    # ... 200 lines of order history, 80 lines of preferences, 150 lines of tickets
}

# With PostToolUse normalization: 20 tokens, same signal
normalized = "customer_id: C-48291 | status: active | open_tickets: 2 | last_order: 2024-10-28"
```

The 580-token difference per call compounds across every turn after it.

## Escalation over-gating is a reliability failure

The standard advice on human-in-the-loop escalation is to escalate when confidence is low. The failure mode this creates isn't under-escalation — it's over-escalation, which degrades reliability in a way that's harder to see.

When an agent escalates too frequently, the humans reviewing it start rubber-stamping approvals. They're seeing 40 requests per hour, each one saying "I'm not sure about this, can you confirm?" The cognitive load is too high to evaluate carefully. They approve to clear the queue. The escalation gate, designed as a safety check, has become a false safety signal — humans are in the loop, but they're not actually reviewing.

The fix is treating escalation calibration as an engineering problem, not a UX problem:

```python
def escalation_decision(
    action_category: str,   # "read" | "write" | "financial" | "external_api"
    confidence: float,
    prior_escalation_rate: float,  # fraction of recent actions escalated
    human_approval_latency_p50: float,  # seconds
) -> str:
    # If humans are approving >80% of escalations in under 5 seconds,
    # they're rubber-stamping — escalation threshold is too low.
    if prior_escalation_rate > 0.8 and human_approval_latency_p50 < 5:
        return "threshold_too_low"

    risk_floor = {"read": 0.3, "write": 0.6, "financial": 0.85, "external_api": 0.7}
    threshold = risk_floor.get(action_category, 0.7)

    if confidence < threshold:
        return "escalate"
    return "proceed"
```

The `prior_escalation_rate` and `human_approval_latency_p50` fields aren't in the action itself — they require logging prior escalations and computing them. Without that measurement, you can't tell the difference between a well-calibrated gate and a rubber-stamp queue.

The EU AI Act Article 14 requirement that humans maintain "meaningful oversight" is not satisfied by a gate that humans approve reflexively. Meaningful oversight requires that humans can actually evaluate what they're approving, which requires that escalations are rare enough to be worth evaluating.

## The instrumentation checklist

Before shipping a long-running agent, these are the events worth logging — not for debugging after failure, but for detecting degradation before it manifests:

| Event | What to log | Why it matters |
|---|---|---|
| Every turn | `context_tokens`, `tool_calls`, `tool_result_tokens` | Detects noise accumulation before attention degrades |
| Compaction | What was in context before, what's in summary after | Makes compaction fidelity loss visible |
| State manifest write | File path, token count, key facts written | Verifies scratchpad covers what was lost |
| Every escalation | Action, confidence, human decision, time-to-decision | Enables calibration math; detects rubber-stamping |
| Tool errors | Category (`transient`, `validation`, `business`, `permission`), retry outcome | Distinguishes fixable from unfixable failures |
| Session end | Total turns, peak context, compaction events, escalation rate | Session-level reliability summary |

None of this is exotic. All of it requires deciding to instrument before you run, which is the part nobody does.

What I'm still unsure about: whether compaction fidelity loss is uniform across topic types or whether certain categories of information — implicit constraints, ruled-out approaches, specific line numbers — are systematically more likely to be lost than others. If the loss is systematic, a scratchpad template could be designed to capture exactly the categories that don't survive. I haven't found empirical data on this — the closest I've seen is the Git Context Controller paper's observation that branching context like git lets you preserve and merge agent state, which implies they saw lossy merges as a real problem worth solving architecturally.
