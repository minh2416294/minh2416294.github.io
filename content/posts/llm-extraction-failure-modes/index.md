---
title: "five failure modes in LLM extraction, and the fix for each"
date: 2026-05-12
draft: true
tags: ["prompt-engineering", "structured-output", "llm-evaluation", "ai-engineering"]
summary: "Every prompt engineering technique exists because a specific failure mode forced it. Here's the failure taxonomy, not the technique list."
---

Most prompt engineering posts are structured as a technique list: here's few-shot, here's chain-of-thought, here's structured output. The techniques are real. What's missing is the failure mode that made each one necessary.

Here's the same material from the other direction.

## Failure 1: the model interprets vague instructions differently each run

You write "be conservative" in the system prompt. The model is conservative on Monday and permissive on Wednesday with the same input. You add "use your best judgement." Nothing changes.

The model doesn't know what your definition of "conservative" is. It infers from context, and context varies. The instruction is a suggestion to guess, not a rule.

The fix is operationalized criteria: replace adjectives with categories, replace judgements with rules, replace descriptions with examples.

```python
# Vague — model guesses what "important" means
system = "Summarize this meeting and highlight the important parts."

# Explicit — model has rules, not adjectives
system = """Extract from this meeting transcript:
1. ACTION ITEMS: Any task assigned to a named person with a deadline.
   Skip if no assignee is named. Skip if no deadline is mentioned.
2. DECISIONS: Mark as FINAL only if the transcript records a vote or explicit approval.
   Mark as PROPOSED if discussed but not resolved.
3. Skip the first 5 minutes of casual conversation before the agenda begins."""
```

The same principle applies to severity calibration. "Critical means it will crash the system" forces the model to guess what crashing looks like. Showing it a concrete example removes the guess:

```python
system = """Classify bugs by severity using these examples:

CRITICAL — matches this pattern:
  query = f"SELECT * FROM users WHERE id = {user_input}"
  (unsanitized input in a database query)

MINOR — matches this pattern:
  def getUserName():  # should be get_user_name per convention
  (naming convention violation, no functional impact)"""
```

When false positives appear — the model flagging acceptable code as an issue — the fix is the same: add an explicit example of what is NOT a problem. Don't raise the confidence threshold. Confidence scores are poorly calibrated; the model can be 95% confident about a hallucination. Only the rules fix false positives.

## Failure 2: the model produces valid-looking JSON that doesn't parse

Prompt-based JSON extraction fails 5–20% of the time in production. The model drops a bracket, adds a trailing comma, or nests incorrectly. The failure rate is low enough that it passes initial testing and high enough that it breaks pipelines at scale.

The fix is `tool_use` with a JSON schema. This moves JSON generation from statistical (the model tries to format correctly) to constrained (the API enforces the schema):

```python
extract_invoice_tool = {
    "name": "extract_invoice",
    "description": "Extract structured data from an invoice document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "invoice_number": {"type": "string"},
            "vendor_name": {"type": "string"},
            "total_amount": {"type": "number"},
            "payment_terms": {"type": ["string", "null"]},  # nullable: may not exist
            "line_items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string"},
                        "amount": {"type": "number"}
                    },
                    "required": ["description", "amount"]
                }
            },
            "document_type": {
                "type": "string",
                "enum": ["invoice", "receipt", "credit_note", "unclear", "other"]
            }
        },
        "required": ["invoice_number", "vendor_name", "total_amount", "document_type"]
    }
}

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    tool_choice={"type": "tool", "name": "extract_invoice"},
    tools=[extract_invoice_tool],
    messages=[{"role": "user", "content": invoice_text}]
)
```

Two schema design decisions that matter:

**Optional/nullable fields prevent fabrication.** If `payment_terms` is required and the invoice doesn't have payment terms, the model fills it with something plausible. Make it nullable and the model returns `null` honestly. Required fields create pressure to invent.

