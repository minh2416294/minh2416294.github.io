---
title: "the agentic loop is not the hard part"
date: 2026-04-05
draft: false
tags: ["agents", "llm-architecture", "ai-engineering", "system-design"]
summary: "stop_reason is six lines of code. The real engineering in agentic systems is protecting what goes into the model's context window."
---

Every tutorial about building agents focuses on the loop. Check `stop_reason`. If `tool_use`, execute the tool, append the result, continue. If `end_turn`, extract the text and return. Here it is in full:

```python
def run_agent(client, user_prompt: str) -> str:
    messages = [{"role": "user", "content": user_prompt}]

    for _ in range(MAX_ITERATIONS):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            messages.append(build_tool_result_message(response))
            continue

        if response.stop_reason == "end_turn":
            return extract_text(response)

    return "Error: exceeded iteration cap."
```

That's the loop. It's not the hard part.

The hard part is everything you put into `messages`. Every pattern in agentic systems — hooks, hub-and-spoke orchestration, programmatic enforcement, session forking — is ultimately a different answer to the same question: how do you keep the context window clean enough for the model to reason correctly?

## The four anti-patterns that kill loops from the inside

Before getting to the advanced patterns, the basics: four ways teams break loops that have nothing to do with architecture.

**Checking natural language for completion.** If the agent says "I'm done," that's not a termination signal. It's text. The agent can say "I'm done" and then emit a `tool_use` block in the same response. `stop_reason` is the only reliable signal. It's deterministic and unambiguous. Nothing else is.

**Using an iteration cap as a termination strategy.** A cap is an emergency brake for bugs, not a way to end normal work. If your agent routinely hits the cap, the loop has a bug. The correct fix is finding and fixing the bug, not raising the cap.

**Forcing `tool_choice: any`.** This prevents `stop_reason == "end_turn"` from ever being reached. The loop runs forever. Don't do it.

**Checking `response.content[0].type == "text"` to detect completion.** Claude can return a text block alongside a `tool_use` block in the same response. This check is wrong in the general case.

These are not subtle. They're listed here because I've seen all four in production codebases from engineers who understood the architecture but hadn't read the API contract carefully.

## The real problem: context quality degrades over turns

The loop is stateless. Every call to `client.messages.create()` sends the full conversation history. The model reads the entire transcript fresh and responds to it. This means context grows linearly with turns — and model performance degrades as context accumulates noise.

This isn't a model limitation you can patch with a better prompt. It's structural. A 2026 analysis found that doubling task time roughly quadruples failure rate, with a nonlinear degradation curve. Performance drops aren't uniform across context position either — information in the middle of a long context performs worst, regardless of relevance.

The practical consequence: every architectural decision in agentic systems is a context management decision in disguise. Multi-agent decomposition, hooks, session forking — they're all ways to keep the signal-to-noise ratio in the context window high enough for the model to perform.

## Hooks are context surgery, not just guardrails

The standard framing for hooks is safety: use `PreToolUse` to block bad actions before they happen, `PostToolUse` to normalize outputs after. That's correct but incomplete.

`PostToolUse` hooks are also the right place to control what tool results look like before the model sees them. Tool output verbosity is the proximate cause of most attention dilution. A tool that returns 2,000 tokens of JSON when 50 tokens of structured summary would do is burning context budget on noise the model has to sift through every subsequent turn.

```python
# Without a PostToolUse hook: raw tool result enters context
{
  "customer_id": "C-48291",
  "name": "Alice Chen",
  "account_status": "active",
  "created_at": "2019-03-14T09:22:11Z",
  "last_login": "2024-11-02T14:37:55Z",
  "orders": [...],  # 200 lines of order history
  "preferences": {...},  # 80 lines of settings
  "support_tickets": [...]  # 150 lines of prior tickets
}

# With a PostToolUse hook: normalized signal enters context
customer_id: C-48291 | status: active | open_tickets: 2 | last_order: 2024-10-28
```

The hook is normalizing data format — but the real effect is protecting downstream attention. Every turn after this one, the model is reasoning from 20 tokens instead of 600. That compounds.

The `PreToolUse` hook matters for a different reason: programmatic enforcement of ordering constraints. The standard framing is financial safety — block `process_refund` until `verify_identity` has run. But the mechanism is general: a prerequisite gate is any check that physically prevents a tool from executing until a prior condition is satisfied. It's not a prompt instruction the model might skip. It's code that runs before the tool call, unconditionally.

```python
def pre_tool_use_hook(tool_name: str, tool_input: dict, session_state: dict) -> dict | None:
    if tool_name == "process_refund":
        if not session_state.get("identity_verified"):
            return {
                "error": "Cannot process refund — customer identity not verified. "
                         "Call verify_identity first."
            }
    return None  # allow the call
```

