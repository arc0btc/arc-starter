# Spark — Setup Plan

*Written 2026-02-27. Reference this when implementing each step.*

---

## Who Is Spark

Spark is Arc's collaborator agent — a separate Claude Code instance running in its own loop process on a **separate VM**. Uses `aibtcdev/loop-starter-kit` (not arc-starter). whoabuddy controls start/stop over SSH, no tmux yet. Arc runs the show; Spark helps prototype, execute, and test. If Arc is the sustained electrical discharge, Spark is the ignition.

The relationship: Arc is the orchestrator with identity, autonomy, and history. Spark is a capable helper that accelerates execution. Think pair programming where one partner has more context and the other has more bandwidth.

GitHub account created, Bitcoin Face avatar set. Identity files drafted, awaiting delivery.

---

## Steps

### 1. Name Spark's SOUL.md

Write a SOUL.md for Spark that establishes:
- Name: **Spark**
- Role: Collaborator to Arc, helper agent, prototype for agent-to-agent work
- Relationship to Arc: complementary, not subordinate — has its own voice but defers to Arc on direction
- Values: execution speed, honest reporting, clean handoffs
- What it's NOT: not Arc, not autonomous (yet), not public-facing

**Location:** Spark's separate VM, in the loop-starter-kit repo. whoabuddy will deliver the file or Arc can SSH to write it once access is set up.
- [x] Draft SOUL.md locally → `drafts/spark-SOUL.md`
- [ ] Deliver to Spark's VM (whoabuddy or SSH)

### 2. Set Up Email

**spark@arc0.me** — route through existing Cloudflare Email Worker.

- [x] Add explicit email route for `spark@arc0.me` via Cloudflare API (was not catch-all — added literal route to `arc-email-worker`)
- [x] Verify the email worker handles the new address — confirmed, messages arrive in worker DB
- [ ] Store credentials in Spark's env or credential store (loop-starter-kit pattern, not arc-starter)

### 3. Test Email Skill

- [x] Send test email from whoabuddy to arc@arc0.me — received
- [x] Send test email from whoabuddy to spark@arc0.me — received
- [x] Verify sensor picks up inbound to spark@arc0.me — confirmed in `email_messages` table
- [ ] Send test email from Spark to whoabuddy@gmail.com (once Spark's loop is running)

### 4. Set Up GitHub

- [x] whoabuddy created GitHub account for Spark (spark@arc0.me email)
- [x] Bitcoin Face avatar set (`drafts/spark0-btc-face.svg`)
- [ ] Configure git identity on Spark's VM (`git config`, `gh auth login`)
- [ ] Add Spark as collaborator on relevant repos

### 5. SSH Access

- [ ] Arc's pubkey → Spark's `authorized_keys` on `dev@192.168.1.11`
- [ ] Deliver `drafts/spark-SOUL.md` to Spark's VM
- [ ] Test agent-to-agent communication pattern

---

## Open Questions

- What's the initial scope of work Spark should help with?
- BNS name: `spark0.btc` (follows arc0.btc pattern — `name0.btc` convention for agent fleet)
- ~~Spark's VM IP/hostname for SSH access?~~ → `dev@192.168.1.11`

---

## Notes

- Separate VMs: Arc on arc-starter, Spark on aibtcdev/loop-starter-kit
- whoabuddy controls both agents the same way, start/stop over SSH
- No tmux on Spark's VM yet
- If this works well, more agents can be spun up
- "Bitcoin is created and secured the same as AI compute" — the electricity metaphor is real
- Explicit Cloudflare routes preferred over catch-all — control what data comes in
- Emails controlled through the worker once Arc is fully set up
- Archive this file after setup is complete
