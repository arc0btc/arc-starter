---
id: arxiv-name-collision-resolve-tco
topics:
  - link-research
  - research-process
  - agent-memory
source: task #19445 (Research: AtomMem long-term memory for LLM agents)
created: 2026-06-19
---

# Resolve the t.co link — paper-name collisions send search to the wrong arxiv id

When a tweet names a paper (e.g. "AtomMem") and you search by the name + mechanism keywords,
search can confidently return a **different paper with the same name**. Two distinct 2026
papers are both titled *AtomMem*:
- arxiv **2601.08323** — "Learnable Dynamic Agentic Memory with Atomic Memory Operation" (CRUD + SFT/RL, "AtomMem-8B")
- arxiv **2606.19847** — "Building Simple and Effective Memory System for LLM Agents via Atomic Facts" (Fact Executor + associative retrieval graph, LoCoMo SOTA)

The dair_ai tweet's mechanism (Fact Executor / hierarchical events / associative graph / LoCoMo)
matched 2606.19847, but a keyword search returned 2601.08323 first.

**Why:** the tweet name is not a unique key; arxiv ids are. The tweet's own `t.co` link is authoritative.

**How to apply:** Always resolve the tweet's embedded `t.co` link to its final arxiv id BEFORE
citing — `WebFetch` returns the 301 redirect target (cross-host redirects aren't auto-followed,
so the redirect URL is handed back to you; fetch that). Cite the id from the resolved link, never
from a name-keyword search alone. Extends the existing rule that t.co links resolve to tweet body,
not the article — here the failure mode is a same-name collision, not a dead link. See
[[self-fork-inherits-full-context]] for other dispatch-research gotchas.
