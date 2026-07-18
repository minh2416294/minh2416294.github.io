---
title: "Day 6: Integrating Clinescope to VS Code extension"
date: 2026-07-18
draft: false
weight: 6
tags: ["clinescope", "vscode-extension", "coding-agents", "eval-reliability"]
summary: "I pointed clinescope at a real VS Code extension session."
---

`qwen2.5-coder:7b` told me it created `calc.py`. It didn't. It called `plan_mode_respond` twice, describing what file it would create, then failed to call any edit tool at all. From the perspective of the outer agent, the VS Code extension, it looked like a successful run. When I ran `clinescope --vscode` against that session, it reported `tool_selection 0/100`, `diff_coherence 0/100 FAIL`. The whole reason for the tool is to detect exactly this kind of case, where the model declares a tool call as its final action, but then does nothing at all, on an actual extension trace run from the CLI. This is the day I got it right, after two false starts and two lying-green bug reports. It shipped as [clinescope 1.1.0](https://pypi.org/project/clinescope/)

## Two storage roots, and reading the source to find out which one is real

The extension wasn't saving its sessions in the place I expected it to. My CLI was already reading Cline's standalone data at `~/.cline/data`, so I'm not surprised that I assumed the same for the extension.

It doesn't, however, and I had to read the actual Cline source to find out why. Real users' sessions are stored in their VS Code instance's `globalStorage` root at `/globalStorage/saoudrizwan.claude-dev/tasks/taskId/`, with files per task at `api_conversation_history.json`. The `~/.cline/data` path is the root for the standalone tool, and migrating between the two is a non-trivial upstream TODO (`vscode-to-file-migration.ts`). Had I implemented `--vscode` naively, it would've looked in the wrong place on each real machine and found nothing useful.

So `extension_discovery.py` (new, pure standard lib, no dependency) is finding the per-platform storage root (`%APPDATA%\Code` on Windows, `~/Library/Application Support/Code` on Mac, `$XDG_CONFIG_HOME` or `~/.config`/`/Code` on Linux), plus looking into alternative product forks (Code - Insiders, VSCodium, Cursor, Windsurf), honor `CLINE_DATA_DIR` / `CLINE_DIR` override environment variables if set, then listing conversation folders, skipping those without a conversation history file, newest first. Lesson learned again: read the target tool's source to find out where it saves its data; don't guess at it from the CLI tool's location, even if they share a codebase.

## The bug the research found, and the verifiers that kept me honest

The up-front research turned up a potential problem: the extension's message format includes a bare string as a message content, which my loader assumed to be a list. A bare string would silently fall through to get dropped by my loader; I reproduced it and it's a definite false positive for every capture.

The adversarial verifiers I run over my own research then pointed out that the problem wasn't as severe as I initially made it out to be. The reason is simple: there's 0/324 messages in my corpus that actually have that shape, because Cline turns a bare string into a textblock when serializing a message (see agent-message-codec.ts ). Thus, a bare string is a valid in-memory representation of an Anthropic message shape I should be prepared to handle, but not a production issue I'm currently hitting.

I fixed it regardless, because "valid input my loader silently drops" is still a correctness issue, and the fix hardens the CLI surface. But the verifiers helped me greatly in rooting out overstatements - the research didn't turn up a critical production bug, and I'm very grateful that the adversarial verifiers pushed back. _world_a_normalize_content now surrounds a bare string content with a single text item, sends other non-list content to dropped_items for inspection, and otherwise preserves bytes when passed a list.

## The wrong turn: replace every tool

Here is the wrong turn I almost made. The CLI's three diff scorers evaluate the grammar of `apply_patch`, the Cline tool used earlier. The VS Code extension uses `write_to_file` and `replace_in_file` tools by default, rather than `apply_patch`. The obvious "fix" and early impulse was to replace every instance of the `apply_patch` tool with the new tools so that the CLI's scorers could grade them.

That would have messed up the one thing that I wanted to protect most: my CLI scoring, my golden fixture, and all of the real trace corpus that depend on `apply_patch`. Changing the tool that the scorers evaluate would have destroyed everything, the baseline, to experiment with another approach, however slightly better in theory.

I've added instead of removed; the tool's vocabulary now knows about the tools from the VS Code extension (lifted from `ClineDefaultTool` enum) as a second family, and `apply_patch` is in both. When invoked on a `write_to_file` session, the diff scorers do what they should, report a hard `0/100` for `diff_coherence` and `n/a` for the other two, since they can't evaluate a tool they were not built to see. This is not a bug, but a feature, pointing to the next thing to work on, the diff grammar scorer for `write_to_file` and `replace_in_file`, which now has a roadmap instead of being wishful thinking.

## Green here, red there, again

I have a passing test on my Windows machine that I pushed, and CI turned four tests red on Linux.

The --vscode tests set up a fake home directory so that discovery would look in a temporary tree rather than my real machine. It worked on Windows, because Windows doesn't have an XDG_CONFIG_HOME. But on the GitHub Actions Linux runners, XDG_CONFIG_HOME is set, so discovery found the real config directory on the runner, and not the temp tree I was trying to inject. Nothing was wrong with the discovery code, per se. It was just that the test environment on one OS had cross-talk with another OS.

The solution is an autouse fixture that clears XDG_CONFIG_HOME, APPDATA, CLINE_DATA_DIR, and CLINE_DIR before discovery tests, so they don't read any real configuration. Same lesson as Day 5, but in a different costume: green here, red there, and CI has the final say. Again I have to relearn this lesson because the environment variables that leaked were different this time.

## What shipped

`clinescope --vscode` auto-discovers the extension storage, lists recent sessions with a picker (newest first, Enter takes the newest, q quits), and scores the pick through the existing loader and the four unchanged scorers. Plain `clinescope <trace>` stays byte-identical, so no CLI user is surprised. The four scorer files are not in the diff at all; the extension path is built entirely from additive code around them, and the dependency tree is still empty. Clean-shell suite is `537 passed`, `mypy --strict` and `ruff` clean, the golden fixture is byte-identical, and it went to PyPI as `1.1.0`.

I've preserved the two actual sessions captured as fixtures: the no-op above, and a write_to_file success. Real sessions over synthetic ones, the same discipline as the corpus, because a fixture I authored by hand only proves that I can write to my own spec.

## Open questions

- The diff scorers honestly abstain on `write_to_file` / `replace_in_file` sessions rather than pretend to grade them. Is a single diff-grammar scorer that handles all three tool formats worth building, or are the formats different enough that one scorer would blur what each is actually checking?
- Every time I ship something that passes locally and breaks on CI, the culprit is a different environment variable leaking in. Is there a general way to run a test in a guaranteed-empty environment, short of enumerating every variable I can think of to clear?