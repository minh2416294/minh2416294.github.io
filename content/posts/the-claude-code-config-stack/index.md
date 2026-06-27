---
title: "the Claude Code config stack nobody maintains"
date: 2026-04-20
draft: true
tags: ["claude-code", "developer-tooling", "ai-engineering", "ci-cd"]
summary: "CLAUDE.md, path rules, skills, hooks, and headless CI each have their own post. Nobody writes about how they compose — or what happens when the stack drifts."
---

Six months after setting up Claude Code for a team, the configuration is usually a mess. The `CLAUDE.md` has grown to 400 lines and nobody knows which parts are still accurate. The skills directory has three commands nobody uses. The path-scoped rules reference file patterns that were reorganized in Q1. The CI job runs `claude -p` and sometimes flags the same issue it flagged last week, sometimes doesn't.

The problem isn't any individual layer. It's that each layer was set up in isolation, and nothing enforces that they stay coherent.

Here's how the layers fit together and how to keep them from rotting.

## The four-layer stack

Each layer has a different scope, load time, and failure mode. Using the wrong layer for a job isn't just inefficient — it creates silent misconfiguration that's hard to debug.

```
Layer 1: CLAUDE.md           — always-loaded, universal standards
Layer 2: Path-scoped rules   — loaded only when editing matching files
Layer 3: Skills              — on-demand, invoked by model or developer
Layer 4: Headless CI mode    — non-interactive, machine-readable output
```

**Layer 1 — CLAUDE.md** loads for every session, regardless of what you're editing. That's its value and its cost. Put universal team standards here: naming conventions, error handling patterns, testing requirements, architecture decisions. Don't put task-specific procedures here — that's what skills are for. Don't put file-type-specific conventions here — that's what path rules are for.

The three-level hierarchy matters for team environments:

- `~/.claude/CLAUDE.md` — user-level, personal, not version-controlled, not shared via git
- `.claude/CLAUDE.md` or root `CLAUDE.md` — project-level, shared with everyone who clones the repo
- Subdirectory `CLAUDE.md` — directory-level, overrides project-level in that subtree only

The failure mode teams hit most often: a new developer clones the repo and Claude Code doesn't behave as expected. The instructions are in `~/.claude/CLAUDE.md` instead of `.claude/CLAUDE.md`. User-level config isn't version-controlled. It never reaches the new developer. Move team-wide standards to project-level.

When `CLAUDE.md` grows unwieldy, split it with `@import`:

```markdown
# .claude/CLAUDE.md
@.claude/rules/testing.md
@.claude/rules/api-conventions.md
@.claude/rules/deployment.md
```

Each imported file is a single source of truth. Update once; it propagates everywhere. Without `@import`, you either maintain one 400-line file or duplicate the same rules across multiple directory-level files — both degrade over time.

**Layer 2 — Path-scoped rules** in `.claude/rules/` load conditionally based on which files you're editing. This is the right layer for conventions that apply to a file type spread across many directories.

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

**Layer 3 — Skills** in `.claude/skills/` are on-demand workflows. Their descriptions are always in context so Claude knows they exist, but the full body loads only when invoked — either explicitly via `/skill-name` or automatically when Claude's description matching fires.

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

`context: fork` runs the skill in an isolated sub-agent. The skill's output — which can be verbose — stays inside the subagent. The main context window receives only the summary. This is load-bearing for analysis or brainstorming skills that would otherwise fill the context with noise.

`allowed-tools: Read, Grep, Glob` is a security boundary. A read-only analysis skill that has `Write` or `Bash` access is a skill that could modify files if the model decides to. Restrict to what the skill actually needs.

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

Including `PREVIOUS_FINDINGS` is not optional if you're running on every push. Without it, the same issue gets flagged on every push, generating duplicate comments until developers start ignoring all CI output. The de-duplication logic belongs in the prompt.

One non-obvious constraint: don't use the same Claude session to review code it just generated. When Claude writes code, it builds context about why it made each choice. Asking it to review that code in the same session means it's reviewing against its own reasoning. Use a separate invocation for review:

```bash
# Session A: generate
claude -p "Implement the authentication middleware"

# Session B: review — independent, no shared context
claude -p "Review the authentication middleware for security issues and edge cases"
```

## Plan mode: the decision is about ambiguity, not difficulty

The common framing is "use plan mode for hard tasks, direct execution for easy ones." The better framing: use plan mode when multiple valid approaches exist and the choice affects other files; use direct execution when the correct approach is already known.

A difficult but well-defined bug fix — clear stack trace, single function, known cause — is direct execution. A seemingly simple feature request that could be implemented three different ways and touches multiple modules is plan mode.

Plan mode enforces this at the tool level: Edit, Write, and Bash are removed from Claude's available toolset during planning. It's not a prompt instruction to "think before acting." File modification is physically blocked until you switch to execution.

The hybrid pattern for large changes:

1. **Plan phase:** explore the codebase with the Explore subagent, evaluate approaches, design the strategy. The Explore subagent isolates verbose discovery output from the main context window.
2. **Execute phase:** switch to direct execution with the strategy decided. File-by-file implementation with no re-planning needed.

The failure mode the notes flag is real: starting direct execution and switching to plan mode only when complexity emerges. When the task description already states the complexity ("restructure the authentication module to support OAuth"), plan mode should be chosen immediately — not after the first surprise.

## What drifts and how to catch it

The stack decays in predictable ways.

**CLAUDE.md grows past its useful size.** Rules accumulate as the project evolves. Old rules stay because nobody is sure if they're still needed. The file hits 400 lines and the model starts losing track of rules buried in the middle. The fix is periodic review — at a minimum, whenever the team ships a major architectural change. Treat CLAUDE.md like a dependency: it needs updates when the codebase it describes changes.

**Path rules reference patterns that no longer match.** The rule file says `src/api/**/*.ts` but the API layer was reorganized under `services/` six months ago. The rule silently stops loading. No error, no warning — it just doesn't apply. Run `/memory` after reorganizations to verify rules are still loading. If a rule isn't listed, the glob is stale.

**Skills accumulate dead commands.** Teams add skills for one-time tasks and never remove them. The skills directory grows; Claude's description matching has more candidates to reason about. Audit skills quarterly: if a skill hasn't been invoked in three months and the task it covers hasn't changed, remove it.

**CI review output becomes noise.** Developers stop reading CI findings when the same issues appear repeatedly, or when the signal-to-noise ratio is low. Include previous findings in the prompt, require structured output with severity levels, and set a policy for what finding severity blocks merge. Without a merge policy, automated review becomes decoration.

**The configuration stack belongs in code review.** Changes to `.claude/CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, and CI workflow YAML should go through the same PR process as application code. If configuration changes aren't reviewed, they're not maintained — they're just accumulated.

What I'm still working out: how to write a useful test for CLAUDE.md adherence. You can write evals for model output quality, but "did Claude follow the naming convention rule on this particular edit" is harder to measure systematically. I've been using spot-checks and periodic audits, but that doesn't scale past a certain team size.
