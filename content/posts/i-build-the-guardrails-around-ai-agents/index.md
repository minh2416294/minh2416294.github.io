---
title: "i build the guardrails around AI agents — hi, i'm Minh"
date: 2026-06-30
weight: 1
draft: true
tags: ["about", "agent-design", "claude-code", "ai-tooling"]
summary: "A self-introduction. I work on the controls around AI agents — what they may do, what stays human, and how the system fails when something slips. Here's how I think, shown through the work, including its limits."
---

I'm Minh, and I build the unglamorous safety layer around AI agents — the controls that decide what an agent may do on its own, what stays a human's call, and how the whole thing behaves when something slips. Not the model. The harness around it. I'm early-career — a second-year CS/AI student in Hanoi — but unusually deliberate about that boundary.

Here's why I care about it. Most AI-agent demos pass once and quietly break on the second run. A test goes green on a flake. A safety rule reads like protection and turns out to be a no-op nobody noticed. The failure is invisible until it costs someone, and by then nobody remembers which assumption was load-bearing. That gap — between a system that *looks* like it works and one that actually does — is the whole job.

If I had to put what I do in two sentences, it's these:

> I build the guardrails **and** the guardrails on the guardrails — I encode the decisions that must not be delegated as mechanisms, not as habits I hope to remember.

> I'm early-career by years, but unusually deliberate about the human/agent boundary: I design what stays human-owned, automate what's reversible, and make the system fail loud instead of failing silent.

That's the claim. The rest of this post is me showing you what it actually looks like — three real decisions, including the ones that went wrong and the proof I *can't* give you yet. I'd rather introduce myself through the work than through adjectives.

## I'd rather build a wall than write a reminder

Start with a rule I care about: my agent must never push to `main`. For a while that lived as a line in my instructions file, and the agent followed it — until one session, reasoning through a confusing git state, it proposed pushing to `main` to "fix" a mismatch. It had read the rule. It decided this was the exception.

That's when I stopped treating my config as rules I wrote and started treating it as code that can be wrong. An instruction in a markdown file is a strong prior, not a constraint. The model weighs it against everything else in context and follows it most of the time, and some rules can't live on "most of the time." A push to `main`, a write to a production database, a refund over the limit. The cost of the rare miss isn't a rare fraction of the cost.

So I made "never push to `main`" un-violatable in three independent layers: a permission deny-list, a separate script that blocks the action before it runs, and the written rule as backup. No single lapse of attention gets through all three. That's the instinct I'd bring to your codebase — when being right 95% of the time isn't good enough, I don't write the reminder more emphatically, I move it into something deterministic that doesn't depend on anyone remembering.

The harder half of that decision was *where to draw the line* — which calls get a wall and which don't. I drew it on reversibility. Anything the agent can undo, it owns: branch commits, pushes to a feature branch, all reclaimable with a reset or a deleted branch. The one irreversible step, merging to `main`, stays mine, by hand, every time. That boundary is the part I think is genuinely useful to a team running agents: knowing which decisions you can hand off because a mistake is cheap to walk back, and which you can't because it isn't. Automate what's reversible. Keep what isn't. Make the system fail loud instead of failing silent.

## The time my own guardrail turned on me

I want to show you a bug, not just a win, because the bug is the more honest introduction.

I also have a rule that the agent can't edit files while I'm on the `main` branch — same idea, enforced by a script that checks the branch before every edit. Then I created a feature branch in a worktree, asked the agent to write a file into it, and the script said no. It blocked me from the feature branch. The guardrail punished the exact workflow it existed to protect.

The cause: the script read the branch of the folder I'd *started* the session in, not the branch of the file I was *writing*. With worktrees those are different. I'd written something correct as English — "don't edit on `main`" — and wrong as code, and I'd guarded the process when I meant to guard the file.

I fixed it in one line. But the lesson outlasted the patch, and it's the thing I'd actually want a teammate to know about me: a control that fires on the wrong thing is more dangerous than no control, because it *looks* like you're covered. "It's in my config" and "it fires" turned out to be different claims, twice. The only reason I caught the second one was a test I wrote to check my rules against their own behavior — the same move I'd push you to make on any system you can no longer hold in your head.

## A bug report is a hypothesis, not a spec

The decision I keep coming back to is one where I *didn't* ship anything.

I was working on an open issue in [cline](https://github.com/cline/cline), a popular coding agent: issue #11620. I had a plausible fix lined up and a branch ready. Before writing it, I went looking for the failure at the actual line of code it was supposed to live on. It wasn't there. The behavior in the report came from the model emitting Windows command syntax; there was no matching call in the source to fix. My fix would have been a real diff that changed nothing about the problem.

So I killed it. I downgraded my own work from a pull request to a plain triage comment explaining what was really happening. Dropping a defensible-looking PR is harder than writing one — it feels like the work, the diff is right there — but a fix that papers over the real cause is worse than no fix, because someone has to re-diagnose it later. I'd rather tell a maintainer "this isn't where the bug is, and here's the evidence" than hand them a confident guess that wastes a review cycle.

That's the disposition I'd most want you to know about: I treat a bug report as a hypothesis to confirm, not a spec to implement. I'll tell you "I don't know yet, and here's the one thing that would settle it" before I tell you something that merely sounds right. For anyone who's had to clean up after a contributor's symptom-fix, that's the trait that takes work *off* your plate instead of adding doubt to it.

## What I can't show you yet

Here's the part most introductions skip, and the part that matters most for trusting a stranger.

Almost all the evidence I just described is self-authored. The harness, the rules, the three-layer block — I wrote them, I run them, and no third party has audited any of it. My strongest open-source contributions are exactly that: *open*, in review, not merged. The success metric I set for myself, a merged PR in a real repo, I haven't cleared yet. If you're skeptical reading this, you're right to be: a rule I wrote for myself proves I can design a control, not that the control held up under someone else's pressure.

I'm telling you that on purpose. The whole point of the work above is refusing to claim more than the evidence supports, and the honest move is to apply that to myself, out loud, before you have to. The config is real and you can read it; the way of thinking is visible in the paper trail whether or not a merge has landed. But "this works in production" isn't a claim I get to make today, so I won't. If that distinction is one you care about in the people you work with, that's the most useful thing I can show you about how I operate.

It also tells you exactly what I'm building toward: the events that would close the gap. One merged fix in someone else's codebase. One control that constrains a second person instead of only me. I know which artifacts turn "how I work" into "what I've shipped," and I'm pointed straight at them.

## So, that's me

I work on the part of agents nobody demos — the controls, the boundaries, the failure modes — and I care more about a system that fails loud than one that looks impressive. I'm early, I build in public, and I'd rather show you a bug in my own guardrails than a screenshot of them working.

If you build agentic systems and you've felt the specific dread of a safeguard you're no longer sure actually fires, I think I'd be useful to you — and I'd want to learn from you while I close the gap I just described. You can read the rest of what I've built right here: the contributions, the build logs, the bugs in my own guardrails. I'd rather you check than take my word for it.
