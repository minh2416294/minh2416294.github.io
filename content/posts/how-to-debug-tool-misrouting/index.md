---
title: "how I debug tool misrouting in LLM agents"
date: 2026-04-10
draft: false
tags: ["agents", "tool-design", "mcp", "ai-engineering"]
summary: "Everyone says 'fix your tool descriptions.' Nobody shows how to diagnose which specific failure caused the misroute."
---

The agent used the wrong tool, and the standard response is to say that the problem was due to vague description and tell the agents to improve their descriptions. This advice may be correct, but it does not give a clear idea of what exactly should be improved because, in this case, the error was in the wrong tool choice.

Five types of interface design failures can lead to this type of mistake, and only after these causes are identified can the correction be developed. Therefore, without proper diagnostics, the problem cannot be solved correctly.

## The five failure patterns

**1. Lack of scope of selection**. The description indicates what the tool does but not when it should be used over the similar one in the list. The model has to guess the scope of selection based on the context but it fails to do so.

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

**2. Undescribed output**. The text describes only the inputs to the tools, not the outputs. As a result, the model can't determine whether a tool will provide the needed information for the next step and, therefore, may select an irrelevant tool or call it anyway.

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

**3. Unconstrained parameters**. Optional fields with no guidance on when to use them make every call slightly unpredictable. The model fills optional fields by inference, which is inconsistent.

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

**4. Cross-tool dependency leakage**. Description of tool A suggests that it can perform a task which actually requires invoking tool B first. In the model A is called expecting it to return a certain result, but it cannot do this on its own.

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

If the system prompt says something like "always check customer details before processing a request", then the word "customer" becomes a signal for the model to use the get_customer tool. It can happen that you add a new customer-related tool, but the model ignores it and always uses get_customer instead. After updating the tool descriptions, make sure to check the system prompt for any such "override" terms

## Diagnosing which failure you have

When a misroute has occurred in production, the debugging proceeds in the following order:

1. Examine the full prompt as it was inputted into the model, including the system prompt, the tool descriptions, and the conversation history.
2. Identify the two tools that the model had to choose between.
3. As the model, try to understand which of the two tools to pick based on their description alone, without the context of the user question.
4. If not possible, you are dealing with failure pattern 1 (selection scope not specified).
5. Otherwise, proceed to determine whether the model would have needed the output of the selected tool to proceed to the next step. If the tool description did not specify this, you are dealing with pattern 2.
6. Check the system prompt for keyword overlap with tool names. If found, pattern 5.
7. If none of the above, examine the optional parameters that were passed to the tool, if any. You are likely dealing with pattern 3.
8. Otherwise, if the model used the correct tool but with incorrect assumptions about what it would return, it is probably pattern 4.

This process takes about ten minutes. It is faster than adding few-shot examples to the prompt, which only addresses the symptom, not the cause. It is also much faster than building a separate routing classifier, which would add an unnecessary layer of complexity to the system.

## Error responses are a contract, not a fallback

The second most common failure mode once you've routed to the right tool is that the agent recovers incorrectly from an error that happened during tool use, causing it to make the wrong decision. The problem is that the error gave the agent no information to work with.

There are 4 error categories, and each one implies a different way of recovering from the error. The category needs to be in the response, not as a comment for the developer to read, but as data the agent can read at runtime.

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

The `isRetryable` field is the one, at which the implementation usually branches out. Transient and validation errors are retryable, i.e., the same request is likely to succeed on a retry (after some time elapses, or the input is fixed). By contrast, business and permission errors are not retryable, as the request is doomed to fail on retry. The agent has to choose different branches of execution based on this information.

The failure mode, which most often leads to confusion, is the empty result of a successful query vs. an inaccessible query. Without some additional conventions, these two cases are not different from each other.

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

If the tool returns an empty list upon a failed access attempt, the agent assumes there are no orders and proceeds. The coordinator then receives an incomplete set of results with no indication of the issue, resulting in silent downstream failures that are harder to detect than outright errors.

## Tool scoping: the count matters before the schemas do

Before optimizing the descriptions for the tools, adjust their quantity: an agent with 18 tools to choose from has worse selection reliability than one with fewer, even if the descriptions are perfectly accurate, since the model must spend more time thinking about how to choose rather than doing the task.

Aim for 4-5 tools per agent, narrowed down to what makes sense for that agent's specialization. For a multi-agent research system, this might look like:

| Agent | Tools |
|---|---|
| Web Search | `search_web`, `fetch_page`, `extract_links`, `save_snippet` |
| Document Analysis | `extract_metadata`, `extract_data_points`, `summarize_content`, `verify_claim` |
| Synthesis | `compile_report`, `verify_fact`, `format_citation`, `assess_coverage` |
| Coordinator | `Agent` (spawn subagents), `review_output`, `request_revision` |

Each agent is provided with exactly the capabilities that it needs to fulfill its designated role. The coordinator agent has no access to the `search_web` tool. The web search agent has no access to the `compile_report` tool. This is good design, but more importantly, this is a prerequisite for per-agent description optimization. You cannot define selection-scope boundaries cleanly if the same tool is used in six different ways by six different agents.

When a subagent sometimes needs a capability controlled by another role, we can grant the capability in a limited way to the subagent, using a scoped cross-role tool (see fig. 2). A scoped cross-role tool is a cross-role tool that grants capability only to one particular subagent, and only in certain contexts (such as when invoked by the subagent), instead of being generally available to whoever chooses to invoke it.

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

MCP tool scoping takes place at two levels. Most teams configure tools at the tool level: that is, which tools to grant access to which agents. Less obvious but much more impactful is the configuration at the server level: which MCP servers are enabled for a given context.

Project level configuration goes in the `.mcp.json` file at a repo's root, under version control and shared by all developers, and looks approximately like this:

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

The `${VARIABLE_NAME}` syntax allows to keep credentials in environment outside of version control. Every developer maintains their own tokens locally, while the config file committed to repository remains clean from any secrets.


You could store personal or experimental servers in the `${HOME}` directory at `~/.claude.json` , as this file is neither committed to repository, nor shared between collaborators. This is useful for servers that you are planning to propose for others' adoption later, but currently test on local or have some personal preferences.

When you have an MCP tool with sparse description, the agent will favor built-in tools over MCP ones, since they are more reliable. However, the solution is the same as with custom tools: provide selection scope, output description and explicit boundaries. The fact that a tool is built-in or external doesn't impact its description and capabilities.

## The ordering that saves the most time

I was going to put few shot examples on this list too, but examples are a liability in the first place. They burn tokens, and don't diagnose the real issue. The routing classifier comes lower down on my list because it's an infra cost for an edge case that ought to be described in ten minutes.

The only thing I'm not so sure about is the cutoff. Why four or five? The numbers sound right to me as a practitioner, but there's no particular reason to believe they're ideal for any particular model class. I'd love to see this explored on modern language models.

When debugging a misbehaving agent you should first check

1. the number of tools per agent (scope creep if it's over 5),
2. absence of selection scope, output description, or parameter constraints,
3. collisions between the system prompt and tool names,
4. improper error returns,
5. the presence of prerequisites in a downstream tool's description.