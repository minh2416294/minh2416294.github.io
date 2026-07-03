---
title: "Auditing Agent Self-Truth"
images: ["share.png"]
date: 2026-06-07
draft: false
tags: ["agents", "observability", "ai-engineering", "reliability"]
summary: "Context degradation, silent failure, and miscalibrated escalation look like three separate problems. They're all the same instrumentation gap."
---

Three hours into one particularly lengthy coding agent run, I noticed the agent was behaving strangely. Tool calls made by the agent began to become less sophisticated; certain previously-captured context the agent had explicitly noted wasn't being used in the thinking process. The agent continued to perform its task, but it was no longer doing so as effectively as before. Yet not a single log entry suggested something had gone wrong.

That's the instrumentation gap. The agent was producing a wealth of logs, but none of them captured the truly interesting behaviors. Contextual information, reasoning, proper escalation, and the fidelity of information surviving a compaction event were all left out, resulting in an agent that could only be considered as "working" or "broken", with nothing in between.

## The calibration cascade you should know

Multi-step agents compound errors silently. For example, if each step has a 75% chance of succeeding (a reasonable estimate for moderately difficult reasoning tasks), a three-step pipeline has 75%^3 = 42% system reliability. A five-step pipeline would have 75%^5 = 24%.

```python
def system_reliability(per_step_accuracy: float, steps: int) -> float:
    return per_step_accuracy ** steps

# What most people assume they have:
system_reliability(0.95, 5)   # → 0.77

# What they may actually have:
system_reliability(0.75, 5)   # → 0.24
```

The math isn't the insight. The insight is that the design isn't run by anyone at design time. Per step accuracy is assumed to be "good enough" for each individual step, without considering the impact on the product of the whole. A five step research agent, with each step accurately performed, is a safe agent. A five step research agent, with seventy five percent accuracy per step, has a twenty four percent chance of giving a wrong answer, and that wrong answer will seem just as correct as the right one, since the agent will have followed through on all steps.

The right question to ask in determining an agent's design is "What per step accuracy is needed to get my desired system accuracy, given the number of steps I've chosen?" "If you need 85% system reliability, then two steps of 92% are better, while two steps of 80% give you 64%."

## What `/compact` actually destroys

A typical longish codebase exploration session ends with the model generating a mental image of the code structure: what files call what, where the state is, what are the constraints, and so on. This takes 30-45 minutes to form and ends up taking 80,000 tokens to represent in the model’s mind.

`/compact` shrinks that to 2,000 tokens. But what gets thrown away in the process? The edges, primarily. Particulars. Implementation details. That edge case in `auth.ts`:247 that was never formally documented but was the reason why the session state couldn’t be shared between two auth modules. The reason why the model tried to implement the session storage in Redis three hours ago and then abandoned the idea in favor of something else.

The model is unaware of those details and, crucially, of the loss: when asked to perform any task that requires those discarded details, it will make up plausible-sounding but incorrect statements: give the appearance of competence while being unaware of its limitations. Said task will fail, often in ways that are hard to diagnose.

The solution, obviously, is not to avoid the `/compact` step. A three-hour exploration session followed by a 30-minute `/compact` inevitably loses some information. The solution is to make sure that the information loss is tracked and acknowledged by the model: prior to running the `/compact` command, generate a ‘state manifest’ in a separate scratchpad file that documents what is being thrown away.

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

After being compacted, the agent loads this file first. It contains the texture, but with the particular line number, ruled out approaches, and current position. What’s on the scratchpad file is accurate since a human-readable agent wrote it explicitly; what was in the compressed context was a lossy summary, not written with knowledge of what would be relevant later down the line.

## Silent failure is a monitoring design problem

A paper from 2026 on LLM agent failure modes actually suggests that silent failure is a given - an inevitable consequence of the system's operation, akin to entropy. The paper suggests that failures are gradual - often happening long before the final output is reached. This renders the monitoring process non-trivial, as the events worth logging are not the final output, but rather the intermediate results that point to an impending failure.

The paper actually suggests that the only way to avoid silent failure is to have monitoring in place that can detect these intermediate failures and intervene before the final output is reached.

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

None of these metrics are available in default agent frameworks. They require a instrumentation pass before you can run the agent, because you can’t extract them from a post-hoc log of the execution.

Consider the turn budget. It’s easy to forget that the passage of each turn includes a re-reading of everything that has been said before and the result of prior tool uses. A tool returning 600 tokens when it should return 20 not only wastes the 580 unnecessary tokens on the current turn, but also all future turns will have to read and process them. A PostToolUse hook that transforms verbose tool responses into a consistent summary is a cumulative investment of time:

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

Standard advice for escalation design with human-in-the-loop systems is to escalate when unsure. The error mode for that approach is not underescalation but overescalation resulting in reduced reliability in an insidious way.

People who review escalated items are likely to rubber stamp them as approved due to high volume. The reasoning is that if every request for approval contains "I'm not sure about this", and there are 40 such requests per hour, then the approvals cannot be processed with the required care and attention and get rubber stamped. The true safety check is not happening as humans are "in the loop" but not actually reviewing the requests.

How to resolve this issue? The solution is to treat escalation calibration as an engineering problem, not a UX problem

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

The "prior_escalation_rate" and "human_approval_latency_p50" fields are not inherent properties of an action, but rather represent information that would need to be logged and calculated from past instances of escalation. If the measurement of these fields is not made, it becomes impossible to distinguish between a gate that actually provides meaningful oversight and a rubber stamp queue.

The requirement in EU AI Act Article 14 that humans performing oversight retain "meaningful oversight" would not be provided by a gate in which the humans involved are likely to approve requests reflexively. Meaningful oversight requires the ability for humans to evaluate the request being escalated to them, requiring escalation rates to be low enough to justify such evaluation.

## The instrumentation checklist

Before shipping a long-running agent, these are the events worth logging - not for debugging after failure, but for detecting degradation before it manifests:

| Event | What to log | Why it matters |
|---|---|---|
| Every turn | `context_tokens`, `tool_calls`, `tool_result_tokens` | Detects noise accumulation before attention degrades |
| Compaction | What was in context before, what's in summary after | Makes compaction fidelity loss visible |
| State manifest write | File path, token count, key facts written | Verifies scratchpad covers what was lost |
| Every escalation | Action, confidence, human decision, time-to-decision | Enables calibration math; detects rubber-stamping |
| Tool errors | Category (`transient`, `validation`, `business`, `permission`), retry outcome | Distinguishes fixable from unfixable failures |
| Session end | Total turns, peak context, compaction events, escalation rate | Session-level reliability summary |

None of this is particularly exotic. It all comes down to making the decision to instrument before you ship, which none of us do.

What I'm still uncertain about is whether fidelity loss during compaction is topic-independent or are there certain classes information which are more susceptible to loss than others (implicit constraints, ruled out approaches, specific line numbers). If the latter is true, perhaps we can come up with a scratchpad template which captures exactly the topics not captured by the compaction. It's unknown to me, but the closest thing I could find is in the git context controller paper, where they state that with git, you can track your branching context and merge agent state, which suggests that they have a reason to believe that naive merges are not compositional.

Thank you so much for reading this. If you interested, please reach out to me at my [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/tbmkunn_/)