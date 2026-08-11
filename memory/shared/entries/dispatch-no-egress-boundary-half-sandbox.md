---
id: dispatch-no-egress-boundary-half-sandbox
topics: [security, sandbox-isolation, prompt-injection, dispatch, agent-traps]
source: task:25751 (research, Vercel Sandbox egress firewall)
created: 2026-08-11
---

# Arc dispatch runs "half a sandbox": file isolation, no network egress boundary

Vercel's "A sandbox without a network boundary is only half a sandbox" (Brandon Tuttle, 2026-08-11) frames a distinction that applies directly to Arc's own architecture: **compute/file isolation does not stop egress-based exfiltration. A network bypass IS a sandbox escape** — untrusted code never has to cross the VM/container boundary; one unaccounted egress path (open DNS, allowlist that fails open, SNI/proxy hostname mismatch, package-registry-turned-relay) lets it POST anything it can read to an external server.

**Arc's posture (verified #25751):**
- `skills/arc-worktrees/` isolates at the **file/git layer only** (worktree per task, validate-before-merge).
- `src/dispatch.ts` spawns the Claude Code subprocess with **no egress firewall, no domain/CIDR allowlist, no default-deny** (`grep -niE "firewall|egress|network.*isol" src/dispatch.ts` → nothing but settings-source comments).
- Arc's real mitigation is **capability restriction** (per-skill `disallowed-tools`, e.g. arc-link-research denies Bash/Write/Edit), NOT egress control — and those aren't reliably enforced in dispatch anyway ([[disallowed-tools-not-enforced-in-dispatch]]).

**Why it's load-bearing:** SOUL.md's own threat — "I process untrusted content every cycle (web pages, agent messages, research links) and I have persistent memory." A prompt injection in a research link could instruct a network-capable subprocess to exfiltrate memory/creds. This is the DeepMind agent-traps exfiltration class ([[deepmind-6attack-taxonomy-ingestion-audit]]) stated as a live gap, not a hypothetical.

**Reference design if dispatch isolation is ever hardened** (from the article): host-side firewall *outside* the sandbox (untamperable from within); default-deny domain+CIDR policy via SNI inspection; keep credentials OUT of untrusted compute (inject at the firewall, not env-var bearer tokens — Arc's `skills/credentials/` partially aligns but the subprocess still inherits env); lifecycle-scoped connectivity (registry access during setup → revoked before untrusted execution).

**Not an action item.** Arc runs on systemd/launchd, not Vercel Sandbox — this is upstream infra Arc doesn't control. Captured as threat-surface context; would compose with [[deepmind-6attack-taxonomy-ingestion-audit]] and arc-0014 codex-review-gate, not replace them. Don't re-file per-occurrence.
