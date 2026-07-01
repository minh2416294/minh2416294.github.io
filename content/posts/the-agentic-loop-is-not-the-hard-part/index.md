---
title: "Protecting what enter your model's context window"
date: 2026-04-05
draft: false
tags: ["agents", "llm-architecture", "ai-engineering", "system-design"]
summary: "stop_reason is six lines of code. The real engineering in agentic systems is protecting what goes into the model's context window."
---

A note on the code examples: All the code examples below are written in Python. We will use python for our agent implementation, but please remember that all programming languages are viable options!
Every tutorial on writing agents talks about the loop - check if `stop_reason` is `tool_use`, call the tool, add the result, repeat. If the `stop_reason` is `end_turn`, we need to get the text. Here's the full code:

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

The hard problem is everything you put into `messages`. Every pattern in agentic systems, from hooks to hub-and-spoke orchestration to programmatic enforcement to session forking, is some kind of answer to the question of how to keep the context window from becoming an unmanageable swamp that the model can't reason about.

## The four anti-patterns that kill loops from the inside

Before diving into advanced patterns, some words about common ways to shoot yourself in the foot. Here are four anti-patterns that come from the outside, not from the architecture itself.

**Checking natural language for completion.** If the agent says "I'm done," that's not a termination signal. It's text. The agent can say "I'm done" and then emit a `tool_use` block in the same response. `stop_reason` is the only reliable signal. It's deterministic and unambiguous. Nothing else is.

**Using an iteration cap as a termination strategy.** A cap is an emergency brake for bugs, not a way to end normal work. If your agent routinely hits the cap, the loop has a bug. The correct fix is finding and fixing the bug, not raising the cap.

**Forcing `tool_choice: any`.** This prevents `stop_reason == "end_turn"` from ever being reached. The loop runs forever. Don't do it.

**Checking `response.content[0].type == "text"` to detect completion.** Claude can return a text block alongside a `tool_use` block in the same response. This check is wrong in the general case.

These anti-patterns are not subtle. They appear because I've seen them in production code written by engineers who knew what they were doing, but didn't read the fine print

## The real problem: context quality degrades over turns

The loop is stateless. Each call to `client.messages.create()` transmits the entire context for the model to process. As your threads grow longer, the context that needs to be processed grows linearly. This will always hurt model performance, because its ability to reason on long contexts is bounded and fragile.

This is a fundamental limitation of the system, not an implementation detail that can be worked around by "improving the prompt." A 2026 study found that for each task, model performance degrades by approximately 4x with each doubling of the time needed to perform the task, and this degradation is uneven depending on where information falls in the context. This makes no sense from the model's perspective - it has no awareness of ordering or priority. But it has a huge impact on real world performance.

What this means is that every architectural choice in your agentic systems is ultimately a tradeoff of context budget. The use of multi-agent decomposition, hooks, and sessions are each ways of improving performance by ensuring that as much relevant information as possible falls within the context window while minimizing distracting information.

## Hooks are context surgery, not just guardrails

The standard framing for how to use hooks incorrectly focuses on safety. Yes, you can use `PreToolUse` to prevent the model from performing forbidden actions. Same goes for `PostTooluse`, for modifying the results of tools. But this misses the primary value of `PostToolUse` hooks.

`PostToolUse` hooks are the preferred way to alter the context before the model uses the information. Tool output verbosity is the single largest reason why context budget matters. A tool that outputs 2000 tokens of JSON when 50 tokens of properly formatted summary would suffice is needlessly wasting budget on information that will need to be filtered out by the model on every turn.

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

The hook is normalizing the data format, which is a way of preserving downstream attention budget. Every step subsequent to this one uses 20 tokens instead of 600, which is a significant saving.

The `PreToolUse` hook has another purpose, which is programmatic enforcement of ordering constraints: the canonical example is financial safety checks, where `process\_refund` cannot be called before `verify\_identity` has run. But the same idea applies to any prerequisite check that physically blocks the execution of a tool until some condition is met.

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

The model receives an error and directs itself toward the prerequisite. It cannot circumvent this by phrasing the request differently or deciding that verification is unnecessary. This is vital in financial, security, or compliance operations where one wrong step can result in tangible losses. Tighter instructions for the system prompt improve the chances of passing a compliance check by a probabilistic value close to 1. Or 95% perhaps. But they rarely offer an absolute guarantee. If the value of the 5% is unacceptable in the context of a compliance breach or a financial loss, use the hook.

