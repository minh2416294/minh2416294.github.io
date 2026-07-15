---
title: "Hardening the Harness"
images: ["share.png"]
date: 2026-07-14
weight: 1
draft: false
tags: ["claude-code", "hooks", "agent-reliability", "harness-engineering"]
summary: "My sixteens Claude Code failure modes, fixed one at a time. Two principles: a guard that fails open is worse than none, and the bug is never in any docs."
---

> **Who this is for:** engineers who move hard rules into Claude Code (or any agent) hooks, and can't tell which of those guardrails are silently dead.
> **What you'll get:** two load-bearing principles for writing hooks that hold, and a build then fire-test then attack loop that finds the bugs reading never will.
> **Built on:** my own `~/.claude` harness. Every code block below is pulled verbatim from a hook I run.

I moved most of my hard rules into hooks. Never push to `main`, never edit during plan mode, never let a formatter overwrite a file, never finish a turn saying tests passed but none ran. Sixteen or so of these, each a small PowerShell script wired to a Claude Code event.

One day I asked the question and had no answer. Which of my hooks are not running? Because a hook that fails when invoked looks no different from a hook that ran successfully and allowed the action to proceed. The only difference is that the guard has stopped checking the thing it was guarding, and nothing in the tool call indicates that.

So I spent some time on a list of the most common claude code failures ranked by impact on the output, cross referenced with my config, and fixed the discrepancies one by one. Sixteen changes in total. What I want to say about is not the list. It's the two lessons I learned while making it, both of which involved significant time investment and are not mentioned anywhere in the documentation.

## The setup: I moved my rules into hooks, then couldn't tell which were alive

The attraction of a hook over a prompt rule is that it has teeth. A line in the config saying "never edit "never edit during plan mode" is a suggestion the model can ignore. A `PreToolUse` hook that denies the edit is a wall.

The issue with walls is that you can't see them. A prompt rule that decayed is visible in the text. A hook that no-opped produces the same output as one that successfully blocked an edit.

The whole point of the conversation was to demonstrate this asymmetry, which ended up driving all subsequent repairs.

## Principle 1: a guard that fails open is worse than none

Here is the trap. You write a deny-hook. It works. Six months later a malformed payload, an encoding glitch, a PowerShell bug makes it fire before its deny logic ever runs. If it fails towards "allow", the guarded action now proceeds unimpeded and you have no idea, since a hook that allows and a hook that crashed both look like they worked from the outside. You are now less safe than you were before you had the hook, because you believed that the hook was making you safer.

A guard that fails open on its dangerous side is worse than no guard at all, because it removes your awareness of being unguarded, which is the one advantage that the absence of a guard has over a guard that fails open on its dangerous side.

The solution is to make each hook fail towards the safe direction. The catch, which I did not at first appreciate, is that the safe direction is not the same for all hooks. "Safe" needs to be calculated individually for every hook, and you must remember which one is which.

- **Deny-hooks** (block a push to main, block an edit in plan mode, block a read of a secrets file): their job is to say no. If they get junk input, the dangerous move is to panic-block a legitimate turn and trap you. So they fail toward *not crashing the turn*, and a separate boot-time probe (below) checks they still say no when the input is real.
- **Observability hooks** (is an MCP server healthy, was this output truncated, is Claude looping): they only ever warn. If they break, the dangerous move is to nag on a false positive. So they fail *silent*.
- **The Stop gate** (does not let the turn end on an unproven claim): if *it* errors, the dangerous move is to block a legitimate session-end forever. So it fails toward *allowing the exit*.

Three hooks, three safe directions, one rule: "fail toward the harmless side, rather than failing open and silent". Here is the Stop gate's fail-safe recipe, which turns any uncertainty into a normal allow:

```powershell
function Emit-Normal-And-Exit {
    $script:normalEmit | ConvertTo-Json -Depth 5
    exit 0
}

# 0. No payload at all -> cannot gate -> allow.
if (-not $payload) { Emit-Normal-And-Exit }

# 1. Loop guard: if a Stop hook is already blocking, do NOT block again.
if ($payload.stop_hook_active -eq $true) { Emit-Normal-And-Exit }

$claim = [string]$payload.last_assistant_message
if (-not $claim) { Emit-Normal-And-Exit }
```

No claim, no payload, already blocking once: every one of those exits by allowing. The gate only blocks on a positive, specific contradiction. Everything else lets the turn end.

## Principle 2: the bug is never in the source

Every bug I ran into during this session (and there were several) was not apparent during reading. Each manifested only when I tested it against a particular input or let an adversarial agent loose on it with instructions to break it as hard as it could.

That is not to say that I was not careless in my coding; I mean that these kinds of bugs are hidden in execution. A fail-open regular expression is written correctly. A date parser that silently never manages to bind is written correctly. A JSON parser that throws on one particular reserved key is written correctly. You can't spot these bugs by reading the code, because the code is right. There's a disconnect between intent and implementation, and your best way of finding it is by running.

