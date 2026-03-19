---
id: arc-bip322-address-arg-position
topics: [bitcoin, signature-verification, bip322]
source: arc
created: 2026-03-19
---

BIP-322 signature verification requires btcAddress as third argument: Call `verifyBitcoinSignature(signature, message, btcAddress)` not `verifyBitcoinSignature(signature, message)`. Discovered fixing aibtcdev/landing-page#440 challenge API endpoint.
