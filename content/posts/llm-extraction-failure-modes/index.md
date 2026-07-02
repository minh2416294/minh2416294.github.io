---
title: "Fixing Common Failure Modes in LLM Extraction"
date: 2026-05-12
draft: false
tags: ["prompt-engineering", "structured-output", "llm-evaluation", "ai-engineering"]
summary: "Every prompt engineering technique exists because a specific failure mode forced it. Here's the failure taxonomy, not the technique list."
---

Most prompt engineering posts are structured as a technique list: here's few-shot, here's chain of thought, here's structured output. The techniques are useful, but what gets left out is the failure mode that makes each one necessary.

Here's the same material from the other direction.

## Failure 1: the model interprets vague instructions differently each run

You ask it to be conservative in the system prompt. It is conservative on Monday, liberal on Wednesday with the same input. You add "use your best judgement." Nothing changes

The model isn't aware of what you mean by conservative. It has to make an assumption based on context, which is different every time. Essentially, you're telling it to take a guess.

The solution is not using vague language. Operationalize your criteria. Instead of saying 'conservative', list out categories of things it should avoid. Instead of judgement calls, provide rules. Describe what you want, don't tell it how to think about what you want.

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

The same goes for severity. "Critical" means "it'll crash the system," the model will guess. Show it what crashing looks like:

```python
system = """Classify bugs by severity using these examples:

CRITICAL — matches this pattern:
  query = f"SELECT * FROM users WHERE id = {user_input}"
  (unsanitized input in a database query)

MINOR — matches this pattern:
  def getUserName():  # should be get_user_name per convention
  (naming convention violation, no functional impact)"""
```

When there are false positives – instances where the model raises alerts on acceptable code – the solution is to add additional examples of what is not a problem. Do not try to increase the confidence threshold; confidence scores are not calibrated, and the model can be 95% confident about a hallucination. Only explicit negatives help the model learn what is not acceptable.

## Failure 2: the model produces valid-looking JSON that doesn't parse

Prompt based JSON parsing fails 5-20% of the time in production. The model simply outputs malformed JSON due to missing brackets or extra commas. Not often enough to matter in unit tests, but frequently enough to cause significant issues downstream

The fix is to use `tool_use` with a JSON schema, which turns the unconstrained "the model tried its best" to the constrained "the API will parse this JSON".

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

Two design decisions that are important for this schema are:

**Optional/nullable fields prevent fabrication.** If the model believes the `payment_terms` are required and not present, it must invent some. By making the field nullable, the model is able to return null when there is no value.

**`"unclear"` and `"other"` in enums prevent forced classification.** By not including them, you're forcing the model to pick the closest possible category when it may not actually be the right one. Giving it an "unclear" option allows it to state that, while an "other" option along with a freeform field allows catching things that your categories don't explicitly have.

What `tool_use` is not addressing: semantic errors. The schema is only a structure check. The model could pluck the wrong number out of a field, or transpose two lines, and the schema would be satisfied. That needs the next fix.

## Failure 3: the output is structurally valid but semantically wrong

The math doesn't add up. The dates are out of order. The value from page 3 ends up in the page 1 data field. Your JSON parsed fine, but the data is wrong.

These errors are challenging to catch at the prompt stage. They're also simple to resolve if you can detect and return the model the specific error message along with the original document and failed extraction:

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

The three-level retry pattern is a bearer. "That was wrong, try again" the same wrong answer, the model has no idea what to fix. Only the message that describes the error gives the model a hint about what to do.

What retries are not suitable for is guessing information that is not in the document. If the invoice does not have a purchase order number, no amount of retries will make one appear. For each field, decide beforehand what to do if the information is not present. Return null if possible or send the marked-up result to a human for review. Spend less tokens by not retrying when you already know that nothing will change.

A schema that checks for possible errors before they occur is also good practice. One pattern that helps with that is asking the model to report both the calculated values and the values found in the text and comparing them:

```json
{
  "line_items_sum": {"type": "number", "description": "Sum of all line item amounts as calculated by you"},
  "stated_total": {"type": "number", "description": "Total amount as written in the document"},
  "totals_match": {"type": "boolean"},
  "conflict_detected": {"type": "boolean", "description": "True if document contains contradictory information"}
}
```

Discrepancy between `line_items_sum` and `stated_total` is a self-reported signal, not an inference. It's more reliable than asking the model whether it's confident or not.

## Failure 4: the model misses things in large reviews

You send a 14-file PR for review to Claude. It handles the first three accurately. By the 9th file, it gives shallow findings. By the 12th, it overlooks an obvious injection vulnerability. It only managed to give a two-liner on the 14th.

It has nothing to do with the model's capabilities; it has to do with dilution of attention - the inherent property of the transformer architecture to perform worse on information that is not at the extremes of the input. Performance on information "in the middle" is significantly worse than on information at the beginning or the end of the input, even if the information in the middle was more relevant. Bigger context windows do not alleviate this problem; it is a fundamental limitation of the attention-based architecture.

The solution is to process each file in parallel, then do a single cross-file pass, and then a single pass for each file again.

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

The parallel per-file calls are also where independent instances help. On their own models, they can review the code they produce in the same session, retaining the context of the reasoning they did for them and thus being less prone to questioning their decisions. A separate invocation would judge the code they produce without this possible bias

For findings where the model is unsure, use calibrated confidence thresholds rather than relying on the model’s self-reported confidence. The model’s self-reported confidence is most likely not calibrated, as it has incentive to be overly confident. This can be calibrated by running examples through the model where you know the answer and observing what confidence thresholds correspond to the model producing correct results.

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

The fix is the Message Batches API: 50% cost reduction with up to 24h processing time. The right workloads are latency-tolerant: reports, weekly audits, eval suites fit for asynchronous processing.

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

The `custom_id` field is what you use to associate results with inputs, but note that you can't rely on results coming back in the same order as you sent them.

Two hard constraints to consider when choosing between batch vs streaming APIs: absence of streaming (results come back as a whole set, not incrementally), and absence of mid-request tool calling (no possibility to define tools externally, get results, and proceed to the next turn). So for any agentic-style loop of "tool call -> observe -> next step," you'd want to use the synchronous API.

On scheduling: The batch API has a 24-hour SLA but no upper bound, so if you have a 30-hour SLA for processing, you can schedule the batch no later than 24 hours before the deadline. This leaves you with a 6-hour buffer for collection, validation, and other operations.

Coupling with prompt caching:

If you have a large system or tool schema for extraction prompts, prompt caching on top of batch pricing can give you much better value than the advertised 50%+ savings for caching. You want to design your prompts so that the invariant part (large system message/tool schema) is cached, and the varying part (document contents) is charged at the lower per-token rate.

---

The common theme in all five fixes seems to be a repair rather than optimization: Each of these techniques was introduced as a minimal viable response to a failure mode rather than an enhancement to an existing model. Explicit criteria fix vague instructions, structured schemas fix syntactic chaos, retry-with-feedback fixes semantic slips, multi-pass architecture fixes inattention, and batch API fixes evaluation budget waste. There is nothing wrong with any of these approaches per se, but none would be necessary in a well-designed system.

What I'm curious about is how much better retry-with-error-feedback was compared to blind retries with temperature adjustment. There was a paper on arXiv in 2025 that demonstrated blind retries to be competitive on purely syntactic errors like formatting. My hypothesis is that error feedback helps more when the model makes systematic mistakes (wrong field name, incorrect math operation) rather than superficial slips (badly formatted JSON), but I need to benchmark this hypothesis against my own extraction pipelines.

Thank you so much for reading this. If you interested, please reach out to me at my [X/Twitter](https://x.com/tbmkunn_) or [Reddit](https://www.reddit.com/user/Maleficent_Train1207/)