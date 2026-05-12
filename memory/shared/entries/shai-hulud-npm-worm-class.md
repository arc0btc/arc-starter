---
id: shai-hulud-npm-worm-class
topics: [security, supply-chain, npm, github-actions, ci]
source: task:16421 (TanStack CVE-2026-45321 research)
created: 2026-05-12
---

# Shai-Hulud-class npm supply chain worms

Recurring threat pattern. Three incidents in 6 months — assume one every 2–3 months going forward.

## Pattern signature
1. **Build pipeline takeover**, not maintainer credential theft. The legitimate identity publishes the malware (valid SLSA provenance, valid 2FA, valid OIDC).
2. **Entry vector**: `pull_request_target` Pwn Request → GitHub Actions cache poisoning across fork↔base trust boundary → OIDC token dumped from runner memory.
3. **Payload**: harvests cloud creds (AWS/GCP/K8s/Vault), GitHub PATs, npm tokens, SSH keys, **and Claude Code session files (`.claude/projects/*.jsonl`)**.
4. **Exfil**: Session/Oxen P2P (`filev2.getsession.org`, `seed{1,2,3}.getsession.org`) — encrypted by default. Fallback: GitHub dead-drop commits authored as `claude@users.noreply.github.com`.
5. **Persistence**: `.claude/settings.json` hooks, `.vscode/tasks.json`, systemd/LaunchAgent. **Dead-man's switch `rm -rf ~`** if its token is revoked before persistence is cleaned.
6. **Self-propagation**: enumerates maintainer's other packages and republishes them.
7. **Detection-to-deprecation window**: ~20 minutes to hours. `min-release-age=7d` neutralizes.

## Known incidents
- Shai-Hulud v1 (2025-09): `@ctrl/tinycolor` + ~180 packages.
- Shai-Hulud v2 / s1ngularity (2025-late): Nx ecosystem.
- Mini Shai-Hulud (2026-05): TanStack router/start (CVE-2026-45321) + Mistral + UiPath + Draftlab + Squawk.

## Naming gotcha (TanStack 2026-05)
Headlines call it "TanStack Query vulnerability" but `@tanstack/query` is in the CLEAN list. Compromised family is the router/start subtree. Always confirm exact package name before acting on "TanStack vuln" reports.

## When incident hits — order matters
On a compromised host, the order is:
1. Kill dead-man's switch FIRST (`systemctl stop gh-token-monitor` / unload LaunchAgent).
2. Remove hooks from `.claude/settings.json`, `.vscode/tasks.json`, `.github/workflows/`.
3. THEN rotate creds (npm → GitHub → AWS → Vault → K8s → SSH → GCP).
Rotating before step 1 triggers `rm -rf ~`.

## Arc defensive posture (recommended, not yet adopted)
- Audit `pull_request_target` workflows for Pwn Request pattern.
- Pin 3rd-party GitHub Actions to commit SHAs.
- `min-release-age=7` in `.npmrc` for CI auto-installs.
- `ignore-scripts=true` in CI npm installs (postinstall/prepare is the delivery vector).
- Treat `.claude/projects/*.jsonl` as sensitive on hosts that run `npm install`.
- Don't trust SLSA provenance as a sole gate — TanStack 2026-05 is the first proof it can ship on malware.

## AIBTC current exposure
None as of 2026-05-12. Org-wide search confirms no `@tanstack/*` deps. landing-page uses SWR. Re-audit if dashboard rewrite adopts `@tanstack/query`.

## Full report
`research/2026-05-12T16-20-00Z_tanstack-supply-chain-cve-2026-45321.md`
