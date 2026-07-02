---
title: "Code, Context, and Me"
date: 2026-06-30
weight: 1
draft: false
tags: ["about", "agent-design", "claude-code", "ai-tooling"]
summary: "A self-intro. I work on the controls around AI agents - what they can do, what stays human, and how the system fails when something slips. Here's how I think, shown through the work, including its limits."
---

Hi, I am Minh, and I am currently working on the safety layer for AI agents - that is, the mechanisms that determine when the model can act independently, when a human has to intervene, and what the system should do after something goes wrong. I study at Hanoi University of Science and Technology, but I dropped out of the computer science program after two years.

In my experience, AI-agent demos tend to have one shot, a “flaky” success, and then quietly fail on the second run. One fails a test on a flaky feature, another fails to implement a safety measure that was written as a statement and assumed to be a guard. And most importantly, that the failure is hidden until it comes back to haunt you, and no one can tell you what assumptions were critical. The space between what a system believes and what the documentation says is where I operate.

So, if you asked me to describe what I do in two sentences, I would say something like this:

> I build the guardrails and the guardrails on the guardrails; I encode the decisions that must not be delegated as mechanisms, not as habits I hope to remember.

> I’m an early-career by almost every metric, but I am incredibly careful to not conflate the human-agent boundary: I design the space that I keep for myself and make the system’s automatic procedures reversible, and I make the system fail loudly and not at all.

That is the claim. The rest of this note is me talking about what I actually did, mostly decisions that I made, including the ones that failed. I will describe myself through action rather than adjectives. And since I am writing this note on the 30th of June, some of these things may have changed by the time you read this, but most will not. Please enjoy my ideas; I hope you will like my thoughts. 

