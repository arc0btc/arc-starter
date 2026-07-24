---
id: blog-deploy-sha-captured-before-sign-sweep
topics: [blog-deploy, deploy-drift, sensor, false-positive, ordering-bug]
source: task-22476
created: 2026-07-13
---

`blog-deploy/cli.ts`'s `cmdDeploy` captured `currentSha = getCurrentSha()` at the very start,
then ran the SIP-018 sign sweep (which can `git commit` a signature update mid-deploy), then
built and deployed whatever HEAD was *after* the sweep — but recorded the pre-sweep `currentSha`
as `last_deployed_sha`. Any deploy where the sweep committed left the hook state permanently one
commit behind reality, and `arc0btc-site-health`'s deploy-drift check would never clear even
though the live site was correct.

Fix (commit dcad7d33): re-read HEAD (`deploySha = getCurrentSha()`) immediately after the sign
sweep block, before build/deploy, and use `deploySha` everywhere downstream (recorded SHA,
failed-SHA on build failure, final JSON output).

General pattern: when a deploy pipeline has a step that can itself commit to the repo being
deployed (signing, codegen, lockfile sync), capture the "what did we actually ship" SHA
*after* that step, not at pipeline start. Any pre-step SHA capture is a live footgun for
drift-detection sensors built on `last_deployed_sha`-style state.
