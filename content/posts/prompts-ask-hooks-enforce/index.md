---
title: "your CLAUDE.md asks nicely; hooks make it true"
date: 2026-06-21
draft: false
tags: ["claude-code", "hooks", "ai-tooling", "agent-design"]
summary: "An instruction in a markdown file is followed most of the time. When 'most of the time' isn't good enough, the rule belongs in code that runs before the tool does."
---

I had a line in my global instructions that said never push to `main`. Claude followed it. Then one session, reasoning through a confusing git state, it proposed a `git push origin main` to "fix" a branch mismatch. It had read the rule. It decided this was the exception.

That's the thing nobody tells you about the instructions file: it's a strong prior, not a constraint. The model reads `CLAUDE.md` every turn and follows it the overwhelming majority of the time. But "overwhelming majority" is a probability, and some rules can't live on a probability. A push to `main`, a refund over the limit, a write to a production database — the cost of the 1% is not 1% of the cost.

So I split my agent config along exactly that line. Rules where probabilistic compliance is fine stay in the markdown. Rules where I need a guarantee moved into hooks — scripts the harness runs *before* the tool executes, outside the model's reasoning. The model can't argue with them because it never gets the chance.

## What the two layers actually are

A `CLAUDE.md` rule is text the model reads and weighs against everything else in context. A hook is a `PreToolUse` (or `PostToolUse`, `Stop`, `SessionStart`…) script that the harness invokes around a tool call. It returns `deny`, and the call never happens. No reasoning, no exception, no "this case is different."

Here's the same rule — don't edit on a protected branch — as a hook rather than a sentence:

```powershell
# PreToolUse on Edit|Write|MultiEdit
$file = $input_json.tool_input.file_path
$branch = git -C (Split-Path -Parent $file) rev-parse --abbrev-ref HEAD 2>$null

if (@('main', 'master') -contains $branch) {
    # return permissionDecision = "deny"
}
```

The difference from a `CLAUDE.md` line that says "don't edit on main" is total. The text version is advice the model usually takes. This version is a wall. The model proposes the edit, the harness runs the script, the script says no, and the edit doesn't land. It is not possible to talk the script out of it.

That's the whole value, and also the whole cost. A hook can't use judgement. It will block the edit even in a case where editing on `main` was genuinely fine. You're trading flexibility for certainty, and you only want that trade where certainty is worth more.

## The line I draw

My rough rule for which layer a rule goes in:

**Markdown (`CLAUDE.md` / path-scoped rules)** — preferences and conventions where being right 95% of the time is fine and the failures are cheap to fix: naming conventions, "explain technical terms," "no nested ternaries," "ask before structural changes." If the model occasionally misjudges one, I catch it in review and nothing is on fire.

**Hooks** — anything where a single violation is expensive or irreversible: pushing to `main`, deleting with `rm -rf`, reading a `.env` or an SSH key, editing files on a protected branch. Also anything I want to *happen* unconditionally regardless of whether the model remembers to do it.

That last category is the half people forget. Hooks aren't only for blocking — `PostToolUse` is where I do work the model shouldn't have to remember. After every file edit, a hook runs the formatter and type-checker:

```powershell
# PostToolUse on Edit|Write|MultiEdit — runs unconditionally
if ($file -match '\.py$') {
    ruff format $file
    ruff check $file --fix
    pyright $file
}
```

I could put "run ruff after editing Python" in `CLAUDE.md`. It would mostly work. But "mostly formats the code" is a strictly worse outcome than "always formats the code," and there's no judgement involved in running a formatter — so there's no reason to leave it to the model's attention budget. Deterministic work belongs in deterministic code.

The same logic covers blocking dangerous shell commands. I have a `PreToolUse` hook on `Bash` that hard-denies a small list of patterns — `rm -rf`, `sudo`, `git push --force`, `chmod 777` — and also a handful of prompt-injection strings like `ignore previous instructions` and `you are now`. None of that is left to the model noticing the command is dangerous. The check runs before the command does.

## The hook that exists because a hook didn't fire

The case that taught me the most was a hook I wanted that the harness wouldn't reliably give me.

I run Claude Code in the desktop app. There's a `SessionEnd` event, and the obvious place to snapshot the git state at the end of a session is a `SessionEnd` hook. Except `SessionEnd` doesn't reliably fire when you close the desktop window — an ungraceful close skips it. The one moment I most wanted a guarantee was the one moment the lifecycle event wasn't guaranteed.

So I moved the snapshot to the `Stop` hook, which fires at the end of every *turn*, and throttled it so it only does real work once every five minutes:

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

Now even if the window dies ungracefully, the last turn's git state is already on disk from the most recent throttled snapshot. The insight that generalizes: a hook is only a guarantee if the *event* it's attached to is a guarantee. `PreToolUse` fires before the tool, every time — solid. `Stop` fires every turn — solid. `SessionEnd` on a GUI app — not solid. Pick the event that actually fires, not the one whose name reads best.

## The one cost I didn't anticipate

Hooks run silently, and a deterministic guardrail you can't see is its own small problem. When a `PreToolUse` hook denies a call, I need to *know* it denied it and why — otherwise the agent just appears to stall, or worse, quietly routes around the block and I never learn the rule fired.

So every hook in my setup announces itself. Blocks return a loud `systemMessage` (`🛑 [PreToolUse] branch-guard BLOCKED Edit on protected branch 'main'`), and my instructions tell Claude to surface that line in chat rather than swallow it. The guarantee and the visibility have to ship together. A guardrail you can't observe is indistinguishable from a bug — the agent does something unexpected and you can't tell whether a rule fired or the model just misbehaved.

What I'm still unsure about: where the line sits for rules that are *mostly* deterministic but have rare legitimate exceptions. "Don't add a new dependency without asking" is too important for a plain `CLAUDE.md` line, but a hard hook-level block would be wrong too — sometimes adding the dependency is the right call and I'd just be fighting my own wall. The honest answer is probably a hook that returns `ask` instead of `deny` — a forced prompt rather than a forced stop — but I haven't worked out which of my markdown rules deserve to be promoted to that middle tier and which are fine staying as advice.
