---
title: "your RAG eval is lying to you"
date: 2026-04-01
draft: true
tags: ["rag", "retrieval", "llm-evaluation", "ai-engineering"]
summary: "A 0.91 faithfulness score doesn't mean your RAG pipeline works. Most eval panels can't see the layer that's actually broken."
---

My RAG pipeline had a faithfulness score of 0.91. Users were still getting wrong answers.

It took two weeks to figure out why. The short version: I was measuring the wrong thing. The retriever was returning plausible-looking chunks that didn't contain the actual answer. The generator was faithfully summarizing those chunks. Every metric said the system was working. The system was not working.

Here's what I learned about where RAG actually breaks, and how to see it.

## The metric most teams track, and what it misses

Faithfulness measures whether the generated answer is grounded in the retrieved context. It's a generation-side metric. A high faithfulness score means the model isn't hallucinating relative to what it was given.

It says nothing about whether what it was given was correct.

The metric you also need is **context recall**: the fraction of ground-truth answer content that actually appeared in the retrieved chunks. If context recall is low, it doesn't matter how faithful the generator is — it's faithfully summarizing the wrong material.

Most teams run faithfulness. Almost nobody runs context recall at launch. The failure mode is invisible until users start complaining.

```
What most eval panels look like:
  ✓ Faithfulness      (is the answer grounded in context?)
  ✓ Answer relevance  (does the answer address the question?)
  ✗ Context recall    (did retrieval surface the right content?)
  ✗ Context precision (how much retrieved content was actually useful?)
```

The top two metrics live on the generation side. The bottom two live on the retrieval side. If you only run the top two, you have no visibility into whether your retriever is working.

## Why retrieval fails silently

A retriever can fail in ways that look like success.

Consider a query like "What are the termination clauses in the ACME contract?" Your retriever returns chunks about termination — but from the wrong contract, or from a general policy document instead of the specific filing. The chunks are semantically relevant to "termination clauses." The cosine similarity scores are high. The reranker promotes them confidently.

The generator produces a fluent, grounded answer about termination clauses. Faithfulness: 1.0. The answer is wrong.

This is the retrieval recall vs. end-to-end accuracy gap. A 2026 analysis of chunking strategies found that semantic chunking achieved 91.9% retrieval recall — but only 54% end-to-end accuracy on the same benchmark. The retriever was surfacing relevant-looking material. The answers were still wrong, because chunks averaged 43 tokens — too small to contain a complete, usable answer.

High retrieval recall does not imply high answer quality. They are different things, measured differently, and optimizing one does not move the other.

## The layered failure taxonomy

Before you can fix a RAG pipeline, you need to know which layer broke. There are four, and they fail independently:

**Layer 1 — Chunking.** Chunks are too small (context rot: the answer is split across chunk boundaries), too large (the retrieved chunk contains the answer but also 800 tokens of noise that dilutes it), or structured incorrectly for the document type (tables embedded in PDFs parsed as garbled text).

**Layer 2 — Retrieval.** The embedding model captures semantic similarity but misses exact matches. A query for "Section 4.2(b)" retrieves conceptually related content instead of the literal clause. BM25 handles this; dense embeddings often don't. A 2026 peer-reviewed study on financial documents found BM25 outperformed `text-embedding-3-large` on numeric and citation-heavy queries — and that table structure mismatch accounted for 73% of retrieval failures in that corpus.

**Layer 3 — Context assembly.** Retrieved chunks arrive without the context that makes them interpretable. A chunk reading "revenue grew by 3% over the previous quarter" is ambiguous without knowing which company, which quarter, and what the baseline was. Traditional RAG strips this context at chunking time and never recovers it.

**Layer 4 — Generation.** The model hallucinates, refuses, or misinterprets even when given good context. This is the layer most teams blame first. It's usually the last place the real problem lives.

## What contextual retrieval actually fixes (and what it doesn't)

Anthropic's contextual retrieval prepends LLM-generated context to each chunk before embedding and BM25 indexing:

```python
CONTEXT_PROMPT = """
<document>
{whole_document}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{chunk_content}
</chunk>

Give a short succinct context to situate this chunk within the overall document
for the purposes of improving search retrieval. Answer only with the context.
"""

def contextualize_chunk(document: str, chunk: str, client) -> str:
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=100,
        messages=[{
            "role": "user",
            "content": CONTEXT_PROMPT.format(
                whole_document=document,
                chunk_content=chunk
            )
        }]
    )
    return f"{response.content[0].text}\n\n{chunk}"
```