**`"unclear"` and `"other"` in enums prevent forced classification.** Without them, the model must pick the closest category even when the document genuinely doesn't fit. An "unclear" option lets it say so. An "other" option paired with a freeform detail field captures edge cases your categories don't cover.

What `tool_use` does not fix: semantic errors. The schema guarantees structure, not correctness. The model can extract the wrong number into the right field, or swap two line items, and the schema will accept it. That requires the next fix.

## Failure 3: the output is structurally valid but semantically wrong

The math doesn't add up. Dates are in the wrong order. A value from page 3 is in a field for page 1 data. The JSON parses. The data is wrong.

These errors aren't fixable with a better prompt. They're fixable by detecting them and sending the model the specific error alongside the original document and its failed extraction:

```python
def validate_extraction(extracted: dict, raw_document: str) -> str | None:
    """Returns an error description if validation fails, None if valid."""
    if "line_items" in extracted and "total_amount" in extracted:
        calculated = sum(item["amount"] for item in extracted["line_items"])
        stated = extracted["total_amount"]
        if abs(calculated - stated) > 0.01:
            return (
                f"Line items sum to {calculated:.2f} but stated total is {stated:.2f}. "
                f"Either a line item is missing or the total is incorrect."
            )
    return None

def extract_with_retry(document: str, max_retries: int = 2) -> dict:
    result = extract_invoice(document)
    
    for attempt in range(max_retries):
        error = validate_extraction(result, document)
        if error is None:
            return result
        
        # Feed three things back: original document, failed extraction, specific error
        retry_response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            tool_choice={"type": "tool", "name": "extract_invoice"},
            tools=[extract_invoice_tool],
            messages=[{
                "role": "user",
                "content": (
                    f"Original document:\n{document}\n\n"
                    f"Your previous extraction:\n{json.dumps(result, indent=2)}\n\n"
                    f"Validation error: {error}\n\n"
                    f"Please re-extract, correcting this specific error."
                )
            }]
        )
        result = extract_tool_result(retry_response)
    
    return result
```

The three-part retry structure is load-bearing. "That was wrong, try again" produces the same wrong answer — the model doesn't know what to fix. The specific error message is what gives the model something to act on.

What retries cannot fix: information that isn't in the document. If the invoice doesn't have a purchase order number, no retry will produce one. When a field is genuinely absent, return null (if the schema allows it) or flag for human review. Distinguishing fixable errors from unfixable ones before retrying saves tokens and avoids retry loops that will always fail.

One schema pattern that catches errors before they reach the retry loop — ask the model to report both its calculation and the stated total, then compare:

```json
{
  "line_items_sum": {"type": "number", "description": "Sum of all line item amounts as calculated by you"},
  "stated_total": {"type": "number", "description": "Total amount as written in the document"},
  "totals_match": {"type": "boolean"},
  "conflict_detected": {"type": "boolean", "description": "True if document contains contradictory information"}
}
```

Discrepancy between `line_items_sum` and `stated_total` is a self-reported signal, not an inference. It's more reliable than asking the model whether it's confident.

## Failure 4: the model misses things in large reviews

You send a 14-file PR to Claude for review. The first three files get detailed, accurate feedback. By file 9, findings are shallow. By file 12, an obvious injection vulnerability is missed. File 14 gets two lines.

This isn't a model capability problem. It's attention dilution — a structural property of how transformers allocate attention across long contexts. Information in the middle of a long context consistently performs worse than information at the beginning or end, regardless of relevance. A larger context window doesn't fix it: the bottleneck is attention quality, not capacity.

The fix is architectural: per-file passes in parallel, then a single cross-file integration pass.

```python
async def review_pr(files: list[dict]) -> dict:
    # Pass 1: independent review of each file — full attention on one file at a time
    per_file_tasks = [
        client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": f"Review this file for bugs, security issues, and logic errors:\n\n{f['content']}"
            }]
        )
        for f in files
    ]
    per_file_results = await asyncio.gather(*per_file_tasks)

    # Pass 2: cross-file integration — one pass that sees only the summaries
    integration_review = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": (
                "Given these per-file findings, identify cross-file issues:\n"
                "- Data flow inconsistencies between modules\n"
                "- Contradictory patterns across files\n"
                "- API contract violations across service boundaries\n\n"
                f"Findings:\n{format_findings(per_file_results)}"
            )
        }]
    )
    return {"per_file": per_file_results, "integration": integration_review}
```

