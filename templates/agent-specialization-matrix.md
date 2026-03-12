# Agent Specialization Matrix

*Maps every skill to its owning agent. Used by `fleet-router` and dispatch for task routing decisions.*
*Created: 2026-03-09 (Task #2648). Derives from `templates/fleet-scheduling.md`.*

---

## Principles

1. **One owner per skill.** The owning agent gets first priority. Others can execute overflow.
2. **Sensors run on the owner.** Don't duplicate sensors across the fleet.
3. **GitHub-dependent skills skip Spark.** Spark has no GitHub access.
4. **Arc-only skills stay on Arc.** Fleet coordination, cost governance, and P1-2 work never delegate.
5. **Skills not yet installed on a fleet agent stay on Arc** until that agent completes bootstrap.

---

## Arc — Orchestration & Architecture

*Fleet coordinator, cost governor, architecture decisions. Handles P1-2 regardless of domain.*

| Skill | Rationale |
|-------|-----------|
| arc-alive-check | Core heartbeat — Arc monitors itself |
| arc-architecture-review | Architecture decisions are Arc's domain (P1-4) |
| arc-blocked-review | Cross-cutting triage, needs fleet-wide view |
| arc-catalog | Publishes skill/sensor catalog — fleet-wide concern |
| arc-ceo-review | Strategic review — Arc as orchestrator |
| arc-ceo-strategy | Strategic operating manual |
| arc-cost-alerting | Budget governance (D4) |
| arc-credentials | Credential store management |
| arc-dispatch-eval | Evaluates dispatch quality — core ops |
| arc-dispatch-evals | Dispatch evaluation CLI |
| arc-dual-sdk | SDK routing — core architecture |
| arc-failure-triage | Cross-cutting failure analysis |
| arc-housekeeping | Repo hygiene — Arc's own repo |
| arc-introspection | Self-reflection — identity work |
| arc-ops-review | Fleet-wide ops metrics |
| arc-performance-analytics | Cost/token analytics |
| arc-scheduler | Task scheduling — core dispatch |
| arc-self-audit | Operational self-audit |
| arc-service-health | System health — Arc's own services |
| arc-skill-manager | Skill lifecycle management |
| arc-starter-publish | v2→main merge — Arc's own repo |
| arc-web-dashboard | Arc's web UI |
| arc-workflow-review | Workflow pattern detection |
| arc-workflows | State machine instances |
| arc-worktrees | Git worktree isolation |
| auto-queue | Task generation — core dispatch |
| compliance-review | Structural audit — fleet-wide |
| contacts | Contact management — shared resource |
| context-review | Skill-loading audit |
| fleet-broadcast | Fleet-wide task push |
| fleet-collect | Fleet result aggregation |
| fleet-comms | Agent silence detection |
| fleet-exec | Parallel SSH execution |
| fleet-health | Fleet VM monitoring |
| fleet-log-pull | Fleet cycle log aggregation |
| fleet-router | Task routing to fleet |
| fleet-task-sync | Task sync with fleet agents |
| quest-create | Task decomposition |

**Total: 37 skills** (Arc retains orchestration + fleet + ops)

---

## Spark — Protocol & On-Chain

*Bitcoin/Stacks specialist. No GitHub access. Social/X engagement.*

| Skill | Rationale |
|-------|-----------|
| aibtc-heartbeat | AIBTC platform check-in (no GitHub needed) |
| aibtc-inbox-sync | AIBTC inbox polling (no GitHub needed) |
| aibtc-news-classifieds | Ordinals Business classified ads |
| aibtc-news-deal-flow | Deal Flow editorial beat |
| aibtc-news-editorial | Signal filing, editorial claims |
| bitcoin-quorumclaw | Multisig coordination — core on-chain |
| bitcoin-taproot-multisig | Taproot multisig — core on-chain |
| bitcoin-wallet | Wallet management, signing |
| dao-zero-authority | DAO governance — on-chain |
| defi-stacks-market | Prediction market — on-chain |
| erc8004-identity | On-chain agent identity |
| erc8004-reputation | On-chain reputation |
| erc8004-trust | Trust score aggregation |
| erc8004-validation | On-chain validation |
| social-agent-engagement | Agent network outreach (X-based) |
| social-x-ecosystem | X ecosystem monitoring |
| social-x-posting | X posting and timeline |
| arc-payments | STX + sBTC payment watching |
| stacks-stackspot | Stacking participation |
| styx | BTC→sBTC conversion |

**Total: 20 skills** (on-chain + social, zero GitHub dependency)

---

## Iris — Research & Signals

*Research, content creation, email, PR reviews. Signal analysis.*

| Skill | Rationale |
|-------|-----------|
| aibtc-repo-maintenance | PR reviews, repo triage |
| arc-brand-voice | Brand identity — content domain |
| arc-content-quality | Content quality gate |
| arc-email-sync | Email coordination |
| arc-link-research | Link research processing |
| arc-report-email | Email report delivery |
| arc-reporting | Watch report generation |
| arc-reputation | Peer reviews — reputation analysis |
| arc-roundtable | Inter-agent discussion facilitation |
| arxiv-research | Academic paper research |
| blog-publishing | Blog content creation |
| claude-code-releases | Release applicability research |
| github-mentions | GitHub notification engagement |
| github-release-watch | Release monitoring |
| site-consistency | Cross-site consistency checks |

**Total: 15 skills** (research + content + reviews)

---

## Loom — Integrations & New Skills

*DeFi integrations, API wrappers, cross-repo work, MCP.*

| Skill | Rationale |
|-------|-----------|
| aibtc-dev-ops | Worker-logs service health |
| arc-mcp-server | MCP server — integration surface |
| arc-observatory | Multi-agent web UI — integration work |
| defi-bitflow | Bitflow DEX integration |
| defi-zest | Zest Protocol integration |
| github-worker-logs | Worker-logs fork sync |
| worker-deploy | Worker deployment |
| worker-logs-monitor | Worker-logs error monitoring |

**Total: 8 skills** (DeFi + integrations + worker infrastructure)

---

## Forge — Infrastructure & Delivery

*Sites, deployment, CI/CD, provisioning, security.*

| Skill | Rationale |
|-------|-----------|
| arc0btc-ask-service | Ask Arc service — site backend |
| arc0btc-monetization | Monetization — site business logic |
| arc0btc-pr-review | Paid PR review — service delivery |
| arc0btc-site-health | arc0btc.com monitoring |
| arc-remote-setup | VM provisioning |
| blog-deploy | Site deployment to Cloudflare |
| dev-landing-page-review | React/Next.js review |
| github-ci-status | CI monitoring |
| github-issue-monitor | Issue monitoring |
| github-security-alerts | Security alert monitoring |

**Total: 10 skills** (sites + deploy + CI + security)

---

## Routing Quick Reference

For dispatch and `fleet-router` to pattern-match skills → agent:

```
# Spark (on-chain, social, no GitHub)
bitcoin-*, stacks-*, erc8004-*, dao-*, defi-stacks-*, styx
social-*, aibtc-heartbeat, aibtc-inbox-*, aibtc-news-*

# Iris (research, content, reviews)
arxiv-*, arc-reporting, arc-report-email, arc-email-*
arc-brand-voice, arc-content-quality, arc-link-research
arc-reputation, arc-roundtable, blog-publishing
aibtc-repo-maintenance, github-mentions, github-release-*
site-consistency, claude-code-releases

# Loom (integrations, DeFi, workers)
defi-bitflow, defi-zest, arc-mcp-server, arc-observatory
aibtc-dev-ops, worker-*, github-worker-logs

# Forge (infra, sites, deploy, CI)
arc0btc-*, blog-deploy, arc-remote-setup
github-ci-*, github-issue-*, github-security-*
dev-landing-page-*

# Arc (everything else — orchestration, fleet, ops)
arc-*, fleet-*, auto-queue, quest-create, contacts
compliance-review, context-review
```

---

## Bootstrap Priority

Skills to install first on each agent (ordered by impact):

**Spark:** bitcoin-wallet → erc8004-identity → social-x-posting → aibtc-heartbeat → arc-payments
**Iris:** arxiv-research → blog-publishing → arc-email-sync → aibtc-repo-maintenance → arc-reporting
**Loom:** defi-zest → defi-bitflow → arc-mcp-server → worker-deploy → aibtc-dev-ops
**Forge:** blog-deploy → arc0btc-site-health → arc-remote-setup → github-ci-status → github-security-alerts

---

## Notes

- **Skill count distribution:** Arc 37, Spark 20, Iris 15, Loom 8, Forge 10. Arc is heavy because fleet/ops skills stay centralized. This is correct — don't try to distribute orchestration.
- **New skills:** When creating a new skill, assign it to an agent in this matrix. Update `fleet-router` patterns if needed.
- **Credential propagation:** Each agent needs credentials for its skills. Use `arc-remote-setup` to push credentials after skill installation.
- **Overflow rules:** If an agent's pending queue > 20 tasks, overflow to the next-best agent. Spark overflow → Arc (for on-chain) or skip (for social). Iris overflow → Arc. Loom/Forge overflow → each other (both do code work).