The resulting chunk becomes:

```
This chunk is from ACME Corp's Q2 2023 SEC filing. The previous quarter's
revenue was $314 million.

The company's revenue grew by 3% over the previous quarter.
```

Anthropic reports this reduces retrieval failures by 49% combined with BM25, and 67% with reranking added. At $1.02 per million document tokens with prompt caching, it's cheap enough to run on most corpora.

What it fixes: Layer 3. Chunks are no longer context-free.

What it doesn't fix: chunking boundaries (Layer 1), domain-specific retrieval failures like table parsing (Layer 2), or generation quality (Layer 4). It's one fix for one layer.

## The hybrid retrieval floor

If you're running pure dense vector search, you have a known gap: exact matches, technical identifiers, and numeric queries. BM25 handles these by matching terms directly rather than semantically.

The production floor for retrieval is hybrid: dense embeddings for semantic similarity, BM25 for lexical precision, results combined with Reciprocal Rank Fusion:

```python
from rank_bm25 import BM25Okapi

def hybrid_search(
    query: str,
    chunks: list[str],
    embeddings: list[list[float]],
    query_embedding: list[float],
    top_k: int = 20,
    semantic_weight: float = 0.7,
) -> list[tuple[str, float]]:
    # BM25 lexical scores
    tokenized = [c.split() for c in chunks]
    bm25 = BM25Okapi(tokenized)
    bm25_scores = bm25.get_scores(query.split())

    # Dense cosine scores
    import numpy as np
    emb_matrix = np.array(embeddings)
    q_vec = np.array(query_embedding)
    cosine_scores = (emb_matrix @ q_vec) / (
        np.linalg.norm(emb_matrix, axis=1) * np.linalg.norm(q_vec) + 1e-9
    )

    # Reciprocal Rank Fusion
    def rrf_rank(scores, k=60):
        ranked = np.argsort(scores)[::-1]
        return {idx: 1 / (k + rank + 1) for rank, idx in enumerate(ranked)}

    bm25_rrf = rrf_rank(bm25_scores)
    cosine_rrf = rrf_rank(cosine_scores)

    fused = {}
    for idx in range(len(chunks)):
        fused[idx] = (
            semantic_weight * cosine_rrf.get(idx, 0)
            + (1 - semantic_weight) * bm25_rrf.get(idx, 0)
        )

    top_indices = sorted(fused, key=fused.get, reverse=True)[:top_k]
    return [(chunks[i], fused[i]) for i in top_indices]
```

This isn't a silver bullet. On most general-purpose corpora, hybrid modestly outperforms either method alone. On specific document types — financial tables, legal citations, code — the gap is large enough to matter.

## The eval panel that actually catches failures

The minimum viable eval panel for a RAG system in production:

```python
from ragas import evaluate
from ragas.metrics import (
    faithfulness,        # generation: is answer grounded in context?
    answer_relevancy,    # generation: does answer address the question?
    context_recall,      # retrieval:  did we surface the right content?
    context_precision,   # retrieval:  how much retrieved content was useful?
)

results = evaluate(
    dataset=eval_dataset,
    metrics=[faithfulness, answer_relevancy, context_recall, context_precision],
)
```

Thresholds worth targeting before shipping:

| Metric | Minimum bar |
|---|---|
| Faithfulness | > 0.85 |
| Answer relevancy | > 0.80 |
| Context recall | > 0.75 |
| Context precision | > 0.70 |

If faithfulness is high but context recall is low, your retriever is broken, not your generator. Fix chunking and retrieval before touching the prompt.

If context precision is low, your retrieved chunks contain too much noise. Consider a reranker, tighter chunk boundaries, or both.

## What I'd do differently

Start with the eval panel, not the pipeline. Define what "working" means in terms of all four metrics before writing any retrieval code. The layer you can't measure is the layer you'll debug for weeks.

And treat chunking as a first-class engineering decision, not a default. The chunk size and strategy that works for a markdown documentation site will not work for a PDF of financial tables. The document type determines the chunking approach, not the framework default.

What I'm still unsure about: whether contextual retrieval's LLM-generated context adds noise when the chunk is genuinely self-contained — a short factual sentence, say. The context prepend might hurt precision on chunks that didn't need enriching, and I haven't found a clean way to detect that at indexing time.