## Hub-and-spoke: why subagents exist

A subagent serves as a context firewall. Any internal work (tool-calls, intermediate reasoning steps, dead ends) are performed internally and hidden behind a summary of their results for the coordinator’s context. 

This is the whole point of a multi-agent system - not specialization (a single agent is also capable of handling most tasks), and not parallelism (the subagents work sequentially), but isolation: a coordinator that delegates three subtasks to three different agents will have in its context three summaries, not the entire transcribed dialogues and reasoning steps of each agent.

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

Two common pitfalls to avoid here:

Subagents don’t have access to the same context as the coordinator. Whatever research they do, whatever goals they’re pursuing, whatever constraints they’re operating under - it has to come explicitly in their prompt. Anything that the coordinator knows but doesn’t specify to the subagent, the subagent can’t know about. Every call to a subagent is an isolated interaction with no memory of previous calls.

If the subagents are doing an incomplete job, the culprit is almost certainly the coordinator’s decomposition, not the subagents’ research. A subagent can only do the research the coordinator asks it to do. If the decomposed task mentions only solar and wind energy, the subagents will necessarily give an answer that doesn’t mention geothermal, tidal, biomass, or nuclear fusion. The solution isn’t to “train” the subagents to think more creatively; it’s to constrain the decomposition prompt so that it specifies the exact information the coordinator wants.

The solution is constraining the decomposition prompt, not training the subagents:

```python
DECOMPOSITION_PROMPT = """Decompose the research topic into subtopics.

Topic: "{topic}"

Requirements:
- Produce AT LEAST 6 distinct, non-overlapping subtopics.
- Cover the FULL breadth, including emerging and less-common categories.

Respond with ONLY JSON: {{"subtopics": ["subtopic one", ...]}}"""
```

## Session management is context quality across time

The three session options below are not about UX preference, they're about context quality across time - managing the evolution of session context and keeping it relevant to the current state of the files under analysis.

- `--resume` resumes a session. The history is preserved as is. It should be used when resuming work on files that were not significantly modified since the last session. Do not use it if the files were substantially changed since the last session, as unchanged tool outputs from the prior session will be retained in context, potentially providing false positives if the model was asked to re-analyze the changed files. The model would read the entire transcript including the stale tool outputs.
- `fork_session` allows forking a session into a different branch. Each branch has its independent context. It should be used to explore different options based on some common starting point, such as different ways to refactor the same code or structure the same system. It should not be used to address the issue of stale context, as a branch will have the same context as the parent session, including stale tool outputs.
- A fresh start with summary injection is appropriate when context becomes stale, which happens when files are changed substantially, or the session simply grew too long and accumulated too much noise. To address this scenario, a fresh session should be started with a summary of findings from the previous session, highlighting what files were modified, and requesting re-analysis of those files.

```
Prior analysis: three authentication issues found in auth.ts, session.ts, middleware.ts.
All three have been fixed. Please re-analyse these three files to verify the fixes
and check for new issues introduced by the changes. Prior findings for all other
files remain valid and do not need re-analysis.
```

This is not merely a session management technique, but a general pattern akin to the subagent context firewall but applied across time: whatever you put in the context for the purposes of reasoning must be strictly necessary for the current step.

## The pattern underneath all the patterns

Hooks control what tool results appear as as input to the model before it thinks. Subagents hide the messiness of their own work from the coordinator so it doesn't appear in context. Similarly, programmatic enforcement takes decisions out of the model's hands entirely if its reasoning could introduce variance. Session forking lets you explore an alternate universe without polluting the original with unrelated detritus. And fresh starts with summaries lets you forget everything but the lessons learned so far.

These are all techniques for improving context quality. The actual work is the easy part. What matters is what you put in the loop.

The thing I'm least sure about is whether observation masking - showing the model some results but not others while still recording them for the log - is the right primitive or if it creates a whole new set of errors where the model is making decisions based on information that isn't actually there. The technique definitely improves solve rates and reduces costs on these benchmarks, but I'm not sure anyone has characterized the failure modes it can introduce.