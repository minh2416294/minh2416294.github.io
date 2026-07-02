---
title: "Using Hooks as Deterministic Guardrail"
date: 2026-06-21
draft: false
tags: ["claude-code", "hooks", "ai-tooling", "agent-design"]
summary: "A rule stated in the markdown is typically followed, but when it's not, that rule belongs in code that runs before the tool itself."
---

I had a line in my global instructions saying that Claude should never push to `main `. Claude obeyed. Then, during some reasoning about a situation involving a problematic git history, it suggested a `git push origin main` to "fix" a branch mismatch. It had read the instructions and concluded correctly that this situation was an exception.

The thing about the instructions file is that it serves as a strong prior for the model, rather than a strict set of constraints. The model processes and applies the CLAUDE. MD file on every interaction and generally follows it to the letter, with one or two caveats. However, "mostly" is not a reliable foundation for an absolute rule, so any instructions that have an element of risk in their enforcement are better stated elsewhere.

I split my agent config between the markdown file and actual hooks, with the latter being executed by the harness before any tool execution. This way, the model cannot second-guess them and try to "get around" them since it has not processed them.

## What the two layers actually are

A `CLAUDE.md` rule is text the model reads and weights against everything else in context. A hook is a `PreToolUse` (or `PostToolUse`, `Stop`, `SessionStart`…) script the harness runs around a tool call; it returns `deny`, and the call never happens. No reasoning, no exception, no "this case is different."

Here's the same rule — don't edit on a protected branch — as a hook rather than a sentence:

```powershell
# PreToolUse on Edit|Write|MultiEdit
$file = $input_json.tool_input.file_path
$branch = git -C (Split-Path -Parent $file) rev-parse --abbrev-ref HEAD 2>$null

if (@('main', 'master') -contains $branch) {
    # return permissionDecision = "deny"
}
```

The difference from a line in a `CLAUDE.md` saying "don't edit on main" is critical. The textual version is something the model is typically trained to obey. This version is a wall; the model suggests the edit, the harness executes the script, the script refuses, and the edit doesn't happen. It is not possible to convince the script otherwise.

This is the price you pay, and the value you gain. A hook can't make judgements. It will refuse the edit even in situations where editing on `main` would have been acceptable. You are trading flexibility for certainty, and you should only do that when certainty has value.

## The line I draw

My rough rule for which layer a rule goes in:

**Markdown** ( CLAUDE.md / path-scoped rules) - preferences and conventions that are generally right 95% of the time and benign if wrong: naming conventions, “explain technical terms”, “no nested ternaries”, “ask before doing destructive things”. If the model misses one, I catch it in review and nothing burns down.

**Hooks** - anything that is catastrophically wrong if done even once: pushing to `main`, `rm -rf`, reading `.env` or ssh keys, making edits on protected branches. Also, anything that needs to be done no matter what the model says.

That last one is the important one people miss. Hooks aren’t just about not-doing-things - they’re about doing-things the model may forget. Every time a file is edited, a PostToolUse hook runs to make sure they’re formatted and type-checked:

```powershell
# PostToolUse on Edit|Write|MultiEdit — runs unconditionally
if ($file -match '\.py$') {
    ruff format $file
    ruff check $file --fix
    pyright $file
}
```

I could put "run ruff after editing Python" in `CLAUDE.md`. It would mostly work. But "mostly formats the code" is a strictly worse outcome than "always formats the code", and there's no judgement involved in running a formatter, so there's no reason to leave it to the model's attention budget. Deterministic work gets put in deterministic code.

Same goes for the shell injection stuff; I've got a `PreToolUse` hook on `Bash` that hard-denies a short list of patterns - `rm -rf`, `sudo`, `git push --force`, `chmod 777`, etc etc - and a few prompt injection strings like `ignore previous instructions` and `you are now`. The model isn't getting to decide whether `rm -rf` is a dangerous command or not; it's being blocked before it can be run.

## The hook that exists because a hook didn't fire

The case that taught me the most was a hook I wanted but the harness couldn't reliably deliver.

I run Claude Code in the desktop app and there's a `SessionEnd` event. The obvious place to snapshot the git state at the end of a session is the `SessionEnd` hook, but `SessionEnd` isn't reliably called when you close the desktop window (it's an ungraceful close). At the very moment I needed it most, the lifecycle event wasn't there. So I moved to a Stop hook, which fires at the end of every turn, and I throttled it so it only did the actual work once every five minutes. So I moved the snapshot to the `Stop` hook, which fires at the end of every *turn*, and throttled it so it only does real work once every five minutes:

```powershell
# Stop hook — fires every turn, throttled to once / 5 min.
# SessionEnd is unreliable on window-close, so snapshot here instead.
if ($due) {
    $status = git status --short
    $snapshot = @("Last turn state — $stamp", "Branch: $branch",
                  "Uncommitted files: $dirtyCount") + $status
    Set-Content -Path $stateFile -Value $snapshot   # overwrite, never grows
}
```

Now even if the window dies ungraciously, the last turn's git state is already on disk from the most recent throttled snapshot. The insight that generalizes: a hook is only a guarantee if the event it's attached to is a guarantee. Now, `PreToolUse` is always called before the tool, every time. `Stop` is called every turn. But `SessionEnd` on a GUI app isn't guaranteed to be called at all. Pick the event that actually happens, not the one whose name sounds most appealing.

## The one cost I didn't anticipate

Hooks are silent, and a deterministic guardrail not announced is a problem of its own. When a PreToolUse hook denies a call, I need to know that it denied it and why, lest the agent act like it never happened or worse, bend around the rule without me knowing that it was even there.

That's why all my hooks loudly declare themselves. Blocks emit a systemMessage (🛑 [PreToolUse] branch-guard BLOCKED Edit on protected branch 'main') and the instruction set tells Claude to report those lines in chat, rather than ignore them. The ability to observe the system is critical to the hook's utility - a guardrail unseen is no different from a bug, the agent does something unexpected, and there is no way to distinguish between the two.

What I'm not sure about is calibration - the art of writing rules that are mostly deterministic but occasionally allow exceptions. "Don't add a new dependency without asking" is too important to leave as markdown, but a hard-coded hook would wrongly penalize those times I actually do want to add a new dependency. The answer is probably a third category of instruction, one that asks rather than blocks, but I'm not certain what guardrails should promptfully ask the user for forgiveness.

Thank you so much for reading this. If you interested, please reach out to me at my [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/Maleficent_Train1207/)