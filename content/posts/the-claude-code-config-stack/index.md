---
title: "Exploring Claude Code Configuration Stack"
date: 2026-04-20
draft: false
tags: ["claude-code", "developer-tooling", "ai-engineering", "ci-cd"]
summary: "CLAUDE.md, path rules, skills, hooks, and headless CI each have their own post. Nobody writes about how they compose or what happens when the stack drifts."
---

Six month after setting up Claude Code, the configuration of Claude Code is already inconsistent. The CLAUDE.md is at 400 lines long and few knows what is up to date or not. The skills directory has 3 commands that no one uses. The path-scoped rules refers to pattern files that got reorganized in Q1. And the CI job runs claude -p and sometimes finds the same issue as last week or none at all.

The problem isn't any individual layer. It's that each layer was set up in isolation, and nothing enforces that they stay coherent.

Here's how the layers fit together and how to keep them from rotting.

## The four-layer stack

Each level has different capabilities, performance characteristics, and failure modes. Incorrect use of levels leads to subtle, hard-to-track-down failures in programs.

```
Layer 1: CLAUDE.md           — always-loaded, universal standards
Layer 2: Path-scoped rules   — loaded only when editing matching files
Layer 3: Skills              — on-demand, invoked by model or developer
Layer 4: Headless CI mode    — non-interactive, machine-readable output
```

**Layer 1 - CLAUDE.md** is loaded for all sessions, regardless of the current task. This is where universal conventions are established. It defines how to name files, handle errors, write tests, and what architectural decisions will be made. It doesn’t contain instructions for specific tasks - that’s what skills are for - and conventions for specific file types - that’s the job of path layer.

The three-level hierarchy matters for team environments:

- `~/.claude/CLAUDE.md` — user-level, personal, not version-controlled, not shared via git
- `.claude/CLAUDE.md` or root `CLAUDE.md` — project-level, shared with everyone who clones the repo
- Subdirectory `CLAUDE.md` — directory-level, overrides project-level in that subtree only

The failure mode that I've encountered most frequently with teams is when a new developer clones the repository and finds that Claude Code doesn't work as expected. The issue is usually that the instructions are in `~/.claude/CLAUDE.md` rather than `.claude/CLAUDE.md`. The user-level configuration is not tracked in any repository and therefore no new developer setups Claude Code. Bring team-wide standards into the project.

When `CLAUDE.md` grows unwieldy, split it with `@import`:

```markdown
# .claude/CLAUDE.md
@.claude/rules/testing.md
@.claude/rules/api-conventions.md
@.claude/rules/deployment.md
```

Each imported file is a source of truth. Each updated once, and it reflects everywhere. Without @import you are either stuck with one 400 line file or have repeated rules across files in different directories - both of which are worse.

**Layer 2 — Path-scoped rules** in `.claude/rules/` are loaded conditionally based on which files you're editing. This is the right layer for conventions that apply to a file type spread across many directories.

```markdown
---
paths: ["**/*.test.tsx", "**/*.spec.ts"]
---
# Test conventions

- Use the factory pattern from test/factories/ for all test data creation
- Integration tests connect via test/setup/db.ts — never mock the database
- Test public API contracts, not private implementation details
- Coverage target: 80% branch coverage for new code
```

The glob pattern `**/*.test.tsx` matches every test file in the codebase regardless of directory depth. The alternative — a directory-level `CLAUDE.md` in every directory containing tests — means 50+ copies of the same rules, guaranteed to drift.

The critical distinction from root `CLAUDE.md`: path rules load only when you're editing a matching file. Terraform conventions don't consume tokens when you're editing React components. Root `CLAUDE.md` loads every session regardless.

To verify a rule is actually loading, run `/memory` in Claude Code. It shows which configuration files are active in the current session. If a rule isn't listed, the glob didn't match — check the pattern. `/memory` is a diagnostic command; it doesn't trigger loading or refresh stale config.

**Layer 3 - Skills** located at `.claude/skills/` define on-demand workflows. The description of each skill is always present and visible to Claude, but the body of the skill is only loaded when it is explicitly invoked via `/skill-name` or implicitly when Claude's description matches certain criteria.

```markdown
---
description: Run a security review on the current diff. Use when asked to review, check security, or audit changes.
context: fork
allowed-tools: Read, Grep, Glob
---

Review the current git diff for:
- OWASP Top 10 vulnerabilities
- Hardcoded secrets or credentials
- Input validation gaps at system boundaries
- SQL injection and XSS vectors

Report only confirmed findings with file path, line number, and remediation.
```

