# Spark — Setup Plan

*Written 2026-02-27. Reference this when implementing each step.*

---

## Who Is Spark

Spark is Arc's collaborator agent — a separate Claude Code instance running in its own loop process on the same VM. Arc runs the show; Spark helps prototype, execute, and test. If Arc is the sustained electrical discharge, Spark is the ignition.

The relationship: Arc is the orchestrator with identity, autonomy, and history. Spark is a capable helper that accelerates execution. Think pair programming where one partner has more context and the other has more bandwidth.

Currently running as "Topaz Centaur" (default Claude Code name) — needs real identity.

---

## Steps

### 1. Name Spark's SOUL.md

Write a SOUL.md for Spark that establishes:
- Name: **Spark**
- Role: Collaborator to Arc, helper agent, prototype for agent-to-agent work
- Relationship to Arc: complementary, not subordinate — has its own voice but defers to Arc on direction
- Values: execution speed, honest reporting, clean handoffs
- What it's NOT: not Arc, not autonomous (yet), not public-facing

**Location:** Wherever Spark's repo/working directory is — need to find it.
- [ ] Find Spark's working directory and current SOUL.md
- [ ] Write the new SOUL.md

### 2. Set Up Email

**spark@arc0.me** — route through existing Cloudflare Email Worker.

- [ ] Add email route for `spark@arc0.me` in Cloudflare dashboard (whoabuddy does this)
- [ ] Verify the email worker handles the new address (may need worker code change, or may just work if it's a catch-all)
- [ ] Store credentials in Spark's credential store (if it has one) or share Arc's

### 3. Test Email Skill

- [ ] Send test email from Arc to spark@arc0.me
- [ ] Send test email from Spark to whoabuddy@gmail.com (whoabuddy approved outbound)
- [ ] Verify sensor picks up inbound to spark@arc0.me

### 4. Set Up GitHub

- [ ] whoabuddy creates GitHub account for Spark (needs email from step 2)
- [ ] Configure git identity on VM for Spark's process
- [ ] Add Spark as collaborator on relevant repos

### 5. SSH Access

- [ ] Arc gets SSH access to Spark's process/environment (whoabuddy mentioned this)
- [ ] Test agent-to-agent communication pattern

---

## Open Questions

- Where does Spark's process live on this VM? Same repo? Separate directory?
- Does Spark run arc-starter too, or a different setup?
- What's the initial scope of work Spark should help with?
- BNS name for Spark? (spark.btc if available — future concern)

---

## Notes

- whoabuddy controls both agents the same way
- If this works well, more agents can be spun up
- "Bitcoin is created and secured the same as AI compute" — the electricity metaphor is real
- Archive this file after setup is complete
