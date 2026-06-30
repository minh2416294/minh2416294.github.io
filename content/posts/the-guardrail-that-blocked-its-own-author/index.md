---
title: "the guardrail that blocked its own author"
date: 2026-06-30
weight: 1
draft: true
tags: ["about", "agent-design", "claude-code", "ai-tooling"]
summary: "A guardrail I wrote refused to let me do the exact work it was built to protect. That bug is the shortest honest introduction to how I think — and what I'd be useful for."
---

A few weeks ago a guardrail I wrote locked me out of my own work.

I have a rule that my AI agent can't edit files while I'm on the `main` branch — it's enforced by a script that runs before every edit, checks the branch, and refuses if it's protected. The point is to force all real work onto feature branches, which is the one git habit I actually care about. Then I created a feature branch in a worktree, asked the agent to write a file into it, and the script said no. It blocked me from the feature branch. The guardrail punished the exact workflow it existed to enforce.

I sat with that for a minute — first because it's funny, then because it's the actual problem I work on. I'd written something that was correct as English — "don't edit on `main`" — and wrong as code. The script read the branch of the folder I'd *started* the session in, not the branch of the file I was *writing*. With worktrees those are different. I'd guarded the process when I meant to guard the file.

If you build systems that decide what software is allowed to do, you already know the feeling: the control that fires on the wrong thing is more dangerous than no control, because it *looks* like you're covered. I'm Minh, a second-year CS/AI student in Hanoi, and almost everything I work on lives in that exact gap, between a rule you wrote and a rule that's actually true. This post is the truest introduction to that I can give, because it's the failure, not a highlight reel.

## What I actually work on

The thing I keep returning to is agents and tooling that *look* like they work and quietly don't. A demo passes once. A test goes green on a flake. A config rule reads like protection and is a no-op. The failure is invisible until it costs someone, and by then nobody remembers which assumption was load-bearing.

So I've spent the last several months building the controls that sit around an AI agent: what it may do, what has to stay mine, and how the whole thing behaves when something slips. Not the model. The harness around it — the part that decides whether "be careful about X" is a sentence I hope the agent honors or a wall it can't walk through.

That sounds abstract, so here is the concrete version, three decisions deep.

## I'd rather build a wall than write a reminder

The rule that mattered most was "never push to `main`." For a while it lived as a line in my instructions file, and the agent followed it — until one session, reasoning through a confusing git state, it proposed pushing to `main` to "fix" a mismatch. It had read the rule. It decided this was the exception.

That's when I stopped treating my config as rules I wrote and started treating it as code that can be wrong. An instruction in a markdown file is a strong prior, not a constraint. The model weighs it against everything else in context and follows it most of the time — and some rules can't live on "most of the time." A push to `main`, a write to a production database, a refund over the limit. The cost of the rare miss isn't a rare fraction of the cost.

So I made "never push to `main`" un-violatable in three independent layers — a permission deny-list, a separate script that blocks the action before it runs, and the written rule as backup. No single lapse of attention can get through all three. That's the move I'd bring to your codebase: when being right 95% of the time isn't good enough, I don't write the reminder more emphatically. I move it into something deterministic that doesn't depend on anyone remembering.

The harder half of that decision was *where to draw the line* — which calls get a wall and which don't. I drew it on reversibility. Anything the agent can undo, it owns: branch commits, pushes to a feature branch, all of it reclaimable with a reset or a deleted branch. The one irreversible step — merging to `main` — stays mine, by hand, every time. That boundary is the part I think is genuinely useful to a team running agents: knowing which decisions you can hand off because a mistake is cheap to walk back, and which you can't because it isn't. Automate what's reversible. Keep what isn't. Make the system fail loud instead of failing silent.

## A bug report is a hypothesis, not a spec

Here's the one I keep coming back to, and it's a decision where I *didn't* ship anything.

I was working on an open issue in [cline](https://github.com/cline/cline), a popular coding agent: issue #11620. I had a plausible fix lined up and a branch ready. Before writing it, I went looking for the failure at the actual line of code it was supposed to live on. It wasn't there. The behavior in the report came from the model emitting Windows command syntax; there was no matching call in the source to fix. My fix would have been a real diff that changed nothing about the problem.

So I killed it. I downgraded my own work from a pull request to a plain triage comment explaining what was actually happening. Dropping a defensible-looking PR is harder than writing one — it feels like the work, the diff is right there — but a fix that papers over the real cause is worse than no fix, because someone has to re-diagnose it later. I'd rather tell a maintainer "this isn't where the bug is, and here's the evidence" than hand them a confident guess that wastes a review cycle.

That's the discipline I'd want you to know about most: I treat a bug report as a hypothesis to confirm, not a spec to implement. I'll tell you "I don't know yet, and here's the one thing that would settle it" before I'll tell you something that sounds right. For anyone who's had to clean up after a contributor's symptom-fix, that's the trait that takes work *off* your plate instead of adding doubt to it.

## What I can't show you yet

Now the part most introductions skip, and the part that matters most.

Almost all the evidence I just described is self-authored. The harness, the rules, the three-layer block — I wrote them, I run them, and no third party has audited any of it. My strongest open-source contributions are exactly that: *open*, in review, not merged. The success metric I set for myself — a merged PR in a real repo — I haven't cleared yet. If you're skeptical reading this, you're right to be. A rule I wrote for myself proves I can design a control; it doesn't prove the control held up under someone else's pressure.

I'm telling you that on purpose, and not out of modesty. The whole point of the work above is refusing to claim more than the evidence supports — and the honest move here is to apply that to myself, out loud, before you have to. The config is real and you can read it; the dispositions are visible in the paper trail whether or not the merge has landed. But "this works in production" is not a claim I get to make today, so I won't. If that distinction is one you care about in the people you work with, that's the strongest thing I can show you.

It also tells you exactly what I'm building toward: the events that would close the gap. One merged fix in someone else's codebase. One control that constrains a second person instead of only me. I know which artifacts turn "how I work" into "what I've shipped," and I'm pointed straight at them.

## Where this leaves me

That guardrail that locked me out? I fixed it in one line — resolve the branch from the file being written, not the folder I started in. But the lesson outlasted the patch. I'd written a control without checking where it actually sat in the system that runs it, and "it's in my config" and "it fires" turned out, twice now, to be different claims. The thing that caught the second one wasn't a smarter rule. It was a test I wrote to check my rules against their own behavior — the same move I'd tell you to make on any system you can no longer hold in your head.

So here's the honest pitch. I'm early, I build in public, and I'd rather show you the bug in my own guardrails than a screenshot of them working. If you build agentic systems and you've felt the specific dread of a safeguard you're no longer sure actually fires, I think I'd be useful to you — and I'd want to learn from you while I close the gap I just described.

You can read all of it — the build logs, the contributions, the bugs in my own guardrails — right here. I'd rather you check than take my word for it.