The next several sections are each a deep dive on one bug fix. They are listed in order of how much the attack surface helped me find the bug. In each case, I had to build and fire-test a new payload before submitting it into adversarial multi-agent testing, where another system had to design a payload I hadn't thought of that would break it, nonetheless find the exact edge cases that the fire-test didn't. In four of the five cases, the issue wasn't found until the attack surfaced it to me.

## The Stop gate: four rounds to block one lie

The failure: Claude ends a turn with "all tests pass" after not running any tests that turn. This is the single most corrosive failure for someone whose weakness is shipping code they can't fully explain, because the unverified "done" is exactly the claim you most want to trust.

The fix seems simple. When the last message says that tests passed, check the turn's transcript for an actual test command; if there isn't one, block the exit and force Claude to perform the tests. Here is the block:

```powershell
if ($testCmdRanThisTurn -eq $false) {
    @{
        decision = "block"
        reason   = "[STOP GATE] Your final message claims the tests pass, but NO test command (pytest/npm test/jest/vitest/go test/cargo test/make test/mvn/gradle/dotnet/rspec/etc.) ran in this turn's transcript. Do not end on an unverified test claim: actually run the test suite now and report the exact command + its exit code."
    } | ConvertTo-Json -Depth 5
    exit 0
}
```

The trivial part took four adversarial rounds to get right. Twice I thought I had it when the test run on my own input passed, but an attacker with inputs I hadn't thought of falsely passed it. It false-blocked a "make test" workflow and a "gradlew" one, because my "do a test run" check used a substring match that didn't account for build wrappers. It waved through a forged "the tests passed" because the claim-detection regex matched the same phrase I had hard-coded in a test. Both times, the attack vector was in directions I hadn't considered my code handling.

The durable fix was structural, not another regex patch. Instead of matching runner names, it splits each command on `&&` and `;` and pre-filters install/search noise per segment, then looks for a real test invocation in what remains. And "this turn" is bounded by the last genuine user prompt in the transcript, so a test from a *prior* turn can't be counted as proof for this one.

One honest residual, which I left in and which the post's second principle predicts. To finish under the 15-second timeout, the gate caps its transcript scan:

```powershell
$MAX_SCAN = 3000
if ($allLines.Count -gt $MAX_SCAN) {
    $lines = $allLines[($allLines.Count - $MAX_SCAN)..($allLines.Count - 1)]
}
else {
    $lines = $allLines
}
```

Now on a turn longer than 3000 transcript lines of actual work with tests running before that window, the test line would be outside the scan, but the gate could false-block a genuine end. That is, a fail-unsafe miss (blocking legitimate work) rather than a fail-safe miss, which I would know about because I deliberately looked for the block-direction error condition. It's considered an acceptable risk (for a normal turn's tail that contains the prompt and the tool calls), documented rather than hidden, because a guard you can't document is a liability; you have to be able to describe one precisely to create an appropriate test for it.

## The fire-probe: testing the guards that test everything else

If a dead guard looks like a live one, then the highest-leverage thing I can build is a guard that checks the other guards are alive. This is that.

At session start, before any real work, the boot hook fires a synthetic *should-be-denied* payload at each of the four deny-hooks and asserts each one actually emits a deny. If any doesn't, the session start goes loud. You only see the green "all guards armed" line if every guard positively denied a payload built to trip it.

```powershell
$denyProbes = @(
    @{ name = 'block-sensitive-reads.ps1'; payload = '{"tool_name":"Read","tool_input":{"file_path":"/tmp/x/.env"}}' },
    @{ name = 'plan-mode-guard.ps1'; payload = '{"permission_mode":"plan","tool_name":"Edit","tool_input":{"file_path":"x.py"}}' },
    @{ name = 'protect-golden-fixture.ps1'; payload = '{"tool_name":"Edit","tool_input":{"file_path":"/x/fixtures/messages/success.messages.json"}}' },
    @{ name = 'branch-guard.ps1'; payload = ('{"tool_name":"Edit","tool_input":{"file_path":"' + ($env:USERPROFILE -replace '\\', '/') + '/story.txt"}}') }
)
```

The subtlety, which the attack found, is that a self-test which itself fails open is worse than no self-test, because it prints a green light over a dead guard. My first version had four ways to do exactly that, three sharing one root cause: it captured the hook's output as a merged stdout+stderr stream and matched the deny case-insensitively. So a deny written to stderr (which the real harness ignores) passed. A wrong-case key passed. A wrong-case value passed. All three printed green over a guard that, in production, would not have denied.

The fix was to make the probe as strict as the production code: capture only stdout and require an exact match on both key and value.

