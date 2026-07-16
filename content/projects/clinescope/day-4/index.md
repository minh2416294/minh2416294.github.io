---
title: "Day 4: Adversarial re-checks: the blind spot they inherit"
date: 2026-07-15
draft: false
weight: 4
tags: ["testing", "verification", "clinescope", "python-packaging"]
summary: "My tool passed every test and an adversarial re-check, and was still broken from a clean shell, because the re-check ran in the same primed environment the tests did."
---

I ran an adversarial re-check against my own work in particular to pick up what my tests had missed. It worked! The adversarial re-check was also broken when run in a clean shell with the same commit. The re-check missed the bug for the same reason the tests did: it ran in the environment in which the bug was masked. The failure mode is adversarial verification as nobody tells you about, a re-check has the blind spot of whatever it re-checks, unless you vary the one variable that hides the bug. It has to do with the real fix: commit [`2edbbb7`](https://github.com/minh2416294/clinescope/commit/2edbbb7).

One note before the story, because a fact-checker will click that commit. This bug and fix are from early in the project, when the package was still named `agent_eval_harness`; it was renamed to `clinescope` a few commits later (in [`54f28bc`](https://github.com/minh2416294/clinescope/commit/54f28bc)). So at the linked commit you will see `agent_eval_harness` in the error strings. I use the current name `clinescope` below because that is the tool that shipped; the mechanism is identical, only the name changed.

## The green that was lying

I declared that the feature was complete, the harness hit the specified end to end fixture, the tests passed, and a multi-agent adversarial re-review confirmed it. I then opened a fresh shell, made no environment changes, checked out main, and used the same commands a new contributor would run:

```
$ python -m clinescope ...
No module named clinescope.__main__
$ pytest -q
ModuleNotFoundError: No module named 'clinescope.tool_selection'
```

The code on `main` was correct. It had been correct the whole time. The environment was lying, and the tests and the re-check had both believed it.

## The root cause: a stale pointer, not a bug

I develop this project across several git worktrees, one per feature, sharing a single virtualenv. The package is installed editable (`pip install -e .`), and an editable install writes a `.pth` file into the venv that pins every import of the package to *one* checkout's `src/` directory.

Whichever worktree ran `pip install -e .` last wins. Mine had been pinned to an old worktree that only contained an early skeleton, no scorer, no entry point. So a clean shell resolving the import silently loaded the old code, or failed outright when the symbol it wanted did not exist there. Nothing in the source was wrong. The install pointer was stale.

## Why the tests and the re-check both passed

Here is the part worth sitting with. My test runs and the adversarial re-check had all executed with `src` on the path, because that is how I had been running things during development. With `src` explicitly on the path, Python finds the current worktree's code and never consults the broken `.pth` pointer. Green.

The clean shell has no such priming. It falls through to the `.pth`, loads the stale worktree, and breaks. Same commit, opposite result, and the only difference is one environment variable that was set in every place I checked and unset in the place a stranger would run it.

The adversarial re-check did not catch it because I tested it in the same primed environment as my tests. I had written the adversarial pass to be suspicious of my code; it had no grounds to be suspicious of the environment, since it was in it too. An adversarial pass that shares an environment with the code it audits cannot find bugs that are not available to it

## The fix, in two layers

Two orthogonal changes, both in the tree at that fix commit.

First, make the test runner install-independent. `pyproject.toml` sets the path explicitly:

```toml
[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

Now `pytest` resolves the package from the current checkout's `src/` regardless of what the stale `.pth` says. This was proven the honest way: with the broken `.pth` still in place, `PYTHONPATH= pytest -q` passed. The fix survives new worktrees, so the class of bug cannot recur for the test suite.

Secondly, make the CI structurally immune. The CI job does a clean editable install and then runs the suite in an entirely new checkout in any case, so there's no shared virtualenv and no other worktrees for the pinning situation to appear in. The CI is now the environment-honest re-check that I failed to perform myself, and it runs on every push.

The worktree gotcha itself is written into `CONTRIBUTING.md`, in plain terms, so the next person who shares a venv across worktrees reads the trap before they hit it instead of after.

## What you can steal

A passing check only tells you the truth about the environment it ran in. If something "works on day one," verify it from a naked shell, no `PYTHONPATH`, no primed path, or your green is a claim about your machine's state, not your code.

The sharper corollary, the one this post is named for, is that an adversarial re-check is only as honest as its environment. The value of putting your test skeptic in an environment primed (as per the above) to hide a bug is that it will audit your methods and rubber-stamp your environment. It may even find a different bug, but if you change whatever variable in the environment could have concealed the bug, your second test will merely re-assure you in the accuracy of the same environment.

## Open questions

- If you run adversarial or red-team passes over your own work, do you run them in a deliberately different environment than your tests, or the same one? What's the environment variable you'd be most embarrassed to have set in both?
- For shared-venv-across-worktrees specifically: is there a cleaner fix than pinning `pythonpath` in `pyproject`, short of a venv per worktree?