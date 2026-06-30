---
title: "I'm Minh and I build the guardrails around AI agents"
date: 2026-06-30
weight: 1
draft: false
tags: ["about", "agent-design", "claude-code", "ai-tooling"]
summary: "A self-intro. I work on the controls around AI agents - what they can do, what stays human, and how the system fails when something slips. Here's how I think, shown through the work, including its limits."
---

Hi! I'm Minh, and I build the safety layer around AI agents (the controls that decide what an agent may do on its own, what stays a human's call, and how the whole thing behaves when something slips). Not the model. The harness around it. Actually, I dropped out of Computer Science at Hanoi University of Science and Technology after two years to focus on agent harness engineering.

From my experience, AI-agent demos often pass once and quietly break on the second run. A test goes green on a flake. A safety rule reads like protection and turns out to be a no-op nobody noticed. Moreover, the failure is invisible until it costs someone, and by then nobody remembers which assumption was load-bearing. The gap between a system that *looks* like it works and one that actually does is the whole job.

If I had to put what I do in two sentences, it's these:

> I build the guardrails and the guardrails on the guardrails; I encode the decisions that must not be delegated as mechanisms, not as habits I hope to remember.

> I'm early-career by years, but unusually deliberate about the human/agent boundary: I design what stays human-owned, automate what's reversible, and make the system fail loud instead of failing silent.