You can take a look into my real work on [contributions](https://minh2416294.github.io/contributions/) page and my learning posts on [posts](https://minh2416294.github.io/posts/) page.

## i stopped writing rules for my agent and started building walls

At some point while discussing possible moves for my agent, it suggested pushing to `main` as a result of reasoning through a confusing git state. It concluded that the mess would be best cleaned up by a push, which violated a rule I'd written in natural language for the agent to avoid. The agent read the rule, balanced it against the tangle it was in, and decided to push anyway. It wasn't being willful; it was operating as designed within a probabilistic framework. This was my lightbulb moment, and it rewrote how I approached the whole system.

I hadn't written a rule; I'd made a documentation request. A prompt is something you issue to a model. A wall is something you build around it. The model may well push back at a request. It has no equivalent when it encounters a wall because it's built into the model's ability to operate within constraints. That's why I changed my approach to rule-writing. I broke the one rule I'd written into three discrete layers, the last of which was a natural language prompt. The push to `main` would never happen twice, because neither the deny-listing, the blocking rule, nor the prompt could be tripped by a lapse in concentration or a moment of enthusiasm. I'd built the kind of defensiveness you do when you're facing a single point of failure that could see you lose money, blow up a server, or get yourself fired. In that situation, you're not looking for a 95% solution; you want something deterministic and absolute that doesn't rely on anyone being sober enough most of the time to handle whatever disaster is unfolding.

I reserve the right to the same certainty when I'm working. Any session I'm running as an agent must have a set of gates it has to navigate before getting anywhere. What's the goal? Is this the right task to be working on? Do we have a reasonable plan before proceeding? None of these questions accept"

I think I should, but I'm not sure." In all three cases, the answer has to be concrete or the agent is kicked back immediately. I've trained my own fail-closed instincts to apply to the same risks that I've outlined for the agent to follow, because the worst-case scenario for me is that everything looks good and nothing goes wrong until it does. I don't want to lose sight of the fact that these rules aren't suggestions; they're the absolute minimum when I'm working.

The deny-list was never really about `main` for me. It was the first rule I wrote that encapsulated the philosophy behind the rest of the system. My agents get to make all their own little decisions freely inside a box I drew around them, and they have to ask me for permission to cross any barriers I've put up. Everything they're likely to want to experiment with - branches, commits, running through ideas and scenarios - is available inside their sandbox. Everything that has the potential to irreversibly alter the bigger picture - a merge to `main` or an action affecting production - is locked behind walls I build individually. This is how I let the agent move quickly while still feeling safe, because the walls stop it from doing anything that could expose me to risk.

## i don't trust the agent — and i also don't trust my own guardrails either

Then one of them decided to bite me

I have a second guardrail, cousin to the one that bit me - the agent can't edit files while I'm on `main`. The intention was to make me work on feature branches, so I made a feature branch inside a worktree, told it to write to that feature branch, and got blocked on the branch it was supposed to be writing to. The intended safeguard had malfunctioned, punishing me for doing exactly what it was designed to incentivize.

The reason for this malfunction was simple, if buried: the script looked at the branch of the folder I'd initialized my session in, not the branch of the file I was writing. The two are usually the same, which is why the bug manifested rarely and unpredictably - worktrees make it easy to work in one branch while writing to another, and the script has no idea which one it should check

I have written something wrong as English, but correct as code

I instructed the agent not to edit files on `main`, not to move the process when it should've moved the file. The bug was in assuming the two were linked when they weren't.

This is the part where I tell you that, when faced with this situation, I didn't turn off the guardrail to bypass the bug, like a responsible developer would. I fixed the bug, because when I first encountered it, I assumed an honest mistake: I believed, wrongly, that the control plane itself didn't know what it was doing. The change to fix it was simple: one line of code, changing the query from one that grabbed the folder's branch to one that grabbed the file's. I learned something far more valuable than a working fix, however: a control that fires at the wrong time is often more dangerous than no control at all, because the absence of control is obvious, while a control that covers up its failure to control is much harder to separate from reality.

The reason I caught the error in the first place was because I don't trust my control plane to do its job, even when it does do its job. I am the one who wrote the safeguards, and so I am the one who writes the things that check if the safeguards are doing their job. At the beginning of every session, some code reads my config, checks every single guardrail I've written, and reports in red if any of them appear to be missing. Every command the agent issues is written to an audit log, and when one of my guardrails fails, it reminds me to recheck my permissions at the end of the session. There is nothing flashy about any of these practices - on the contrary, there's a certain dryness to them, even a boringness. None of them exist because I asked myself, "What could go wrong?" and acted on the answer. All of them exist because I asked myself, "What did I think would go wrong, that did not in fact go wrong," and acted on the answer instead. I orchestrate the agent and I verify the agent. The day that I started verifying my own verification tools is the day that I stopped being fooled by my own delusions of safety.

## the part that isn't the agent

The question most people who use an agent ask themselves while using it is whether they can trust it on the task. I stopped asking myself this question. It has an answer that is mostly right, but mostly is a bad place to be when working with something you can only partially control. Instead, I begin asking myself a question that I used to have to answer for the agents I used to work with: can this be made reversible? And, if it cannot, do not do it. This is the single question that underlies the rest of this particular mode of operation, which has three parts.

**Gated entry**. No work proceeds until intent, effort, and a general plan are discussed and pinned down. The gates do not open even to begin work, and they do not care how much I am in a hurry. Most of my aborted conversations with agents began with this very step not being completed, and I was never able to reverse an action I had taken after replying affirmatively to one of these questions.

**Isolated work**. By working across contexts, I prevent any given investigation from becoming compromised by the conclusions of another. When the agent is deployed, each thread must have its own context, brief, and purpose, and the agent's time spent on any one investigation must be seen as an investment that cannot be recovered. In this way, I treat the attention budget of the agent as a fixed, non-renewable resource.

**Staged handoffs**. Work is handed off to the next stage only when the current one is nearing a point of no return, and work is able to proceed at a rapid pace while it can be stopped short at any time. In this model, the reversible steps are those that can proceed without human supervision, and irreversible steps are where humans have to step in. It is not a particular concern of mine to avoid irreversible steps, since that is how human agents work: I can let the system do its work as quickly as possible while I am prepared to stop it when it needs to slow down in order to make a choice.

This is the part where I begin working on something else. It is the boundary condition for a human agent, and it is how a team of ten would be able to scale the same system: fast where it can be fast, stopped where it needs to be stopped, and not wasting time or human hours on work that can be done by something else. I am not a better typist with a model attached, but I have designed an operating system for the model that allows it to make judgments that have permanent consequences.


## So, that's me

I work on the bits of agents that no one demos: the control, the boundaries, the failure modes; I am most interested in a system that fails loudly. I am in the earlier part of the stack, building in public, where I rather expose my own guardrails' bugs than claim publicly that they are not there.

If you build agentic systems and have ever felt the particular existential dread when a safeguard you thought was there is revealed to be absent, I would appreciate your help, and I would like to hear what you think about my work. You can read my code and contributions here: [my contributions](https://minh2416294.github.io/contributions/) or see my learning notes here: [my learning posts](https://minh2416294.github.io/posts/). I prefer you judge for yourself.

Thank you so much for reading this. If you interested, please reach out to me at my [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/Maleficent_Train1207/)