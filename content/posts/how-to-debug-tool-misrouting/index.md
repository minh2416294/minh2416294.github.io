---
title: "how to debug tool misrouting in LLM agents"
date: 2026-04-10
draft: false
tags: ["agents", "tool-design", "mcp", "ai-engineering"]
summary: "Everyone says 'fix your tool descriptions.' Nobody shows how to diagnose which specific failure caused the misroute."
---

The agent called the wrong tool. The usual advice is: improve your descriptions. That's correct but useless without a way to diagnose *which part* of the description failed and why.

There are five specific interface failures that cause misrouting. Once you know which one you're looking at, the fix is obvious. Without that diagnosis, you're guessing.

## The five failure patterns

**1. Missing selection scope.** The description explains what the tool does but not when to use it versus a similar tool. The model has to infer the boundary from context, and it guesses wrong.

```python
# Causes misrouting between get_customer and lookup_order
"get_customer": "Retrieves customer information"
"lookup_order":  "Retrieves order information"

# Fixed — explicit boundary in both descriptions
"get_customer": (
    "Looks up a customer account by email, phone, or customer ID. "
    "Returns profile: name, contact details, account status, loyalty tier. "
    "Use this to verify WHO the customer is. "
    "Do NOT use for order-specific queries — use lookup_order for those."
)
"lookup_order": (
    "Looks up a specific order by order ID or tracking number. "
    "Returns order status, line items, shipping details, and history. "
    "Use this when the query is about an ORDER, not the customer account. "
    "Do NOT use this to verify customer identity — use get_customer first."
)
```

The fix is mutual: each description must reference the other and state when NOT to use it. One-sided clarification doesn't work because the model compares descriptions simultaneously when choosing.

**2. Undescribed output.** The description says what the tool takes but not what it returns. The model can't predict whether the tool will give it what it needs for the next step, so it may route elsewhere or call unnecessarily.

```python
# Model doesn't know what it gets back
"search_orders": "Searches orders by customer"

# Model knows exactly what to expect
"search_orders": (
    "Searches all orders for a customer by customer ID. "
    "Returns: list of order IDs, statuses, total amounts, and creation dates. "
    "Does NOT return line items or shipping details — use get_order_detail for those."
)
```

Output descriptions are load-bearing for sequential tool calls. If the model doesn't know what step 1 returns, it can't plan step 2.

**3. Unconstrained parameters.** Optional fields with no guidance on when to use them make every call slightly unpredictable. The model fills optional fields by inference, which is inconsistent.

```python
# Model guesses when to use `include_history`
"get_customer": {
    "properties": {
        "customer_id": {"type": "string"},
        "include_history": {"type": "boolean"}  # when? why?
    }
}

# Model knows exactly when to set it
"get_customer": {
    "properties": {
        "customer_id": {
            "type": "string",
            "description": "Customer ID in format C-NNNNN (e.g. C-48291)"
        },
        "include_history": {
            "type": "boolean",
            "description": (
                "Set true only when the user specifically asks about "
                "past orders or account history. Defaults to false. "
                "Setting true increases response size significantly."
            )
        }
    }
}
```

**4. Cross-tool dependency leakage.** Tool A's description implies it can do something that actually requires calling Tool B first. The model calls A expecting a result that A can't produce alone.

```python
# Implies identity verification is part of the refund call
"process_refund": "Processes a refund for a verified customer"

# States the dependency explicitly
"process_refund": (
    "Processes a refund for a specific order. "
    "REQUIRES: get_customer must have been called first in this session "
    "to verify customer identity. Will fail with a permission error if called "
    "without prior identity verification."
)
```

**5. System prompt conflicts.** A keyword in the system prompt creates an unintended tool association that overrides a well-written description. This one is invisible until you look for it.

If the system prompt says "always check customer details before processing a request," the word "customer" becomes a routing signal. The model may associate any customer-related query with `get_customer` regardless of what the tool descriptions say. After updating tool descriptions, always audit the system prompt for keywords that could silently override them.

## Diagnosing which failure you have

When a misroute happens in production, the debugging sequence is:

1. Pull the full prompt that was sent — system prompt, tool definitions, conversation history.
2. Look at which two tools were candidates for the routing decision.
3. Read both descriptions as if you're the model: could you tell which one to call from the description alone, without knowing what the user asked?
4. If no, you have failure pattern 1 (missing selection scope).
5. If yes, check whether the model needed the output of the chosen tool for its next planned step. If the output description was missing, you have pattern 2.
6. Check the system prompt for keyword overlap with tool names. If found, pattern 5.
7. If none of the above, look at what optional parameters were passed — pattern 3.
8. If the model called the right tool but with wrong expectations about prerequisites, pattern 4.

This takes ten minutes. It's faster than adding few-shot examples, which treats the symptom. It's much faster than adding a routing classifier, which adds infrastructure around a fixable description problem.

## Error responses are a contract, not a fallback

The second most common failure mode after misrouting: the agent calls the right tool, gets an error, and makes the wrong recovery decision because the error gave it nothing to work with.

There are four error categories, and each implies a different recovery path. The category must be in the response — not as prose for a developer to read, but as a structured field the agent reads at runtime.

