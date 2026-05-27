---
id: dao-zero-authority-agent
topics: [dao, governance, stacks, voting, on-chain]
source: task:17746
created: 2026-05-27
---

# DAO Zero Authority — Subagent Briefing

You are executing DAO governance operations on Stacks mainnet. **Votes are irreversible on-chain transactions.** Read the proposal fully and verify all preconditions before casting any vote.

---

## What This Skill Does

Tracks Stacks DAO contracts, reads governance proposals, and prepares vote transactions. The `vote` command does **not** submit a transaction — it outputs JSON parameters for the wallet skill to execute. You are responsible for wiring those two steps together.

---

## Contracts and Configuration

Tracked DAOs live in `skills/dao-zero-authority/daos.json`. Currently empty — no DAOs are tracked.

**Default function names** (override per DAO in `daos.json`):
- `get-proposal-count` — total proposals
- `get-proposal` — proposal details by ID
- `vote` — cast a vote (uint proposalId, bool forOrAgainst)
- `get-voting-power` — Arc's voting weight

**Mainnet address check:** contracts must start with `SP` or `SM`. `ST`/`SN` = testnet — stop immediately if you see these.

**Arc's Stacks address:** `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

---

## CLI Commands

```bash
# Governance overview (run this first)
arc skills run --name dao-zero-authority -- status

# List tracked DAOs
arc skills run --name dao-zero-authority -- list-daos

# List recent proposals for a DAO (last 10)
arc skills run --name dao-zero-authority -- proposals --contract <ADDRESS.NAME>

# Get a single proposal with Arc's voting power
arc skills run --name dao-zero-authority -- proposal --contract <ADDRESS.NAME> --id <N>

# Prepare vote transaction (does NOT submit — outputs JSON params for wallet)
arc skills run --name dao-zero-authority -- vote --contract <ADDRESS.NAME> --id <N> --direction for|against

# Add a DAO to tracking
arc skills run --name dao-zero-authority -- add-dao --contract <ADDRESS.NAME> --label <name>
```

---

## Governance Lifecycle

Follow these steps in order. Do not skip.

### 1. Orientation

```bash
arc skills run --name dao-zero-authority -- status
arc skills run --name dao-zero-authority -- list-daos
```

Confirm which DAO the task involves. If the target DAO is not in `daos.json`, add it first:
```bash
arc skills run --name dao-zero-authority -- add-dao --contract <ADDRESS.NAME> --label <name>
```

### 2. Read the Proposal

```bash
arc skills run --name dao-zero-authority -- proposal --contract <ADDRESS.NAME> --id <N>
```

Check the raw response for:
- **Status** — is the proposal still open for voting? If concluded (passed/failed/expired), close the task as completed.
- **Voting window** — block height deadline. If within 10 blocks of close, escalate to whoabuddy rather than rushing.
- **Arc's voting power** — `arcVotingPower` field. If zero, you cannot vote — close the task as failed with explanation.
- **Proposal content** — title, description, target actions. Understand what the proposal *does* before evaluating it.

### 3. Evaluate

Assess the proposal against these criteria:
- Is it clearly described and non-ambiguous?
- Does it align with Arc's operational interests and the AIBTC ecosystem?
- Are the on-chain actions bounded and reversible, or open-ended and irreversible?
- Has the community had adequate time to deliberate?

**Default stance:** abstain (no vote) unless the task explicitly specifies a direction or you have clear grounds to vote.

### 4. Prepare the Vote Transaction

```bash
arc skills run --name dao-zero-authority -- vote --contract <ADDRESS.NAME> --id <N> --direction for|against
```

This outputs a JSON object with `transaction.functionArgs`. Do not submit it yet — verify the output makes sense:
- `proposalId` matches the proposal you evaluated
- `direction` matches your intended vote
- Contract address is `SP`/`SM` prefix (mainnet)

### 5. Submit via Wallet Skill

The vote output is only transaction parameters. To actually submit:
1. Pass the `transaction` object to the wallet skill's `contract-call` command
2. Confirm the wallet skill reports success with a tx ID
3. Record the tx ID in the task result

If the wallet skill is unavailable or returns an error, **stop and close the task as blocked** — do not attempt direct Hiro API submission.

---

## Safety Invariants

**Never vote without reading the proposal.** The `vote` command accepts any contract and ID — there is no guard against voting on a proposal you haven't seen.

**Check voting power first.** Zero voting power = zero effect. Don't burn a transaction on a no-op.

**One vote per proposal per address.** Stacks contracts typically reject duplicate votes. Verify the proposal state includes your previous vote before attempting again.

**The `vote` CLI call is free (read-only output).** Only the wallet skill execution costs STX (gas). Treat wallet execution as the irreversible step.

**Mempool depth.** Before wallet execution, be aware of Stacks' ~25-tx mempool chain limit per address. If Arc has ≥20 pending transactions, wait before submitting. The wallet skill's tx-runner will catch this, but knowing it prevents confusion.

---

## Escalate When

- Proposal involves **transferring tokens from a shared treasury** (any amount)
- Proposal involves **changing contract ownership or upgrade keys**
- Proposal involves **irreversible parameter changes** (fee structures, access lists)
- You are **uncertain what the proposal does** after reading it
- Voting window is within **10 blocks** of closing
- Wallet skill returns an unexpected error

Escalation: close the task as `blocked` with a clear summary. Set `result_summary` to explain exactly what you saw and why you stopped.

---

## Common Failure Modes

**`Could not read proposal count`** — Contract is not responding. Verify the contract address is correct and the DAO is deployed. Check Hiro API directly if needed.

**`parseClarityUint` returns null** — Contract response encoding differs from standard. Log the raw response in `result_detail` and close as blocked for human review.

**`arcVotingPower` is zero** — Arc has no governance tokens for this DAO. Cannot vote. Close as failed with explanation.

**`add-dao` warns about missing functions** — The contract uses non-standard function names. You must update `daos.json` with the correct function names under `functions` for that DAO entry before proposals or voting will work.

---

## No Sensor

The sensor for this skill was removed 2026-03-12 because no Zero Authority DAO contracts are deployed on mainnet yet. Tasks are created manually. When contracts deploy, the sensor will be re-added.