```powershell
# Require BOTH: (1) the raw stdout contains the exact-case key "permissionDecision"
# (-cmatch, case-sensitive), and (2) the PARSED value is exactly 'deny' (-ceq).
# Together these reject wrong-case key, wrong-case value, stderr-only, and silent no-op.
$denied = $false
try {
    $keyExactCase = $stdout -cmatch '"permissionDecision"\s*:'
    $parsed = $stdout | ConvertFrom-Json
    $decision = $parsed.hookSpecificOutput.permissionDecision
    if ($keyExactCase -and $decision -is [string] -and $decision -ceq 'deny') { $denied = $true }
}
catch { $denied = $false }
```

PowerShell is case-insensitive with respect to JSON property access and with respect to -match , which is the bug which caused three out of four possible defects to manifest. The harness itself is case-sensitive, though, and a self-test which is less stringent than the system under test does not certify anything. All tests are run in background jobs with a short timeout, so a hung probing thread is a test failure, not an exception.

## The formatter that poisoned its own cache

This is the one failure my harness made worse. After every edit, a ` PostToolUse ` hook runs a formatter (ruff, prettier, etc.) and rewrites the file on disk. This is great, except that Claude's context retains the previous contents, so subsequent same-turn edits using the same tool operate on a nonexistent version of the file and overwrite the wrong section, corrupting it, silently.

The hook itself is what makes the cache invalid, so the correct fix is to hash the file before and after the formatter and warn only if they differ:

```powershell
# Pre-format content hash -- to detect if a write-formatter actually mutated the file.
$preHash = $null
try { if (Test-Path -LiteralPath $file) { $preHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash } } catch { $preHash = $null }
```

```powershell
if ($preHash) {
    $postHash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($postHash -ne $preHash) {
        $reReadDirective = "STALE-CACHE WARNING: '$file' changed on disk after your edit ... Before ANY further Edit to this file this turn, Read it again -- otherwise the next Edit may match wrong/stale content or fail silently."
    }
}
```

The changed-only gate is the whole point: an already-clean file produces an identical hash and no warning, so this fires as signal, not as per-edit wallpaper.

The attack found the fail-open. What happens when the pre-edit hash can't be captured, because the file was absent or locked at hook entry? My first version set `$preHash = $null` and, with no pre-hash to compare, silently emitted no warning. That is failing open on the dangerous direction: the one case where I *can't* verify the file is stale is exactly the case I most need to warn about. Fixed to fail defensively: no pre-hash means emit the caution anyway.

```powershell
else {
    # Could not capture a pre-edit hash (file absent/locked at hook entry) -> cannot verify
    # whether the formatter mutated it. Warn conservatively.
    $reReadDirective = "STALE-CACHE CAUTION: could not verify '$file' against its pre-edit state ... Read it again before any further Edit this turn to be safe."
}
```

"I don't know" has to route to the safe side, not the quiet side. A guard that goes silent precisely when it loses visibility is failing open with extra steps.

## Instruction decay and the per-turn reminder

Rules stated once at the beginning of a session fall off the model's attention as conversation lengthens. It is simply an inevitable consequence of the nature of attention as a short-term window which only considers the tokens it directly observes, without any context compression. And it defeats the very purpose of guardrails stated upfront.

The correct approach is to move the burdened rules from the now-irrelevant front of the context to the newly arrived tail. This is achieved in the harness by injecting the rules anew on every turn via the `UserPromptSubmit` hook. Which is why you see a `[Per-turn reminder ...]` block in the prompts issued by this very assistant.

```powershell
$lines = @()
$lines += "[Per-turn reminder -- load-bearing rules, do not let them decay]"
if ($goalLine) { $lines += $goalLine }
$lines += "Surgical scope: touch ONLY what this request needs; no adjacent refactors, reformatting, or deleting pre-existing dead code without asking. Minimum viable code: no speculative abstractions/flexibility; if 200 lines could be 50, cut it."
$lines += "No-agent zones (always AskUserQuestion, never decide silently): (1) DB/schema migration, (2) auth/session, (3) new runtime dependency, (4) architecture/module-boundary."
```

A per-turn hook has a particularly nasty constraint: if it ever throws, then it henceforth degrades every turn. Thus, its every possible failure path must return without inject-ing, not crash.

The runtime bug in the code is actually my favorite example of principle two, because it really looks like correct code that almost looks like it does the right thing. The goal reminder code only injects if the reminder date is within 48 hours, so I parse a date:

```powershell
# NOTE: format must be a [string[]] array -- the single-string overload
# does not bind in Windows PowerShell 5.1 (MethodCountCouldNotFindBest).
if ([datetime]::TryParseExact($setMatch.Groups[1].Value, [string[]]@('yyyy-MM-dd'),
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None, [ref]$setDate)) {
```