The parallel per-file calls are also where independent instances help. When the same model reviews its own generated code in the same session, it retains its reasoning context — why it chose each approach, what tradeoffs it considered. It's less likely to challenge decisions it already justified. A separate invocation evaluates the code without that bias.

For findings where the model is uncertain, route by calibrated confidence rather than raw confidence scores. Raw self-reported confidence is poorly calibrated — the model can be 95% confident about a hallucination. Calibrate thresholds by running labeled examples through the system and measuring where reported confidence actually correlates with accuracy:

```json
{
  "finding": "Potential race condition in order processing",
  "severity": "major",
  "confidence": 0.65,
  "reasoning": "Lock acquisition looks correct but unlock timing depends on an async callback whose ordering I cannot fully verify.",
  "route": "human_review"
}
```

## Failure 5: nightly eval runs cost too much to run at the right frequency

A thousand-document evaluation suite run synchronously costs full price and blocks your pipeline for hours. Teams either run evals less frequently than they should or spend more than necessary.

The fix is the Message Batches API: 50% cost reduction with up to 24-hour processing time. The right workloads are latency-tolerant — nightly reports, weekly audits, eval suites that don't need results immediately.

```python
import anthropic
import json

client = anthropic.Anthropic()

def submit_extraction_batch(documents: list[dict]) -> str:
    requests = [
        {
            "custom_id": doc["id"],  # used to match results to inputs
            "params": {
                "model": "claude-sonnet-4-6",
                "max_tokens": 1024,
                "tool_choice": {"type": "tool", "name": "extract_invoice"},
                "tools": [extract_invoice_tool],
                "messages": [{"role": "user", "content": doc["text"]}]
            }
        }
        for doc in documents
    ]
    
    batch = client.beta.messages.batches.create(requests=requests)
    return batch.id

def retrieve_batch_results(batch_id: str) -> dict:
    results = {}
    for result in client.beta.messages.batches.results(batch_id):
        if result.result.type == "succeeded":
            results[result.custom_id] = extract_tool_result(result.result.message)
        else:
            results[result.custom_id] = {"error": result.result.error}
    return results
```

The `custom_id` field is how you match results back to inputs. Batch results don't arrive in submission order.

Two constraints that determine whether batch is the right choice: no streaming (results arrive as a batch, not incrementally), and no mid-request tool calling (you can't define tools, wait for results, and continue the conversation within a single batch item). If your workflow requires an agentic loop — tool call, observe result, decide next action — use the synchronous API.

On scheduling: the batch API guarantees results within 24 hours but not faster. If your pipeline has a 30-hour SLA, submit the batch no later than 24 hours before the deadline. That leaves 6 hours of buffer for collection, validation, and operational delays.

Stacking with prompt caching: if your extraction prompt has a large, stable system prompt or tool schema, prompt caching on top of batch pricing can bring effective cost down significantly beyond the headline 50%. Cache the invariant parts; pay full price only for the document content that varies per request.

---

The pattern across all five fixes: each technique is the minimum viable response to a specific failure. Explicit criteria fix vague instructions. Structured schemas fix syntax errors. Retry-with-feedback fixes semantic errors. Multi-pass architecture fixes attention dilution. Batch API fixes eval cost. None of them are improvements to a working system — they're the reason a broken system starts working.

What I'm still unsure about: when retry-with-error-feedback genuinely outperforms blind retry with temperature variation. One 2025 arXiv paper found blind retries competitive on pure format errors. My instinct is that feedback wins when the error carries diagnostic signal (wrong field, math mismatch) and blind retry wins when it's pure formatting noise — but I haven't run this comparison cleanly on my own extraction workloads.
