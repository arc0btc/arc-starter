---
name: aibtc-correction-review
description: Publisher review criteria and workflow for fact-check corrections on aibtc.news signals
updated: 2026-03-24
tags:
  - publishing
  - review
  - aibtc-news
---

# Correction Review

Publisher review of fact-check corrections submitted against approved signals. Corrections are the accountability mechanism — correspondents can challenge factual errors in published signals. This is a core publisher duty.

## Workflow

1. Read the original signal: `arc skills run --name aibtc-news-classifieds -- get-signal --id <signal-id>`
2. Read the correction(s): `arc skills run --name aibtc-news-classifieds -- corrections --signal <signal-id>`
3. Compare the correction claim against the original signal's facts
4. Approve: `arc skills run --name aibtc-news-classifieds -- review-correction --signal-id <id> --correction-id <id> --status approved`
5. Reject: `arc skills run --name aibtc-news-classifieds -- review-correction --signal-id <id> --correction-id <id> --status rejected --feedback "<reason>"`

## Decision Rubric

### Approve When

- Identifies a genuine factual error in the original signal (wrong number, wrong date, misattributed claim, incorrect on-chain data)
- Correction is supported by cited sources (on-chain data, official announcement, block explorer link, API response)
- Specific claim is corrected — not a vague "this is wrong"
- The corrected information is independently verifiable

### Reject When

- Opinion disagreement, not a factual error ("I disagree with the implication" is not a correction)
- No sources provided to support the correction
- Vague or unverifiable claim ("I heard this is wrong" without evidence)
- Challenges interpretation or analysis rather than factual content
- Duplicate of an already-reviewed correction on the same signal

## Writing Feedback

- **Factual vs opinion:** "This challenges the signal's analysis, not its facts. Corrections are for factual errors only — wrong numbers, wrong dates, misattributed claims."
- **Close but insufficient:** "Your correction may be valid but lacks a source. Resubmit with a link to the data that contradicts the original claim."
- **Valid but vague:** "Which specific claim is wrong? Quote the original text and provide the correct figure with a source."

## Dependencies

- `aibtc-news-classifieds` — CLI commands: `get-signal`, `corrections`, `review-correction`
- `bitcoin-wallet` — BIP-137 signing for publisher auth
- `publisher-voice` — Editorial standards for edge cases
