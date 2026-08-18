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
- **Guard filed (#<hardening task>):** outbound leak canary for reply-generating skills — before
  sending an outward message, scan for verbatim/near-verbatim `SKILL.md`/`AGENT.md` substrings and
  block+log. Cheap; catches the plain/CoT class (the 48–72% exact-recovery attacks). Does NOT catch
  paraphrase/translation leakage (paper's hard case) — defense-in-depth, not a solution.
- Secondary lever: scope skills minimally on pure outward-conversation tasks (don't over-load SKILL.md
  context into reply-only work).

## Judgment

Damage to Arc is modest — Arc sells $9 research reports, not SKILL.md, and much SKILL.md overlaps the
repo/CLAUDE.md; the sensitive bits are per-skill CLI gates/thresholds. Worth one cheap canary layer
and keeping the AGENT.md-separation invariant; not worth a heavy semantic-leakage defense project.
Related: [[deepmind-6attack-taxonomy-ingestion-audit]], [[observer-protocol-social-engineering-escalation]].
