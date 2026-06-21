---
title: "Python 3.14 was the bug, not the test"
date: 2026-06-17
draft: false
tags: ["pytest", "open-source", "flaky-tests", "python"]
summary: "I found a flaky test in an OSS repo and almost filed it. Then I re-ran on the Python version the project actually supports, and the flake vanished."
---

I had a flaky test cornered in [langwatch/scenario](https://github.com/langwatch/scenario) and I was one command away from filing it. The test was `test_scenario_scripted_fails_if_script_ends_without_conclusion`. Run it alone: passes in 7.9 seconds. Run it inside the full suite: hangs forever. That's the textbook signature of an order-dependent flaky test — passes in isolation, wedges in company — and it's exactly what I'd been hunting.

Then I noticed which Python I was on, and the whole finding evaporated.

I was running 3.14. The repo's `requires-python` targets 3.10 through 3.12. I'd been hunting bugs in the project while standing on a runtime the project doesn't claim to support — which means I had no way to tell whether the hang was *their* bug or *my environment's* bug. So before filing anything, I ran the one check that settles it: reproduce on a version they support.

## The check that killed my finding

`uv` makes this cheap — it can fetch and pin a specific interpreter, so I built a clean 3.12 environment without disturbing the 3.14 one:

```bash
$ uv venv --python 3.12
$ uv pip install -e ".[dev]"
$ python --version
Python 3.12.13
```

Then I re-ran the same full suite. On 3.14 it had wedged around 64%. On 3.12:

```
tests/test_scenario.py::test_scenario_scripted_fails_if_script_ends_without_conclusion PASSED [48%]
```

The test that hung forever on 3.14 passed cleanly, in the full suite, on 3.12. My flaky test wasn't flaky. It was a Python 3.14 forward-compatibility problem in the framework's async cleanup — real, but not a bug in the test, and not anything a maintainer targeting 3.12 would accept. If I'd filed "this test is flaky," the correct response would have been *"you're on an unsupported Python,"* and they'd have been right.

That's the part worth sitting with. The PR wouldn't just have been rejected — it would have cost me credibility with the exact people I was trying to contribute to. A bad first PR to an OSS project is worse than no PR. It tells the maintainers you didn't check your own setup before spending their review time. The version check wasn't bureaucratic diligence. It was the difference between looking careful and looking careless to a team of strangers.

## The discipline, stated plainly

When you're hunting a bug, your environment is a variable in the experiment, not a constant. A failure that only reproduces on an unsupported toolchain is a fact about your toolchain, not about the code. The cheapest way to separate the two is to pin the interpreter (and, where it matters, the dependency versions) to exactly what the project supports *before* you trust any failure you see.

I'd internalized this for dependency versions — everyone knows "works on my machine" is a version-mismatch story. I hadn't extended it to the interpreter itself. Python 3.14 was new enough that I'd installed it without thinking of it as a confound. It was the biggest confound in the room.

## The flake the version check found

Here's why the check is the opposite of a setback. The 3.12 run didn't come back clean — it wedged too, but at a *different* test:

```
tests/voice/test_agent_wait_false.py::test_agent_wait_false_returns_before_turn_finishes
```

This one hung even in isolation on 3.12. Not order-dependent. Not 3.14-specific. And when I opened the file, the maintainers had already documented it, in the test's own docstring:

```python
# These tests pass deterministically locally (~2s total) with no external
# services, but hang indefinitely in the project's python-ci workflow for
# reasons we haven't been able to reproduce outside CI.
# Skipped under CI=true until that's fixed.
```

A known, unsolved, in-code-acknowledged hang — skipped in CI rather than fixed, which means it doesn't even run there. The docstring says it hangs *in CI but not locally* and that they couldn't reproduce it outside CI. I'd just reproduced it locally, on Windows, with everything mocked and no API keys. That became the basis for a real contribution — [PR #691](https://github.com/langwatch/scenario/pull/691), the test-side fix for that hang.

So the version check didn't cost me a finding. It traded a fake one for a real one. The fake finding looked great until the environment was controlled; the real finding survived the control. That's the whole value of the check — not that it kills bugs, but that it only kills the ones that were never there.

## What I'd tell someone contributing to a repo they don't own

Before you trust any test failure as a bug worth reporting, reproduce it on the project's supported runtime — interpreter version included, not just dependency versions. If it only fails on your newer Python, you've found a forward-compatibility issue (sometimes worth its own contribution, framed honestly) but not the bug you thought you had. The check takes one `uv venv --python 3.12` and saves you from the single most embarrassing OSS mistake: filing a bug that only exists in your own setup.

What I'm still unsure about: where the line sits for the forward-compat finding I set aside. The 3.14 hang *is* real — `scenario`'s async resource cleanup doesn't survive the newer interpreter — and "add 3.14 support" is a legitimate contribution. But it's a much larger, riskier change than a test fix, in code I'd just met, for a Python version the maintainers may not be ready to target. I don't have a good rule for when "I found a real forward-compatibility bug" is worth raising versus when it's noise the maintainers haven't asked for yet.