`context: fork`: The skill gets executed in an isolated sub-agent. Whatever verbose results it writes, are hidden away in the subagent. Only the summary comes back in the context window. That way, analysis or brainstorming skills that otherwise would clutter the context with intermediate results, can be used without polluting the context.

`allowed-tools: Read, Grep, Glob`: A read only analysis skill that has Write or Bash access is a potential attack vector. It could potentially write arbitrary files, if the model wanted to. Be conservative and only grant permissions the skill actually needs.

The skills-vs-`CLAUDE.md` confusion is common:

| Put in skills | Put in CLAUDE.md |
|---|---|
| Task-specific workflows (`/review`, `/deploy-check`) | Always-on standards (naming, error handling) |
| Steps that only matter for one kind of task | Rules that apply to every session |
| Verbose procedures that would bloat always-loaded context | Short, universal reference material |

**Layer 4 — Headless CI mode** runs Claude Code non-interactively via the `-p` flag:

```bash
# Hangs in CI — waits for keyboard input that never arrives
claude "Review this PR for security issues"

# Correct — processes prompt, outputs to stdout, exits
claude -p "Review this PR for security issues"
```

For machine-parseable output:

```bash
claude -p \
  --output-format json \
  "Review this PR. Previous findings: ${PREVIOUS_FINDINGS}
  
  Report ONLY:
  1. New issues not in previous findings
  2. Previous findings still present
  
  Do NOT re-report addressed issues."
```

Not including `PREVIOUS_FINDINGS` is not an option if you're running on every push. Same issue gets reported on every push until devs disable commenting entirely because all the notifications are noise. Dedupe logic should be in the prompt.

One subtle edge case to be aware of: never use the same Claude session to review code that it authored. Claude builds internal context about why it wrote the code that it did. It's not good practice to ask Claude to review code that it wrote in the same thread. You should use a different invocation for your code reviews

```bash
# Session A: generate
claude -p "Implement the authentication middleware"

# Session B: review — independent, no shared context
claude -p "Review the authentication middleware for security issues and edge cases"
```

## Plan mode: the decision is about ambiguity, not difficulty

The common framing is "use plan mode for difficult tasks, direct execution for easy ones". The better framing is to use plan mode for tasks where there is more than one valid approach, and the choice between them has downstream implications for other files.

A straightforward but involved bugfix that touches one function and has a clear stack trace is direct execution. A seemingly simple feature request that could be implemented in three fundamentally different ways and touches on many subsystems is plan mode.

Plan mode does not merely ask one to think before acting, but physically removes the ability to act until one has switched back to direct execution. Edit, Write, and Bash (the three broad classes of file modifications) are not available in plan mode. The hybrid pattern for large modifications is therefore

The hybrid pattern for large changes:

1. **Plan phase:** explore the codebase with the Explore subagent, evaluate approaches, design the strategy. The Explore subagent isolates verbose discovery output from the main context window.
2. **Execute phase:** switch to direct execution with the strategy decided. File-by-file implementation with no re-planning needed.

The failure mode is: starting direct execution and switching to plan mode only when complexity emerges. When the task description already states the complexity ("restructure the authentication module to support OAuth"), plan mode should be chosen immediately, not after the first surprise.

## What drifts and how to catch it

The stack decays in expected ways.

**CLAUDE.md becomes too big and rules get added for things that nobody knows if they are needed**. The file reaches 400 lines and the model forgets about the rules in the middle. The solution here is to review the file at least once every time the team makes a major architecture change and treats CLAUDE. MD as a dependency that needs to be updated if any of the code described in it changes.

**The path rules point to patterns that no longer exist**. The rule says something like src/api// , ts but the API was moved to services/ six months earlier. The rule is no longer matched by anything, which makes it ineffective. The fix is to run / memory after every move to see if any of the glob patterns in rules match what they used to. If a given rule is not found, it should be removed.

**Skills accrue dead commands**. The team adds a skill to do something once and then never removes it. The skills/ directory bloats up, and so does Claude’s ability to reason about it. The solution is to review skills quarterly, removing any that have not been used in three months and do not seem to be needed.

**CI review output becomes noise**. Nobody looks at the results because the same problems are always there, or because there are too many false positives to pay attention to real issues. The way to address this is to include previous results in the prompt when launching CI review job, structure the output to prioritize findings by severity level, and establish a policy that dictates what merge is allowed based on review results. Having no policy about CI review results basically allows anyone to merge anything.

**The configuration stack belongs in code review.** Changes to `.claude/CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, and CI workflow YAML should go through the same PR process as application code. If configuration changes aren't reviewed, they're not maintained (they're just accumulated).