The model receives an error and routes itself to the prerequisite. It cannot bypass this by rephrasing the request or deciding verification is unnecessary. This matters for financial, security, and compliance operations where a single failure is a real cost. Enhanced system prompt instructions improve compliance probabilistically — 95% of the time, maybe more. They don't provide 100% guarantees. When the cost of the 5% failure is a compliance violation or a financial loss, use the hook.

## Hub-and-spoke: why subagents exist

A subagent is a context firewall. Its internal work — tool calls, intermediate reasoning, dead ends — stays inside it. The coordinator's context grows only by the subagent's final summary.

This is the whole reason to use multi-agent architecture. Not specialization (a single agent with the right tools can handle most tasks). Not parallelism (useful but secondary). The primary value is isolation: a coordinator that delegates to three subagents has a context window that accumulates three summaries, not three full transcuries of tool calls and reasoning traces.

```python
def run_subagent(client, kind: str, subtopic: str, research_goal: str, prior_results: str = "") -> str:
    # Fresh messages list — complete isolation from coordinator context
    messages = [{"role": "user", "content": SUBAGENT_TASK_TEMPLATE.format(
        research_goal=research_goal,
        subtopic=subtopic,
        prior_results=prior_results or "(none)",
    )}]

    for _ in range(MAX_ITERATIONS):
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SUBAGENT_SYSTEM[kind],  # Narrow system prompt, not the coordinator's
            tools=TOOLS,
            messages=messages,
        )
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})
            messages.append(build_tool_result_message(response))
            continue
        return extract_text(response)
```

Two things that are easy to get wrong here:

Subagents do not inherit the coordinator's context. They start with only what the coordinator explicitly passes in their prompt. Prior results, research goals, constraints — if it's not in the prompt, the subagent doesn't know it. Each invocation is independent. No state carries over between calls to the same subagent.

When multi-agent output is incomplete, the root cause is almost always the coordinator's decomposition, not the subagent's execution. A subagent can only research what it's assigned. If the coordinator decomposes "renewable energy" into solar and wind and nothing else, the subagents will produce thorough coverage of solar and wind. Geothermal, tidal, biomass, and fusion will be absent — not because subagents failed, but because the coordinator never assigned them.

The fix is constraining the decomposition prompt, not improving the subagents:

```python
DECOMPOSITION_PROMPT = """Decompose the research topic into subtopics.

Topic: "{topic}"

Requirements:
- Produce AT LEAST 6 distinct, non-overlapping subtopics.
- Cover the FULL breadth, including emerging and less-common categories.

Respond with ONLY JSON: {{"subtopics": ["subtopic one", ...]}}"""
```

## Session management is context quality across time

The three session options — resume, fork, fresh start — are not UX preferences. They're context quality decisions.

`--resume` continues a session. The full history is restored. Use it when prior context is still valid and files haven't changed. Do not use it after significant file modifications: stale tool results from old file contents remain in history, and the model can still reference them even if you ask it to re-read the changed files. The stale context is in the transcript and the model reads the full transcript each turn.

`fork_session` creates an independent branch from a shared baseline. Changes in one branch don't affect the other. Use it when you want to compare two approaches from the same starting point — two refactoring strategies, two architectural directions. Do not use it to handle stale context: the fork inherits the session's history, including stale tool results.

Fresh start with summary injection is the right answer when context has degraded: files changed, long session with accumulated noise, dependencies updated. Start a new session, inject a structured summary of prior findings, specify which files changed, and ask the agent to re-analyse only those. The summary covers what's stable; the targeted re-analysis covers what changed.

```
Prior analysis: three authentication issues found in auth.ts, session.ts, middleware.ts.
All three have been fixed. Please re-analyse these three files to verify the fixes
and check for new issues introduced by the changes. Prior findings for all other
files remain valid and do not need re-analysis.
```

This is not just a session management pattern. It's the same principle as the subagent context firewall applied across time: only put into the context window what the model actually needs to reason correctly in this turn.

## The pattern underneath all the patterns

Hooks control what tool results look like before the model sees them. Subagents contain the noise of their own work so it doesn't contaminate the coordinator's context. Programmatic enforcement removes the model from decisions where its reasoning might introduce variance. Session forking lets you explore an alternative without polluting the main session's history. Fresh starts with summaries let you discard accumulated noise while preserving validated findings.

All of these are context quality interventions. The loop is the easy part. What you put in it is the work.

What I'm still unsure about: whether observation masking — selectively hiding tool results from the model's context while preserving them for logging — is the right primitive here, or whether it introduces a new class of failure where the model reasons from a context that doesn't match what actually happened. The technique improves solve rates and cuts cost in benchmarks. I haven't seen a good failure taxonomy for where it breaks.
