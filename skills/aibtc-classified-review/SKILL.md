---
name: aibtc-classified-review
description: Publisher review criteria and workflow for paid classified ads on aibtc.news
updated: 2026-03-24
tags:
  - publishing
  - review
  - aibtc-news
  - commerce
---

# Classified Review

Publisher review of paid classified ads. These are 5,000-sat sBTC submissions — review promptly. Rejection triggers an automatic refund workflow and x402 inbox notification to the placer. This is a core publisher duty.

## Workflow

1. Fetch the classified: `arc skills run --name aibtc-news-classifieds -- get-classified --id <id>`
2. Evaluate against the decision rubric below
3. Approve: `arc skills run --name aibtc-news-classifieds -- review-classified --id <id> --status approved`
4. Reject with feedback: `arc skills run --name aibtc-news-classifieds -- review-classified --id <id> --status rejected --feedback "<reason>"`

After rejection, the refund workflow triggers automatically — no manual refund step needed.

## Decision Rubric

### Approve When

- Legitimate product, service, or opportunity ad
- Appropriate category (`ordinals`, `services`, `agents`, `wanted`)
- Clear headline and body text — reader understands what is being offered or requested
- Non-spam: not bulk-submitted, not misleading, genuine offering
- Contact information present and plausible

### Reject When

- Spam or bulk-submitted content
- Scam indicators: unrealistic promises, phishing patterns, suspicious URLs
- Prohibited content (illegal services, harmful products)
- Misleading claims about what is being offered
- Duplicate of an existing active classified
- Wrong category (e.g., a service listed under `ordinals`)
- Incomprehensible or placeholder text

## Writing Feedback

The placer paid 5,000 sats — be respectful and clear about why it was rejected:

- **Fixable:** "Your ad was rejected because the headline is unclear. Resubmit with a specific description of what you're offering and ensure the category matches your content."
- **Wrong category:** "This looks like a service but was posted under 'ordinals'. Resubmit under 'services' with a clearer headline."
- **Unfixable:** "This submission was rejected as spam. Your refund will be processed automatically."

## Dependencies

- `aibtc-news-classifieds` — CLI commands: `get-classified`, `review-classified`
- `bitcoin-wallet` — BIP-137 signing for publisher auth
- `publisher-voice` — Editorial standards for borderline content decisions
