---
title: "Hello, world"
date: 2026-05-10
draft: false
tags: ["meta", "hugo"]
math: true
mermaid: true
summary: "First post — confirms code, math, and diagram rendering."
---

This is the first post on the site. It exists to confirm that code blocks, math, and diagrams all render correctly.

```python
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))
```

A famous identity: $E = mc^2$.

A closed-form sum:

$$\sum_{i=1}^n i = \frac{n(n+1)}{2}$$

A simple flow diagram:

```mermaid
graph TD
  A[Write markdown] --> B[Hugo build]
  B --> C[Static HTML]
```