That is the claim. The rest of this post is me showing you what it actually looks like: a few real decisions, including the ones that went wrong. I will introduce myself through the work than through adjectives. I wrote this post on June 30th so when you read this, something might change but the core ideas stay the same. I hope you love my ideas. Btw, I use ChatGPT to rewrite this post so the grammar and vocabulary I used might sound AI-generated (hope you guys don't mind)

You can take a look into my real work on [contributions](https://minh2416294.github.io/contributions/) page and my learning posts on [posts](https://minh2416294.github.io/posts/) page.

## i stopped writing rules for my agent and started building walls

One session, my agent proposed pushing to `main`. It was reasoning through a confusing git state and decided a push would "fix" the mismatch. There was a rule against this — a line in my instructions, in plain English, that the agent had read. It read the rule, weighed it against the mess in front of it, and decided this was the exception.

It wasn't being reckless. It was doing exactly what a probabilistic system does: treating my rule as one strong input among many, not as a law. And that's the realization that reorganized how I work. I hadn't written a weak rule. I'd filed a *governance decision* under *documentation* — I'd asked, in prose, for a thing I actually needed to be impossible. A prompt is something you request of a model. A wall is something you impose on it. The model can argue with a request. It can't argue with a wall, because it never gets the chance.

So I rebuilt that one rule as three independent layers — a permission deny-list, a separate check that blocks the action before it can run, and the written rule as the last line, not the first. No single lapse of attention gets through all three. It's defense-in-depth, the same posture you'd reach for the moment a single mistake means lost money, a security hole, or a compliance breach. You don't meet that risk with a 95%-reliable reminder. You meet it with something deterministic that doesn't depend on anyone — human or model — remembering in the moment.

I hold myself to the same standard, which is the part I think actually matters. Before any work starts, my own sessions have to clear a few hard gates: what's the goal, is this the right level of effort, is there a plan. None of them accept "it's a quick task" as an answer. I built the fail-closed instinct to point at me, too, not just the agent — because the failure mode I'm most afraid of is the one where everything *looks* fine.

But the deny-list was never really about `main`. It was the first place I wrote down the rule I now run the entire partnership on: **let the agent own everything it can undo, and put a machine — not a sentence — around everything it can't.** Branch commits, exploration, a dozen parallel investigations: all reversible, all the agent's to make freely. The merge to `main`, the schema change, the irreversible public move: walled off, mine, by hand. The agent moves fast precisely *because* the dangerous moves are mechanically out of reach. The wall isn't what slows it down. The wall is what lets me let go.

## i don't trust the agent — and i don't trust my own guardrails either

Then one of those walls turned on me.

I have a second guard, a cousin of the first: the agent can't edit files while I'm sitting on `main`. The point is to force real work onto feature branches. So I made a feature branch in a worktree, asked the agent to write into it — the *exact* thing the guard exists to encourage — and the guard said no. It blocked me from the branch it was supposed to be protecting. The safeguard punished the workflow it was built to defend.

The cause was a quiet one. The script checked the branch of the folder I'd *started* the session in, not the branch of the file I was *writing into*. Most days those are the same folder, so the bug was invisible. With worktrees they diverge, and the guard had been quietly reading the wrong thing the whole time. I'd written something correct as English — "don't edit on `main`" — and wrong as code: I'd guarded the process when I meant to guard the file.

Here's the part I'd actually want a teammate to know. When my own safeguard misfired, I didn't switch it off to get unblocked — the reflex of someone who *uses* tools. I treated it as a bug in the control plane and fixed the guard. The patch was one line; resolve the branch from the file, not the folder. The lesson outlasted it by a mile: a control that fires on the wrong thing is more dangerous than no control at all, because no control is honest about leaving you exposed, while a broken one *looks* like cover.

And the only reason I caught it is that I don't extend trust to my own machinery any more than I extend it to the agent. I build the guard, and then I build the thing that watches whether the guard is still alive. Every session start, something reads my config, walks every guardrail I've installed, and tells me in red if one has gone missing or silent. Every command the agent runs lands in an audit trail, and when the blocks pile up in a session, I get a nudge at the end of it to go re-tune my own permissions. None of it is glamorous. All of it exists because "it's in my config" and "it actually fires" turned out to be different claims — twice. I orchestrate the agent, and I verify the agent. The day I started verifying my own guardrails too was the day the system stopped quietly lying to me about being safe.

## the part that isn't the agent

Most people working with an agent ask one question: *can I trust it with this?* I stopped asking it. It's the wrong question, because the answer is always "mostly," and "mostly" is exactly the gap that bites you. The question I ask instead is *can I make this reversible?* — and if the answer is no, it doesn't go to the agent at all. That single swap is the operating model the whole partnership runs on, and it has three moving parts.

**Gated entry.** Work doesn't start until the intent, the effort, and a rough plan are pinned down. The gates don't negotiate and they don't care that I'm in a hurry. Most bad sessions I've had were bad before the first line of work — they started without a clear answer to *what are we actually doing here.*

**Isolated work.** When the agent fans out across a codebase, each strand runs in its own context with its own brief, so one investigation can't quietly poison another with half-formed conclusions. I treat the agent's attention as a scarce budget, not a free resource — context that stays clean stays trustworthy.

**Staged handoff.** Work advances one phase at a time, and the agent stops at every boundary that's hard to walk back and waits for me. The reversible stretches run fast and unattended; the irreversible ones get a human. That's not caution for its own sake. It's where the speed comes from — you can let a system sprint precisely because you know exactly where it's required to stop.

This is the part I think scales. The same boundary that keeps one agent safe is the one you'd hand a team running ten of them: fast where it's cheap to be wrong, stopped cold where it isn't. I'm not a faster typist with a model attached. I designed an operating model and put a machine where the judgment had to be permanent.


## So, that's me

I work on the part of agents nobody demos - the controls, the boundaries, the failure modes - and I care more about a system that fails loud than one that looks impressive. I'm early, I build in public, and I'd rather show you a bug in my own guardrails than a screenshot of them working.

If you build agentic systems and you've felt the specific dread of a safeguard you're no longer sure actually fires, I think I'd be useful to you, and I'd want to learn from you. You can read the rest of what I've built right here: [my contributions](https://minh2416294.github.io/contributions/) or the build logs, the bugs I faced here: [my learning posts](https://minh2416294.github.io/posts/). I'd rather you check than take my word for it.