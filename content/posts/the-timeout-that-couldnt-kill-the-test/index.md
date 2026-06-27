---
title: "the timeout that couldn't kill the test"
date: 2026-06-14
draft: true
tags: ["pytest", "asyncio", "flaky-tests", "debugging"]
summary: "I added a per-test timeout to turn a CI hang into a clean failure. It hung for the full five minutes anyway. A timeout fires on a thread; the hang was in a C syscall."
---

I was standing up the test suite for [langwatch/scenario](https://github.com/langwatch/scenario), an open-source agent-testing framework, to hunt for flaky tests. First full run of the non-integration suite — 999 tests collected clean — and it wedged around 57% through. No failure, no error. Just stopped. Five minutes later `faulthandler` dumped a stack trace and pytest gave up.

I knew the fix. Add a per-test timeout so the hanging test fails fast and names itself instead of taking the whole process down with it. `pytest-timeout` was already installed. I ran it again with `--timeout=60`.

It hung for the full five minutes anyway.

That's the moment worth writing down, because it broke an assumption I didn't know I was making: that a timeout can stop any hang. It can't. And *why* it can't turned out to be the thing that actually solved the problem.

## What the stack trace said

Here's the bottom of the dump from the first run:

```
File "...asyncio\windows_events.py", line 808, in _run_once
    event_list = self._selector.select(timeout)
File "...asyncio\windows_events.py", line 434, in select
    self._poll(timeout)
File "...asyncio\windows_events.py", line 461, in _poll
    status = _overlapped.GetQueuedCompletionStatus(self._iocp, ms)
```

And a background thread, still alive, sitting in the framework's own event bus:

```
Thread ScenarioEventBus-Worker:
File "...scenario\_events\event_bus.py", line 81, in _worker_loop
```

The test was blocked inside `GetQueuedCompletionStatus` — the Windows IOCP call asyncio uses to wait for I/O completion. That's not Python code waiting. That's the interpreter parked inside a C-level blocking syscall, waiting for a completion event that was never going to arrive.

## Why the timeout was useless against it

`pytest-timeout` has two methods. The default on most setups, and the one configured here in `pytest.ini`, is `timeout_method = thread`: it starts a watchdog timer in a *separate* thread, and when the timer expires it tries to interrupt the main thread and dump its stack.

The catch is in the word "interrupt." Python can only deliver that interruption at a bytecode boundary — between instructions, when the interpreter is actually running Python. A thread blocked inside a C syscall isn't running Python. It's down in `_overlapped.GetQueuedCompletionStatus`, and it won't come back up to the bytecode level until the syscall returns. The syscall never returns, so the main thread never reaches a point where it can receive the interrupt.

The watchdog fires. It dumps the stack. Then it sits there, having accomplished nothing, because there's no safe moment to hand the interrupt over. The 60-second timeout had been configured the whole time — the run still ran five minutes, until an outer process-level limit finally killed pytest from the outside.

So the rule I walked away with: a thread-based timeout is a request, not a guarantee. It works when the hang is in Python (a slow loop, an `await` that's progressing too slowly). It does nothing when the hang is in native code — a C extension, a blocking syscall, a deadlocked lock held below the interpreter. For those, the only thing that reliably stops the process is a signal or an outer kill, not a watchdog thread inside the same process.

There is a `timeout_method = signal` mode that uses `SIGALRM`, which *can* break a syscall — but `SIGALRM` doesn't exist on Windows, which is where I was. On this platform, for this hang, the timeout had no working mechanism available to it at all.

## The dump was the answer, not the failure

Here's the turn that mattered. I'd been treating the stack dump as the symptom of a tool that wasn't working. It was actually the most useful diagnostic I had — I just wasn't reading it as one.

If the timeout can't *kill* the test, it can still *name* it. I'd been running with `-q`, which prints only dots, so I couldn't tell which test wedged. I switched to verbose:

```bash
$ pytest tests/ -v -p no:cacheprovider
```

With `-v`, pytest prints each test's node ID *when it starts*, before it runs. So when the suite hangs, the last line in the log with no `PASSED`/`FAILED` after it is the culprit, sitting there mid-execution:

```
tests/test_scenario.py::test_scenario_scripted_fails_if_script_ends_without_conclusion
```

Started, never finished. That single line did what the timeout was supposed to do — it identified the hanging test — and it cost nothing but a flag change.

Then the part that justified the whole exercise. I ran that test alone:

```
$ pytest tests/test_scenario.py::test_scenario_scripted_fails_if_script_ends_without_conclusion
1 passed in 7.86s
```

Passes by itself in eight seconds. Hangs forever inside the full suite. That gap is the definition of a flaky test with an order dependency — the test's own logic is fine; something a *prior* test leaves behind wedges it. The `ScenarioEventBus-Worker` thread in the stack dump was the prime suspect: a background worker from an earlier test that never got reaped, still alive, interfering with this test's event loop.

I confirmed the shape by running the whole file alone — all 17 tests passed in 15 seconds. So the trigger wasn't even in the same file. It was cross-file state leaking from something that ran earlier in the alphabet. That's a real reproduction of a real flaky condition, and I got there by reading the artifact the "broken" timeout produced.

## What I'd tell someone hunting the same kind of hang

Reach for the timeout — it's still the right first move, because when it works it's the cheapest fix there is. But know its failure mode before you trust it: a thread-method timeout cannot break native code, and on Windows the signal method that could isn't available. If a hang ignores your timeout, that's not the timeout malfunctioning. It's information: the hang is below the interpreter, in a syscall or a C extension, and you need an outer kill to bound it.

And don't throw away the stack dump because the tool "didn't work." A verbose run plus the dump tells you which test, which thread, and which syscall — which is most of a diagnosis. The hang that won't die is also the hang that's holding still long enough to be read.

What I'm still chewing on: whether running each test in its own subprocess (`pytest-forked`, or `-p xdist` with one process per test) would have isolated the leak immediately by giving every test a clean interpreter — at the cost of losing the exact cross-test interaction that *is* the flakiness. Isolating the bug and reproducing the bug might be opposite goals here, and I haven't worked out which one I actually want first when the failure only exists in the interaction.
