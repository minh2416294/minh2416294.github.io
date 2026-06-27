---
title: "two bugs in my own Claude Code guardrails"
date: 2026-06-10
draft: true
tags: ["claude-code", "hooks", "ai-tooling", "developer-tooling"]
summary: "A guardrail that blocked the workflow it was meant to protect, and a permission rule that was silently dead. Both were bugs in my own config."
---

I have a rule that Claude can't edit files while I'm on `main`. It's enforced by a hook, not a prompt — a PowerShell script that runs before every `Edit` and `Write`, checks the branch, and returns a `deny` if the branch is protected. The point is to force all work onto feature branches in git worktrees, which is the one git discipline I actually care about.

It blocked me from working in a worktree. The guardrail punished the exact workflow it existed to enforce.

That bug, and a second one I found later, are the reason I stopped thinking of my agent config as "rules I wrote" and started thinking of it as "code that can be wrong." Guardrails are code. Code has bugs. Mine had two worth writing down.

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

Read where `git rev-parse` runs. It runs in the session's current directory. I start every Claude Code session from the main project directory — that's deliberate, because starting inside a worktree subdirectory makes the harness re-ask for tool permissions it would otherwise inherit. So the session CWD sits on `main`.

When I create a worktree on a feature branch and ask Claude to write a file *into that worktree*, the hook doesn't look at the worktree. It runs `git rev-parse` in the session CWD, reads `main`, and denies the write. The file being edited was on `feat/whatever`. The hook never looked at the file.

The guard's model of "what branch am I on" was the ambient process state. The thing it was actually guarding was a file. Those two are different the moment you use worktrees — which was the entire workflow it was supposed to protect.

The fix is one line: resolve the branch from the directory of the file being written, not from the session.

```powershell
# before — reads the branch of the session's CWD
$branch = git rev-parse --abbrev-ref HEAD 2>$null

# after — reads the branch of the file being edited
$branch = git -C (Split-Path -Parent $file) rev-parse --abbrev-ref HEAD 2>$null
```

`git -C <dir>` runs the command as if from that directory. Now a write into a worktree on a feature branch resolves to that feature branch and passes. A write into the main-rooted tree still resolves to `main` and still blocks. The guard finally guards the file instead of the process.

The lesson is cheap to state and easy to get wrong: a guardrail's notion of *where it is* has to match the unit it actually controls. The hook controls file edits, so it has to ask about the file's branch, not the shell's branch. I'd written "block edits on main" and quietly assumed CWD and the file's branch were the same thing. Worktrees are precisely the case where they aren't.

## The permission rule that was never reached

The second bug didn't block anything. It was the opposite failure — a rule that looked like protection and did nothing.

My `settings.json` has three permission buckets: `deny` (never run), `ask` (prompt me), and `allow` (run silently). For a while I had in-directory file mutations like `mv` and `sed -i` in the `ask` bucket. I wanted a prompt before Claude moved or rewrote files in place. Reasonable.

They never prompted. They just ran.

I only found out because I sat down and wrote a 25-case permission self-test — a script that fires representative commands and records whether each was denied, prompted, or run silently. 21 of 25 behaved as written. The 4 that didn't were all the same shape: in-directory writes I'd put in `ask` were running silently.

The cause is evaluation order. The permission gates don't fire in the order I listed them in the file — they fire in a fixed pipeline:

```
PreToolUse hook → deny → mode → sandbox → ask → allow
```

I run with the sandbox on (`enabled: true`, `autoAllowBashIfSandboxed: true`) and `filesystem.allowWrite` includes `"."` — the current directory. So any command that only writes inside the project directory is auto-allowed by the **sandbox** gate. The sandbox sits *before* `ask` in the pipeline. By the time evaluation would have reached my `ask` rule, the sandbox had already approved the command and the decision was made. The `ask` entry was dead config. It read like a guardrail and was a no-op.

This is worse than having no rule, because no rule is honest about offering no protection. A dead rule looks like a tripwire that isn't connected to anything.

The tradeoff was the interesting part. Two options: keep the sandbox and accept the silence, or turn off `autoAllowBashIfSandboxed` to make `ask` reachable again. I kept the sandbox. The containment is the stronger guarantee — those commands physically can't write outside the project directory regardless of what the prompt rules say — and `rm -rf` is still hard-blocked by a separate `PreToolUse` hook that runs at the very front of the pipeline, ahead of the sandbox. Restoring the prompt would have cost me silent auto-approval on every read-only command too, which is most of what makes the sandbox worth running.

So I deleted the dead `ask` entries instead of trying to resurrect them. Re-adding them wouldn't have worked — they'd still be downstream of the sandbox. The only way to force a prompt on a sandboxed in-dir command is a `PreToolUse` hook that returns `ask`, because hooks run at gate one, before everything. The fix for "my rule is at the wrong layer" is to move it to the right layer, not to write it more emphatically.

## What both bugs have in common

Both are the same mistake wearing different clothes. The branch-guard assumed its environment (CWD) matched the thing it controlled (a file). The `ask` rules assumed they'd be reached at all. In both cases I'd written something that was *correct as English* — "don't edit on main," "ask before `mv`" — and wrong as code, because I hadn't checked where it actually sat in the system that runs it.

The thing that caught the second bug and not the first was a test. The branch-guard I found the slow way, by hitting it during real work. The dead permission rules I found because I'd written a self-test that exercised the whole permission matrix and diffed intent against behavior. The self-test is the part I'd recommend to anyone running a non-trivial agent harness: guardrails deserve the same adversarial testing as features, because "it's in my config" and "it fires" are not the same claim.

What I'm still chewing on: my permission pipeline now has six stages, plus eight hooks and six path-scoped rule files, and I'm not sure I can hold the whole evaluation order in my head anymore. The honest fix might not be smarter individual rules — it might be making that 25-case self-test a committed artifact I re-run whenever I touch the config, the way I'd never ship application code without tests but somehow shipped a permission model on vibes for months.
