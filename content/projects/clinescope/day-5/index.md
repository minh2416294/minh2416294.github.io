---
title: "Day 5: Zero dependencies: what it cost to keep the tree empty"
date: 2026-07-15
draft: false
weight: 5
tags: ["python-packaging", "clinescope", "dependencies", "shipping"]
summary: "I held clinescope to zero runtime dependencies through statistics, an LLM call, and a PyPI release, and the last decision was to stop building."
---

The last call on this project was to kill it - the four models I intended to build had been built, the tool’s internal LLM judge had been benchmarked against chance and gated out, and the honest next step wasn’t a fifth scorer but a release into the wild and onto a user. This post is the account of that process - the zero-dependency constraint I’d forced onto my own development, the production-quality insights I’d stumbled into while faking an install as a stranger would, and the discipline it took to kill the project at the right moment - and this tool’s life now exists in the published package: [pypi.org/project/clinescope](https://pypi.org/project/clinescope/).

## The constraint, and why I held it

`pip install clinescope` pulls nothing else. No numpy, no requests, no client SDK. An empty dependency tree means no transitive supply chain to audit, and a tool a security-conscious team can vet by reading one repo. For a small eval tool whose whole pitch is trustworthiness, that felt worth defending.

Defending it was not free. Two places pushed hard against it.

The statistics. Clinescope validates its LLM judge with Cohen's kappa (in `agreement.py`) and its self-consistency with Fleiss' kappa (in `agreement_multi.py`), plus a bootstrap confidence interval. The obvious move is `import scipy`. I hand-rolled all of it against the standard library instead: kappa is a handful of counts, and the bootstrap is `random` in a loop. I validated the implementations against published worked examples rather than trusting my own arithmetic. The cost was real code I had to get right and test; the benefit was that a reader can audit the exact math the tool reports, with no library between them and it.

The network call. The judge talks to a local model over HTTP. The natural dependency is `requests` or an Ollama client. A single POST does not earn a third-party dependency, so it goes through `urllib` in the standard library. Uglier to write, one fewer thing in the tree.

Neither of these are heroic. They’re just little things that I decided to be a little bit pickier about, and also the reason I’m naming them is because the empty tree isn’t really the lucky case; it’s the series of times I got out of bed earlier to take the slightly more standard-library friendly path.

## The gaps I only found as a stranger

Holding the constraint was easy. The hard lesson was that my tool worked in my checkout and broke for everyone else who installed it, and I only discovered this because I had installed it the way only a stranger would: from the wheel, in a throwaway virtualenv, in a directory that wasn't the repo.

The data crashed first. The corpus runner and the judge report read committed files (the real-trace corpus, the gold set, the judge cache) by a repo-relative path. From a source checkout, the repo root is the working directory and that resolves fine. A `pip install` user has no repo. The default path resolved to nothing and the feature crashed. The fix was to force-include the data directories into the wheel and add a resolver that finds the data root independent of the working directory: the checkout when there is one, the installed location otherwise. Obvious in hindsight, invisible until I ran it from a temp directory.

Then Windows. The judge report prints a Cohen's kappa result, and the kappa glyph is not ASCII. On a Windows console, stdout defaults to cp1252, which cannot encode that character, so the exact command the docs point a user to died mid-print with `UnicodeEncodeError`. I found it because I run Windows, and I ran my own documented command. The fix reconfigures stdout to UTF-8, guarded so it does not break when the stream is a pipe or a test buffer that has no reconfigure method.

Both bugs share a similar shape. The tool was right for me, wrong for someone else, and both were invisible until I stopped being a developer and started being a user.

## Publishing without a stored secret

The release goes to PyPI through GitHub Actions with Trusted Publishing: OIDC, no API token stored anywhere in the repo, scoped to a `pypi` environment that gates the release. The workflow fires only on a published release. No long-lived credential to leak.

One packaging detail worth stating because it is a permanent consequence: the first public release is `1.0.1`, not `1.0.0`. The `1.0.0` tag predated the pip-install packaging fix, and PyPI versions are immutable, you cannot reissue a version once it exists. So the first thing a `pip install` user gets is `1.0.1`, and the version number carries that history whether I like it or not.

## The last decision was to stop

Here is the decision that I have the strongest convictions about (and the least room for proving it with code). The four buildables I said you're going to build, you did: the four scorers, the diff-quality wedge, the judge validation, the CI gate. The next thing was not to build a fifth scorer.

Inventing another scorer, or another round of hardening, would have been make-work. It would have felt like progress and moved nothing that mattered, because the thing standing between this tool and the people it is for was never a missing feature. It was reach. A fifth scorer nobody has heard of is worth less than the four that exist getting in front of one person who needs them.

I decided to stop building and start writing. This and the previous four posts are the result of that decision. The tool is small and humble, it got shipped, and the discipline that kept the dependency tree clean is the same one that leads to the conclusion that a tool is done when it is installable and usable by someone else, not when it stops being interesting to you.

That is the through-line of this whole series, if there is one: make the tool tell the truth even when the truth is worse for the tool. A judge that measured at chance, kept out of the gate. A minimality metric killed for rewarding the wrong behavior. A corpus that ships three-of-four with the gap documented. A re-check that inherited the blind spot it was meant to catch, and the shell that exposed it. An empty dependency tree defended one standard-library call at a time. And a build that stops when it is done instead of when it runs out of road.

## Open questions

- Where do you draw the zero-dependency line? Hand-rolling a statistic is defensible; hand-rolling a TLS stack is not. What is the test you use for "this earns a dependency"?
- For a portfolio or proof-of-work project specifically: how do you decide it is done, when there is always one more feature you could add and no external deadline forcing the call?