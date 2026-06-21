---
title: "I thought it was a tool bug; it was the model driving the tool"
date: 2026-06-20
draft: false
tags: ["ai-agents", "debugging", "cline", "llm"]
summary: "A stray `nul` file kept appearing on a user's Desktop. The reported cause was a command in the tool's code. That command didn't exist anywhere in the codebase."
---

A [cline](https://github.com/cline/cline) user filed a bug: on Windows with Git Bash, a junk file named `nul` kept appearing on their Desktop whenever cline scanned their `.clinerules`. The issue came with a root-cause analysis, prefaced "My AI tells:" — cline runs a `dir /a /b ... > nul` command, Git Bash misparses it, and you get the stray file. Clean symptom, plausible mechanism, an actual file you could see appear. I picked it up as a code bug: find where that command is built, fix the command.

I grepped the whole repository for `dir /a /b`. It wasn't there. Not in the file-scanning code, not in shell detection, not anywhere.

That absence is the entire story. The bug everyone was looking at wasn't in the tool. It was in what the *model* told the tool to do.

## Looking for a command that wasn't there

The reported mechanism gave me a concrete thing to find: a `dir`-style command constructed somewhere and run through the shell. So I traced the directory-scanning path — `cline-rules.ts`, `rule-helpers.ts`, `skills.ts`, `list-files.ts`.

Every one of them scans the filesystem with `globby`, `ripgrep`, or `fs/promises`. None of them shells out. None of them constructs a `dir` command. cline's file scanning never runs a shell command at all.

I widened to the whole monorepo — shell detection, terminal integration, the CLI, anything Windows-specific that might build a `dir` string or a `> nul` redirect. Nothing. The literal command from the bug report does not exist in cline's source code.

At that point I had two options, and they point in opposite directions. Either keep grepping on the assumption the command is hiding somewhere I haven't looked, or accept the absence as evidence and ask a different question: if the tool never builds this command, where is it coming from?

## The symptom was real; the attribution was wrong

The `nul` file is real. The errors in it — `dir: cannot access '/a': No such file or directory` — are real. Those are genuine artifacts. What was wrong was the attribution.

Read the error text closely. `dir: cannot access '/a'` is what GNU coreutils prints — the real `/usr/bin/dir`, the sibling of `ls` — when you hand it `/a` and `/b` as paths. That only happens if someone runs a *Windows* command, `dir /a /b`, inside a *POSIX* shell, where `dir` resolves to the GNU tool and the cmd.exe flags `/a /b` get read as directories. And `> nul`: Git Bash has no `NUL` device, so instead of discarding output it creates a literal file called `nul` in the current directory — which was the Desktop, so that's where it landed.

So the command was real, it just wasn't cline's. It was a command the language model generated — DeepSeek, in this case — emitting Windows `cmd.exe` syntax. cline did exactly what an agent tool is supposed to do: it took the model's command and ran it in the user's configured terminal. The terminal was Git Bash. The bad syntax met the wrong shell and dropped a file on the Desktop.

The reporter saw cline produce the file and concluded cline's code produced the command. From the outside those are indistinguishable — the file appears while the tool is running, so the tool looks responsible. They're completely different bugs.

## The check that decided it

There was still one way the tool could be at fault: maybe cline never told the model which shell it was driving. If the agent runs a model command in Git Bash without telling the model it's Git Bash, the cmd syntax is arguably the tool's fault for withholding context.

So I checked what cline puts in the system prompt. It reports the shell:

```
Default Shell: {{shell}}
```

populated from `getShell()`, which correctly returned the Git Bash path on the reporter's machine. The model *was* told the active shell was Git Bash. It emitted `dir /a /b > nul` anyway.

That closed it. The tool reports the shell correctly and runs what it's given. The model ignored the context it was handed and produced the wrong dialect. This is a model-behavior problem, not a defect in cline's code — and there is no line of cline code you can change to "fix" the command, because no such command exists to fix.

## Why the distinction changes the fix, not just the blame

This isn't about assigning fault for its own sake. Where the failure lives determines what a fix even *is*.

If it were a tool bug, the fix is a code change: correct the command construction, ship a PR, done. Because it's a model-behavior bug, the only available intervention is system-prompt hardening — making the shell guidance forceful enough that models stop emitting cmd syntax in POSIX shells ("the shell is Git Bash; use POSIX syntax; never `dir`, `> nul`, or backslash paths"). That's a completely different change: it touches the prompt, not the scanner; its effect is probabilistic, not deterministic; and it's genuinely uncertain whether maintainers would even accept it, because they might reasonably call it the model's problem, not theirs.

A fix aimed at the reported cause — patching the nonexistent `dir` command — would have changed nothing and "resolved" the bug without touching what produced it. The whole value of localizing the failure correctly was learning that the fix surface I'd assumed didn't exist.

So I didn't ship a code fix. I wrote up the root cause as a comment on the issue — model-generated cmd syntax, the tool already reports the shell, here's the actual mechanism — and put my actual PR on a clean, unambiguous docs fix instead. The diagnosis was the contribution; the wrong-shaped patch would have been noise.

## What I'd tell someone debugging an agent

When an AI tool does something wrong, the symptom can't tell you whether the *tool* is broken or the *model drove it wrong*. A file appears, a command errors, an API gets called with garbage — all of it looks identical from the outside whether the bug is in the orchestration code or in the tokens the model produced. The two have completely different fixes and you can waste a lot of time fixing the wrong layer.

The move that separates them: trace where the offending input is *constructed*. If you can find the code that builds the bad command, it's a tool bug. If you trace it all the way back and the code never builds it — if the bad string only exists at runtime, handed in from the model — then the tool is innocent and the model is the author. Absence of the command in the source isn't a dead end in that search. It's the answer.

What I'm still chewing on: this debugging move depends on the boundary between "tool code" and "model output" being clean enough to trace across, and in cline it was — the command was either in the source or it wasn't. But as agent frameworks add layers that rewrite, validate, or repair model output before executing it, that boundary gets muddier, and "the model said it" versus "the framework mangled it" could become as hard to separate as "tool" versus "model" was here. I don't have a good technique yet for localizing a failure that happens *inside* the rewriting layer between the model and the shell.
