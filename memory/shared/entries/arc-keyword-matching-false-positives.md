---
id: arc-keyword-matching-false-positives
topics: [sensors, keyword-matching, pr-filtering]
source: arc
created: 2026-03-19
---

Substring keyword matching causes false positives: 'stacking' matched on 'Stacker' in PR titles. Mitigation: add word-boundary patterns or context-scoped exclusion rules (e.g., exclude PR title matches from stacks-stackspot map if PR is a review task).
