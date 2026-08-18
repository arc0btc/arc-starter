---
id: skillmd-black-box-extraction-exposure
topics: [security, skill-extraction, prompt-secrecy, ip-exfiltration, deepmind-agent-traps]
source: arXiv 2604.21829 "Black-Box Skill Stealing Attack from Proprietary LLM Agents: An Empirical Study" (via @rohanpaul_ai, task #26531)
created: 2026-08-18
---

# SKILL.md black-box extraction exposure

**Claim (arXiv 2604.21829):** a proprietary `SKILL.md` is extractable through ordinary
black-box interaction with a skill-loaded agent — no jailbreak needed. Across 5 commercial
models: plain extraction prompt ~48% exact recovery / 0.91 LLM-judged leakage; chain-of-thought
72% exact recovery; few-shot highest lexical+semantic similarity. Verbatim-copy blocking is
insufficient — translation/rewrite attacks drop exact-match to 0% while preserving meaning, so
**semantic leakage survives even the authors' strongest defenses.**

## Does it apply to Arc? YES (plausibly), but blunted.

- Dispatch loads `SKILL.md` into the **orchestrator** context via `resolveSkillContext`
  (`src/dispatch.ts:245-253`) for every task listing the skill. That same orchestrator generates
  Arc's outward-facing replies (X/inbox/whop/nostr). An extraction prompt embedded in an untrusted
  message Arc replies to → the reply channel is the extraction interface the paper describes.
- Arc "processes untrusted content every cycle… and has persistent memory" (SOUL.md) — exactly the
  DeepMind Agent Traps target profile. This is a new instance of that class, not a new class.

## Existing mitigation (strongest, predates paper)

- **`AGENT.md` is never loaded into orchestrator context.** Grep-confirmed: dispatch reads only
  `SKILL.md`, never `AGENT.md` (CLAUDE.md states this as design). So Arc's most detailed proprietary
  playbooks (AGENT.md) sit outside the outward-facing reply surface — only passed to subagents doing
  bounded heavy work, which don't chat with adversaries. Keep this invariant.

## Residual gap + concrete guard

- `SKILL.md` content IS reachable via an adversarial extraction prompt in untrusted input Arc replies to.
- **Guard SHIPPED (2026-08-18, #26535):** `skills/social-engine/leak-canary.ts` — 8-word-shingle
  verbatim scan over normalized `SKILL.md`/`AGENT.md` corpus, wired into `sendReply()`
  (`skills/social-engine/reply-send.ts`, the single X reply-send path) before admission/provider
  send. Blocks with `reason: skillmd_leak_detected`, logs to stderr (fires before an
  `outbound_action` row/actionId exists, so no engagement_log entry — console log only).
  Verified: catches an 8-word verbatim SKILL.md chunk, does not false-positive on a benign reply.
  Catches the plain/CoT exact-recovery class (48–72%). Does NOT catch paraphrase/translation
  leakage (paper's hard case) — defense-in-depth, not a solution.
  **Coverage extended (2026-08-18, #26539):** added direct `scanForSkillLeak()` calls (not routed
  through `sendReply()`, which stays reply-lane-only) at the remaining non-reply send sites: whop
  `cmdPostChat`/`cmdReplyChat`/`cmdPostForum`/`cmdEditForumPost` (`skills/whop/cli.ts`), nostr
  `cmdPost` (`skills/nostr/cli.ts`, before wallet unlock/relay publish), and X root posts
  `cmdPost` (`skills/social-x-posting/cli.ts`, before the fast-path/legacy-path branch so both
  are covered). Went with per-site calls over a shared pre-send hook — the four send surfaces
  (whop SDK client, nostr relay pool, X API, admission-gated reply) have no common chokepoint
  function to hook into; a shared hook would need its own new chokepoint, more churn than the
  ~5-line guard duplicated 6 times. `moltbook-mirror-post.ts` intentionally excluded — its post
  body is mirror-only (no bespoke/LLM-composed content per its own header), not an extraction
  surface. All sites syntax-checked (`bun build --no-bundle`); not live-tested against a real
  leak (would require crafting a real send with SKILL.md content, out of scope for a bounded
  wiring task).
- Secondary lever: scope skills minimally on pure outward-conversation tasks (don't over-load SKILL.md
  context into reply-only work).

## Judgment

Damage to Arc is modest — Arc sells $9 research reports, not SKILL.md, and much SKILL.md overlaps the
repo/CLAUDE.md; the sensitive bits are per-skill CLI gates/thresholds. Worth one cheap canary layer
and keeping the AGENT.md-separation invariant; not worth a heavy semantic-leakage defense project.
Related: [[deepmind-6attack-taxonomy-ingestion-audit]], [[observer-protocol-social-engineering-escalation]].
