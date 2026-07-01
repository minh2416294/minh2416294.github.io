---
title: "Pitfalls in RAG Evaluation"
date: 2026-04-01
draft: false
tags: ["rag", "retrieval", "llm-evaluation", "ai-engineering"]
summary: "A 0.91 faithfulness score doesn't mean your RAG pipeline works. Most eval panels can't see the layer that's actually broken."
---

My RAG pipeline had a faithfulness score of 0.91 - but users were getting incorrect answers.

It took me two weeks to realize what the problem was. In short, I was evaluating the wrong thing - the retriever was confidently returning “plausible” chunks of text that didn’t include the answer, and the generator was faithfully summarizing those chunks. Everything looked correct according to standard evaluation metrics - but the system wasn’t actually working correctly.

Below are some insights on where RAG pipelines can fail, and how to spot those failures.

## The metric most teams track, and what it misses

Faithfulness measures whether the generated answer is consistent with the retrieved context. It's a generation-side metric, and a good faithfulness score indicates that the model isn't hallucinating compared to the retrieved documents.

It says nothing about whether those retrieved documents are accurate compared to ground-truth answers. The metric you actually want to look at is context recall: the ratio of ground-truth answer content that appears in the retrieved chunks. If context recall is low, it doesn't matter how faithful the generation is- your model is faithfully summarizing the wrong documents.

Most teams measure faithfulness on generation. Few measure context recall on retrieval at all, and the failure mode is often not obvious until users complain.

```
What most eval panels look like:
  ✓ Faithfulness      (is the answer grounded in context?)
  ✓ Answer relevance  (does the answer address the question?)
  ✗ Context recall    (did retrieval surface the right content?)
  ✗ Context precision (how much retrieved content was actually useful?)
```

The top two are on the generation side; the bottom two are on the retrieval side. If you just run the top two, you can’t assess if your retriever is working properly.

## Why retrieval fails silently

A retriever can fail in a way that makes it appear to succeed. Imagine asking a question about a contract, for example, "What are the termination clauses in the ACME contract?"

Your retriever returns chunks of text that happen to mention termination clauses, but from a different contract or a generic policy file. Your chunks have high relevance to your query in terms of semantic similarity or even keyword matching. Your reranker confidently promotes these false positives.

Your generator produces a coherent answer about termination clauses using the retrieved documents. Your faithfulness metric is 1.0 because the generator didn't hallucinate. However, you are still wrong.

This is the retrieval recall versus end-to-end accuracy problem. The evaluation of chunking methods in 2026 demonstrates the issue well. The best method achieves 91.9% retrieval recall but only 54% end-to-end accuracy on the benchmark. Even though the retriever retrieved many relevant chunks, the answers were wrong because the chunks were too small to contain a full answer. On average, each retrieved chunk consisted of only 43 tokens.

In short, high retrieval recall is not necessarily indicative of high end-to-end accuracy. The two metrics are fundamentally different, and optimization for one does not imply optimization for the other.

## The layered failure taxonomy

Before you can fix a RAG pipeline, you have to know which one is broken. There’s four possible layers, each of which can be broken in different ways.

**Layer 1 — Chunking.** The chunks are too small (context rotation: the answer is in another chunk) , too big (retrieved chunk contains the answer but also 800 irrelevant tokens which suppress it) or of the wrong structure (tables embedded in PDFs parsed as text)

**Layer 2 — Retrieval.** The dense vectors capture semantic similarity but not verbatim matches which is critical for queries like”Section 4.2(b)” which traditional IR models like BM25 capture better than embeddings (A 2026 pior art study on financial documents found BM25 outperformanced text-embedding-3-large on numeric and citation queries by a statistically significant margin). Table structure mismatches were the cause of 73% of retrieval failures in that domain.

**Layer 3 — Context assembly.** Context is lost around retrieved chunks: If a chunk says “revenue grew by 3% over the previous quarter” the model has no way of knowing which revenue, which quarter or which comparison it is referring to since that information was trimmed during chunking. This renders the chunk effectively useless as the model cannot determine what the actual fact even is.

**Layer 4 — Generation.** The model hallucinates, refuses to answer or misconstrues the context. This is the easiest layer to blame but the last to investigate since it is rare that the actual problem is in this layer.

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

Anthropic reports that this reduces retrieval failures by an average of 49% with BM25 and 67% with BM25 plus reranking on their benchmark. With a cost of $1.02 per million document tokens with prompt caching, it can be afforded on most corpora.

This only fixes layer 3. Chunks are now not context-free.

It does not address layer 1 (chunking boundaries), layer 2 (domain-specific issues such as table parsing), or layer 4 (generation) – only one type of issue in one layer.

## The hybrid retrieval floor

If you are doing pure dense vector search, you know what you are missing: exact matches, identifiers and numeric queries. In BM25, these things are matched directly via tokens.

The production floor is therefore hybrid: dense for semantics, BM25 for identifiers, combined by Reciprocal Rank Fusion:

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

This isn't a silver bullet. On a general set of corpora, hybrid approaches are modestly better than either method alone. But on certain classes of documents - tables in financial reports, legal citations, computer code - the improvements are spectacular.

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

If your context precision is low, your retrieved chunks are too noisy. Try a reranker, or smaller chunks, or both.

## What I'd do differently

Start from the eval panel, not the pipeline. Know what "working" means in terms of all four metrics before writing any retrieval code. The layer you cannot measure yourself will become the layer you waste weeks chasing ghosts in production.

And really think through chunking as an engineering decision, not a default. The chunk size and strategy will vary wildly depending on the document type. Markdown pages, PDFs of SQL queries, or scanned financial tables will need different treatment at chunking time.

The thing I'm still not sure of is whether contextual retrieval's LLM-generated context is adding noise to the signal, if the chunk was self-contained. Say, if the chunk has a single factual answer, the prepend context makes its precision artificially low, but you can't know that at indexing time.