Pass a plain string as the format instead of a single-element `[string[]]`, and on Windows PowerShell 5.1 the method overload silently never binds. No error. The parse just always fails, so the freshness check always fails, so the goal never injects, and every reminder block looks fine because the other four lines are still there. I found it only by running the hook and noticing the goal line was missing from output that otherwise looked complete.

## The loop-guard and the PSObject that killed it

Claude can get stuck re-issuing the same failing command, wasting the entire token budget with no internal off switch. The loop-guard hashes each tool call, warning each time a call repeats 5 times in a row.

```powershell
$shouldWarn = $false
if ($count -ge $WARN_THRESHOLD) {
    if ($warnedAt -eq 0 -or ($count - $warnedAt) -ge $RE_WARN_EVERY) { $shouldWarn = $true }
}
```

Warn, never deny: a false deny on a legitimate poll or retry is the dangerous direction, so it's designed out. The attack found the silent no-op the design had warned me to hunt for, and it's a good one. A tool call whose input contained a key literally named `PSObject` made PowerShell's `ConvertFrom-Json` throw, because `PSObject` is a reserved member name. My `catch` swallowed it, so the *entire* hook no-op'd, and a real loop would go unwarned forever while the hook looked healthy.

The fix was to change the parser, not to add another guard around the same one:

```powershell
Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
$js = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$js.MaxJsonLength = [int]::MaxValue
return $js.DeserializeObject($json)
```

`JavaScriptSerializer` returns a plain dictionary with no reserved-member problem. `-AsHashtable` would have been the clean fix, but it's PowerShell 6+ and this box is 5.1. That constraint, and the date-parse one above, are the tax of the environment, and both bugs were invisible until the code ran on it.

## The other eleven, briefly

The five above are the ones the attack taught me the most. The rest, in one table, each with what running or attacking it caught:

| Failure | The fix | What surfaced only by running/attacking |
|---|---|---|
| Plan mode ignored (edits before you approve) | A deny-hook blocking edit tools when the mode is `plan` | A notebook-edit variant slipped past both the matcher and the condition; fixed at both layers |
| MCP server silently dropped | A once-per-session health check on the first tool call | Boot-time check was racy: servers aren't connected yet at session start, so it moved to first-tool-call |
| Large output truncated silently | A warn hook when stdout hits the ceiling | A 60K probe proved the docs wrong on the field name *and* that output cuts hard at 30,000 chars |
| Compaction drops the *why* behind decisions | A section telling the summarizer what to preserve | A planned hook to re-inject rules during compaction was physically impossible; that layer can't inject surviving context |
| Summarizer deletes standing safety rules | Preserve-list for the two things a hook genuinely can't re-inject | Same impossibility lesson: verify a mechanism exists before planning around it |
| Wrong-but-plausible edit (clean, but wrong) | A failing-test-first rule on every fast path, not just the slow one | No hook can catch an intent-level bug; the only lever is forcing behavior verification where it was skipped |
| Gaming a test to go green | A rule against editing a red test green instead of fixing the code | Draft over-fired on deliberate contract changes; re-anchored on exact wording |
| Confident hallucination of file contents | A rule to read or grep before *asserting* code, not just before editing | The edit tool already blocks editing an unread file; this closes the prose-assertion gap |
| Agreeing with a wrong premise | A rule to verify a load-bearing factual claim against source before building on it | Deference to a wrong premise amplifies your own blind spot; agreement can't be the default |
| Reading a question as a task | A rule to classify question vs task and answer, not implement | A hook can't read intent, so this one stays prose, with the same exemptions as obvious tasks |
| Repeated malformed tool call poisoning the turn | A rule to vary the call once, then stop and reset | It happens below every hook, at the parse layer, so no hook can catch it; discipline is the only lever |

The two "impossible plan" rows are worth pausing on. In both, my first design was a hook, and in both the hook could not work, because the compaction layer can only halt a summary, not inject surviving context into it. I found that out before building, by checking the mechanism against the docs rather than assuming. Verify a mechanism is viable before you plan around it. It's the cheap cousin of principle two: some bugs you can catch by reading the contract instead of the code.

## What I'd do differently

The honest limitations. Several of these points are prose rules, not hooks, because the problems occur at a lower level than hooks can express: intent-level bugs, questions versus tasks at the parse-layer, etc. Prose rules are weaker than walls, and I said so at each point rather than pretend a rule is a hook.

The Stop gate's residual 3000-line limit is real and I left it in, because making it higher trades a rare false block for a slower hook on every honest end, and I would rather have the fast common case and a documented edge than a slow hook and a hidden one.

And the recurring theme of all the misses: the fire-test I wrote passes the inputs I imagined, but fails on the ones the attacker actually used. If I were to do this again, from scratch, I would write the adversarial pass before believing that the fire-test was sufficient, because there were two occasions where I declared a point fixed and the attack showed up in the hour afterwards.