```python
def make_error(category: str, message: str, description: str, retryable: bool) -> dict:
    return {
        "isError": True,
        "content": [{"type": "text", "text": message}],
        "errorCategory": category,   # "transient" | "validation" | "business" | "permission"
        "isRetryable": retryable,
        "description": description,
    }

# Transient — retry after delay
make_error(
    "transient",
    "Order database temporarily unavailable",
    "High load on order service. Request is valid — retry in 2-3 seconds.",
    retryable=True,
)

# Validation — fix the input and retry
make_error(
    "validation",
    "Invalid order ID format",
    "Order ID must be in format #NNNNN (e.g. #12345). Received: 'order-abc'.",
    retryable=True,
)

# Business — do NOT retry, take an alternative path
make_error(
    "business",
    "Refund exceeds automatic limit",
    "Refund of £750 exceeds the £500 automatic limit. Escalate to a human agent.",
    retryable=False,
)

# Permission — escalate or use different credentials
make_error(
    "permission",
    "Access denied to financial records",
    "Current service account lacks financial access. Escalate to a senior agent.",
    retryable=False,
)
```

The `isRetryable` field is the key branch point. Transient and validation errors are retryable — the same request can succeed on retry (after a delay, or after fixing the input). Business and permission errors are not — retrying will always produce the same failure. The agent must take a different path.

The failure mode that trips teams most often: an empty result from a successful query vs. an access failure. These look identical without explicit structure.

```python
# Valid empty result — NOT an error, agent should stop searching
{
    "isError": False,
    "content": [{"type": "text", "text": "No orders found for customer C-48291 in the last 90 days."}],
    "resultCount": 0
}

# Access failure — IS an error, agent should decide whether to retry
{
    "isError": True,
    "content": [{"type": "text", "text": "Could not reach order database"}],
    "errorCategory": "transient",
    "isRetryable": True,
    "description": "Connection timed out after 5s. Query did not execute."
}
```

If the tool returns an empty list on access failure, the agent concludes "no orders found" and moves on. The coordinator gets an incomplete result and doesn't know why. This is silent failure — worse than a visible error because the downstream output looks correct.

## Tool scoping: the count matters before the schemas do

Before fixing descriptions, fix the number of tools. A single agent with 18 tools degrades selection reliability regardless of how good the descriptions are — the model spends more attention on tool selection itself and less on the task.

The reliable range is 4–5 tools per agent, scoped to that agent's specific role. In a multi-agent research system:

| Agent | Tools |
|---|---|
| Web Search | `search_web`, `fetch_page`, `extract_links`, `save_snippet` |
| Document Analysis | `extract_metadata`, `extract_data_points`, `summarize_content`, `verify_claim` |
| Synthesis | `compile_report`, `verify_fact`, `format_citation`, `assess_coverage` |
| Coordinator | `Agent` (spawn subagents), `review_output`, `request_revision` |

Each agent gets exactly what it needs for its defined role. The coordinator never sees `search_web`. The web search agent never sees `compile_report`. This isn't just good architecture — it's what makes per-agent description optimization tractable. You can't write precise selection-scope boundaries when the same tool appears in six agents with different contexts.

When a subagent occasionally needs a capability that belongs to another role, the answer is a scoped cross-role tool — a constrained version given directly to the agent that needs it, rather than routing through the coordinator for every call.

```python
# Generic tool — enables misuse, unclear purpose
{"name": "fetch_url", "description": "Fetches any URL and returns content"}

# Scoped alternative — constrained to legitimate use, purpose is unambiguous
{
    "name": "load_document",
    "description": (
        "Fetches a document from an approved internal URL and returns its text content. "
        "Only accepts URLs from docs.company.com and wiki.company.com. "
        "Use this to load source documents for analysis. "
        "Do NOT use for external URLs — use search_web for external content."
    )
}
```

## MCP configuration: scope at the server boundary first

MCP tool scoping operates at two levels. Most engineers scope at the tool level (which tools to give each agent). The more leveraged decision is at the server level: which MCP servers activate for a given context.

Project-level configuration belongs in `.mcp.json` at the repo root — version-controlled, shared with the team:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "${GITHUB_TOKEN}"}
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "@community/mcp-server-jira"],
      "env": {
        "JIRA_URL": "${JIRA_URL}",
        "JIRA_TOKEN": "${JIRA_TOKEN}"
      }
    }
  }
}
```

The `${VARIABLE_NAME}` syntax keeps credentials out of version control. Each developer sets their own tokens locally. The config file commits safely; the secrets never enter repo history.

Personal or experimental servers go in `~/.claude.json` — not version-controlled, not shared. Use it for servers you're testing before proposing to the team, or integrations that are specific to your local setup.

When an MCP tool has a sparse description, the agent will prefer built-in tools even when the MCP tool is more capable. The fix is the same as for custom tools: add selection scope, output description, and explicit boundaries. The source of the tool — built-in or MCP — doesn't change what the description needs to contain.

## The ordering that saves the most time

When debugging a failing agent, check in this order:

1. **Tool count** — more than 5 tools per agent? Scope first.
2. **Description quality** — missing selection scope, output description, or parameter constraints?
3. **System prompt conflicts** — keyword overlap with tool names?
4. **Error structure** — are errors returning `isError` and `errorCategory`, or just text?
5. **Cross-tool dependencies** — are prerequisites documented in the downstream tool's description?

Few-shot examples don't belong on this list as a first step. They add token overhead without addressing why the model is confused. A routing classifier belongs even further down — it's infrastructure overhead for what is usually a description problem solvable in ten minutes.

What I'm still unsure about: at what tool count the degradation becomes sharp enough to matter in practice. The 4–5 figure comes from practitioner experience, not a published benchmark on a specific model family. I'd want to see this tested on current models before treating it as a hard constraint rather than a useful heuristic.
