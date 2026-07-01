---
title: "2 bugs in my agent guardrails"
date: 2026-06-10
draft: false
tags: ["claude-code", "hooks", "ai-tooling", "developer-tooling"]
summary: "A guardrail that blocked the workflow it was meant to protect, and a permission rule that was silently dead. Both were bugs in my own config."
---

I have a rule that Claude can't edit files on my computer while I'm on `main`. It's enforced by a hook, not a prompt: a powershell script that runs on every Edit/Write command, checks the branch, and denies the operation if it's protected. The intention was to enforce working in feature branches via git worktrees, which is the only git discipline I care to follow.

It prevented me from working in a worktree. The guardrail denied the very workflow it was designed to enforce.

This incident, along with another one I'll describe later, is what made me stop thinking about my agent config as "rules I've written", and start thinking about it as "software that may have bugs". Guardrails are code. Code is prone to errors. My guardrails had two notable ones.

## The branch-guard that blocked feature branches

Here's the hook. It's wired to `PreToolUse` on `Edit|Write|MultiEdit`:

```powershell
$file = $input_json.tool_input.file_path
$branch = git rev-parse --abbrev-ref HEAD 2>$null   # the bug

$protected = @('main', 'master')
if ($protected -contains $branch) {
    # return permissionDecision = "deny"
}
```

Read where `git rev-parse` runs. It is run in the current directory of the session. I always start my code sessions from the main project directory because starting from a worktree subdirectory caused the harness to reask for permissions for tools it would have automatically inherited otherwise. The session cwd is main

When I create a worktree on a branch and ask Claude to write a file into that worktree, the hook does not look at the worktree. It runs git rev-parse in the session cwd and rejects the write because that resolves to main . The file the user is trying to write is on feat/whatever; the hook has no awareness of that.

The guard's understanding of what branch it is on is the ambient process state. What the guard is actually guarding is a file. Those are two different things once you start using worktrees, which is exactly the scenario this guard was supposed to protect against.

The fix is obvious: resolve the branch from the file being written to rather than the session cwd.

```powershell
# before — reads the branch of the session's CWD
$branch = git rev-parse --abbrev-ref HEAD 2>$null

# after — reads the branch of the file being edited
$branch = git -C (Split-Path -Parent $file) rev-parse --abbrev-ref HEAD 2>$null
```

`git -C <dir>` runs the command as if you were in that directory. Now a write into a worktree on a feature branch resolves to that feature branch (and passes), while a write into the main-rooted tree resolves to main (and still blocks). The guard finally guards the file, and not the process.

The lesson is cheap to state and easy to make a mistake with: where-ever a guardrail thinks it is must be the same as the unit of control it is trying to guard. The hook guards file edits, and so it must evaluate the branch of the file being edited, and not the branch of the shell. I had written "block edits on main" and then assumed that the CWD and the file's branch were the same thing. Worktrees are the case where they are not.

## The permission rule that was never reached

The second bug was a silent failure. The permission rule was written, but had no effect.

My `settings.json` defines three permission categories: deny (never run), ask (prompt me), and allow (run silently). For a while I had in-directory file mutations (mv, sed -i) fall into ask, meaning that I would be prompted before Claude made any in-place changes. Seems sensible.

What actually happened is that I was never prompted. The in-directory file writes always ran.

I found the bug while writing a 25-case permission self-test, a script that runs through a representative sample of commands and builds a report of which were denied, prompted, or run. 21/25 worked as intended. The four that failed were all in-directory writes I'd put in ask - they were all running silently as if they were in allow.

The cause is obvious in hindsight: the permission rules are evaluated in the order of the allow/deny blocks in the code, not the order that I had placed them in my `settings.json`

```
PreToolUse hook → deny → mode → sandbox → ask → allow
```

I run with the sandbox on (`enabled: true, autoAllowBashIfSandboxed: true`) and `filesystem.allowWrite` includes "." - the current directory. So any command that only writes inside the project directory is auto-allowed by the sandbox gate. Sandbox comes before ask in the pipeline; by the time execution would reach my ask rule, the sandbox had already allowed the command and made the decision. The ask entry was dead config, a guardrail that no longer guarded anything.

It's worse than useless, really - at least, worse than not having the rule at all - because the absence of a rule is honest. A dead rule is like a tripwire that wasn't hooked to anything.

The real trade-off came between keeping the sandbox on, but accepting that all the commands I wanted to allow were silently auto-allowed, or turning off `autoAllowBashIfSandboxed` to restore my guardrail. I chose to keep the sandbox, but the containment it provided was still a better guarantee - those commands physically can't write anywhere outside the project directory, sandbox or no sandbox, because of the separate `PreToolUse` hook that runs at the front of the pipeline, before any of the prompt-based rules. Turning them off would've been a silent allow-all for every read-only command, which is most of the commands I use the sandbox for anyway. (Not a deal breaker, but not an improvement either.)

So I deleted the dead `ask` entries rather than trying to un-break the sandbox. Reinstalling them would've been ineffective - they'd be running after the sandbox and would only ever trigger on commands that the sandbox didn't already allow. The only way to add in-directory safety checks is to write a `PreToolUse` hook that returns ask, because hooks run at the front of the pipeline - the fix for "my rule is at the wrong level" is always to move it to the right level, not to shout harder.

## What both bugs have in common

Both times, I made the same class of error: I wrote a rule that acted as if it was in a certain place in the system, but it wasn't. The branch-guard assumed its environment (the CWD) was always going to be in a particular place relative to the file it was trying to modify, but that wasn't always the case. The ask rules thought they'd be run on every relevant command, but they were overridden and dead. In both cases, I had correct English sentences - "don't edit on main branch", "ask before mv" - that weren't correct code because I hadn't taken into account all the places the rule had to be true.

What made the second bug easier to spot than the first was a test. The branch-guard was discovered the slow way - by stumbling onto it while using the tool. The dead permission rules were found because I'd written a self-test that walked through the permission matrix, checking that all the intent rules were actually installed. The self-test is the thing I'm advocating for here; when I started working on this, guardrails were features, not separately-security-audited things. I think a lot of people make this same class of error when writing prompt-based rules because they can't easily observe all the different execution paths that apply to a rule.

The thing I'm worrying about is that now I have six phases in my permission pipeline plus eight hooks and six path-scoped rule files, and I can barely keep track of the evaluation order anymore. The next step isn't necessarily more clever rules - it may just be to make that 25-case self-test a thing I commit along with the config, the way I would never write an application without also writing tests for it.