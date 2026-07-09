---
title: "Open-source contributions"
description: "My contributions to Agentic AI Coding Repositories"
contributions:
  - repo: "cline/cline"
    summary: "stopped Cline's CLI from spamming a duplicate-key React warning while browsing `/skills`, by giving each repeatable `read_files` row an index-namespaced key, covered by a regression test"
    url: "https://github.com/cline/cline/pull/12144"
    date: 2026-07-08
  - repo: "mastra-ai/mastra"
    summary: "kept long agent threads readable by stopping observational-memory status snapshots from persisting as real messages, marking the `data-om-status` part transient so it never crowds out real turns"
    url: "https://github.com/mastra-ai/mastra/pull/19084"
    date: 2026-07-08
  - repo: "anomalyco/opencode"
    summary: "archiving a session now closes its tab cleanly instead of reopening a closed one, restoring desktop session cleanup by selecting the next session only from root, non-archived candidates"
    url: "https://github.com/anomalyco/opencode/pull/35416"
    date: 2026-07-05
  - repo: "cline/cline"
    summary: "made multi-file edit review trustworthy in the VSCode extension, so each \"wants to edit this file\" diff shows only that file's changes (splitApplyPatchByFile, open PR)"
    url: "https://github.com/cline/cline/pull/12086"
    date: 2026-07-05
  - repo: "OpenHands/OpenHands"
    summary: "your custom global skills now show up in the WebUI, by fixing skills_router.py to scan both the new and legacy skills folders (deduped, new one wins)"
    url: "https://github.com/OpenHands/OpenHands/pull/15123"
    date: 2026-07-05
  - repo: "continuedev/continue"
    summary: "new users now land on the live models docs page instead of a redirect that could 404, by fixing a stale link in the generated starter config"
    url: "https://github.com/continuedev/continue/pull/12943"
    date: 2026-07-05
  - repo: "mastra-ai/mastra"
    summary: "stopped the default `mastra api trace list` command from crashing with a 500 for DuckDB users, by adding the missing listTracesLight forwarder and a regression test"
    url: "https://github.com/mastra-ai/mastra/pull/18955"
    date: 2026-07-05
  - repo: "cline/cline"
    summary: "brings back Cline's AI commit-message feature for repos that have only untracked files, detecting those files with `git ls-files --others`, covered by 5 tests"
    url: "https://github.com/cline/cline/pull/12069"
    date: 2026-07-04
  - repo: "mastra-ai/mastra"
    summary: "stopped `mastra build` from silently pinning the wrong dependency version and crashing deployed servers, by resolving package roots through a filesystem walk"
    url: "https://github.com/mastra-ai/mastra/pull/18917"
    date: 2026-07-04
  - repo: "cline/cline"
    summary: "fixes long CLI/TUI sessions that wouldn't reopen after saving, by making the message codec stable across save/reload cycles, with 5 regression tests"
    url: "https://github.com/cline/cline/pull/12050"
    date: 2026-07-04
  - repo: "continuedev/continue"
    summary: "stopped autocomplete from popping up in chat and other non-code input boxes, using a URI-scheme denylist so remote dev and notebooks keep working"
    url: "https://github.com/continuedev/continue/pull/12942"
    date: 2026-07-04
  - repo: "OpenHands/OpenHands"
    summary: "fixed Git provider search returning duplicate repositories, caused by a dedup helper that tracked entries by id but checked membership by full_name"
    url: "https://github.com/OpenHands/OpenHands/pull/15113"
    date: 2026-07-04
  - repo: "mastra-ai/mastra"
    summary: "kept type checking working for workflow developers writing `dowhile`/`dountil` loops, adding compile-time tests so the #14627 fix can't silently break again"
    url: "https://github.com/mastra-ai/mastra/pull/18689"
    date: 2026-06-30
  - repo: "mastra-ai/mastra"
    summary: "fixed Gemini 3 agents that crashed on the second turn when mixing native file search with custom tools, tracing it to a silent tool-call ID mismatch"
    url: "https://github.com/mastra-ai/mastra/pull/18604"
    date: 2026-06-29
  - repo: "cline/cline"
    summary: "fixed Cline CLI's OpenCode model picker showing an empty list, tracing it to a missing PROVIDER_IDS_MAP entry and restoring the model catalog with a regression test"
    url: "https://github.com/cline/cline/pull/11876"
    date: 2026-06-26
  - repo: "confident-ai/deepeval"
    summary: "documented why G-Eval broke for some GPT-5 judge models, so developers stop chasing misleading \"invalid JSON\" errors instead of the real cause: missing log probabilities"
    url: "https://github.com/confident-ai/deepeval/pull/2805"
    date: 2026-06-26
  - repo: "confident-ai/deepeval"
    summary: "stopped developers from hitting a runtime crash when they copied the tool-correctness docs, fixing a nonexistent ToolCallParams.TOOL reference and correcting the flag descriptions"
    url: "https://github.com/confident-ai/deepeval/pull/2804"
    date: 2026-06-26
  - repo: "langfuse/langfuse"
    summary: "fixed media uploads that were failing for self-hosted Langfuse on Azure Blob Storage by adding the missing `x-ms-blob-type` header, leaving S3/MinIO untouched"
    url: "https://github.com/langfuse/langfuse/pull/14574"
    date: 2026-06-25
  - repo: "cline/cline"
    summary: "let users find the experimental Skills feature again by pointing skills.mdx at the real scale-icon Skills tab instead of a removed Settings toggle"
    url: "https://github.com/cline/cline/pull/11838"
    date: 2026-06-25
  - repo: "cline/cline"
    summary: "gave developers a visible scrollbar in Cline's VS Code command output panel so they can tell more output exists below the fold, reusing the `code-block-scrollable` styling"
    url: "https://github.com/cline/cline/pull/11699"
    date: 2026-06-21
  - repo: "cline/cline"
    summary: "stopped write-capable MCP tools (like editing Azure DevOps work items) from running without consent, requiring both the global and per-tool toggles instead of a short-circuiting OR gate"
    url: "https://github.com/cline/cline/pull/11698"
    date: 2026-06-21
  - repo: "cline/cline"
    summary: "stopped a documentation example from silently steering developers onto a deprecated connection method, correcting the remote MCP example to specify streamable HTTP via its explicit `type` field"
    url: "https://github.com/cline/cline/pull/11690"
    date: 2026-06-20
  - repo: "langwatch/scenario"
    summary: "a core feature is safety-checked in CI again, after fixing a stuck `wait=False` test whose mock never signaled end-of-turn so it blew past CI's 60s timeout"
    url: "https://github.com/langwatch/scenario/pull/691"
    date: 2026-06-20
---

Open-source work I've shipped - bug fixes and small improvements to AI coding agents tools. Connect with me on [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/tbmkunn_/)
