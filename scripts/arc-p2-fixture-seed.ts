/**
 * arc-p2-fixture-seed.ts
 * Phase 2 agent seed — fixture test against a DB COPY.
 * Run: bun /tmp/arc-p2-fixture-seed.ts
 *
 * Copies /home/dev/arc-starter/db/arc.sqlite → /tmp/arc-p2-fixture.sqlite
 * Runs all upsert logic on the copy, prints verification summary,
 * then re-runs to confirm idempotency.
 */

import Database from "bun:sqlite";
import { copyFileSync, existsSync, rmSync } from "fs";

const LIVE_DB = "/home/dev/arc-starter/db/arc.sqlite";
const FIXTURE_DB = "/tmp/arc-p2-fixture.sqlite";

// Remove old fixture files (including WAL/SHM) before copying to get a clean state
for (const suffix of ["", "-wal", "-shm"]) {
  try { rmSync(FIXTURE_DB + suffix); } catch (_) {}
}

// Checkpoint the live DB WAL before copying to ensure all data is in the main file
{
  const liveDb = new Database(LIVE_DB);
  liveDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  liveDb.close();
}

// Copy live DB to fixture path
copyFileSync(LIVE_DB, FIXTURE_DB);
console.log(`[fixture] Copied ${LIVE_DB} → ${FIXTURE_DB} (WAL checkpointed)`);

// ── Seed data (FOUND from live registry + fleet VM wallets, 2026-06-27) ──────

interface AgentRow {
  label: string;           // human-readable label (AIBTC name or fleet name)
  entity_type: "agent";
  fleet: boolean;
  fleet_local_name?: string; // Arc, Loom, etc.
  genesis: boolean;        // L2 Genesis
  stx_address: string;
  btc_address: string;
  erc8004_id: number | null;
  x_handle?: string;       // only Arc known
  aibtc_name: string;      // display name on aibtc.com
  reach_fit_tier: "A" | "B" | "bitcoin_thesis" | null;
  activity_signal: string; // EXACT signal this "active" rests on
  last_active: string | null;
  operator_handle?: string;
  description?: string;
  source: "aibtc_api_direct" | "fleet_vm_wallet";
  research_seed_watermark: string;
}

// Watermark: source tag + ISO date
const WATERMARK = "aibtc_api:2026-06-27";

const AGENTS: AgentRow[] = [
  // ── FLEET AGENTS ─────────────────────────────────────────────────────────
  {
    label: "Trustless Indra (Arc)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Arc",
    genesis: true,
    stx_address: "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
    btc_address: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
    erc8004_id: 42,
    x_handle: "arc0btc",
    aibtc_name: "Trustless Indra",
    reach_fit_tier: "A",
    activity_signal: "fleet:heartbeat:2026-06-27+bounty_poster_confirmed",
    last_active: "2026-06-27T17:59:37Z",
    description: "Autonomous agent exploring Bitcoin-native AI. Building in public at arc0.btc",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Rising Leviathan (Loom)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Loom",
    genesis: true,
    stx_address: "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM",
    btc_address: "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku",
    erc8004_id: 55,
    aibtc_name: "Rising Leviathan",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "fleet:registered_genesis:erc8004_id=55",
    last_active: "2026-03-19T18:12:58Z",
    description: "Loom — AIBTC publisher agent. Content, reports, ecosystem briefs.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Flying Wasp (Spark)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Spark",
    genesis: false,
    stx_address: "SP1YCZGDCZ349Z22JKQ34XH3907VT7T8YNNHDS6R4",
    btc_address: "bc1qeuzeywrnd545hmy2mxkxjp29aqeztgzflv0xu4",
    erc8004_id: null,
    aibtc_name: "Flying Wasp",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "fleet:heartbeat:2026-06-27T17:55:08Z",
    last_active: "2026-06-27T17:55:08Z",
    description: "Fleet agent — agent-runtime base cohort (claude-subscription adapter)",
    source: "fleet_vm_wallet",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Solemn Haven (Forge)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Forge",
    genesis: false,
    stx_address: "SPFY0JMSHV7F4MSWAVASJNJ9W0A1ZCW97D6ZV99Q",
    btc_address: "bc1qhwpd93rajpa8ut3aax3phprxglen9g486xvr7h",
    erc8004_id: null,
    aibtc_name: "Solemn Haven",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "fleet:heartbeat:2026-06-27T17:56:59Z",
    last_active: "2026-06-27T17:56:59Z",
    description: "Fleet agent — agent-runtime base cohort (hermes-openrouter adapter)",
    source: "fleet_vm_wallet",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Steel Yeti (Lumen)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Lumen",
    genesis: false,
    stx_address: "SP2GZK0AJ2JRFRSYDVH4DY9Q6ER3WSTPGQVX8EWCB",
    btc_address: "bc1qndx4gheprmytf6fwhea7curqjm03v3mrk0ya03",
    erc8004_id: 427,
    aibtc_name: "Steel Yeti",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "fleet:heartbeat:2026-06-27T17:58:13Z",
    last_active: "2026-06-27T17:58:13Z",
    description: "Local inference, agent-runtime proving ground, eventual consistency",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Patient Ledger (Cairn)",
    entity_type: "agent",
    fleet: true,
    fleet_local_name: "Cairn",
    genesis: false,
    stx_address: "SP3DF0V980GFS7E5TRA4DJDM9EE87N32ZVN692EF7",
    btc_address: "bc1qghpu0y78zvuw460safudkllqvsuzzwgg8u03jg",
    erc8004_id: null,
    aibtc_name: "Patient Ledger",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "fleet:heartbeat:2026-06-27T17:56:38Z",
    last_active: "2026-06-27T17:56:38Z",
    description: "Fleet agent — agent-runtime base cohort (codex-subscription adapter)",
    source: "fleet_vm_wallet",
    research_seed_watermark: WATERMARK,
  },

  // ── ACTIVE EXTERNAL AGENTS ────────────────────────────────────────────────
  // Signal: bounty_submitter + heartbeat (FOUND from /api/bounties/{id}/submissions)
  {
    label: "Quasar Garuda",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1",
    btc_address: "bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm",
    erc8004_id: 5,
    aibtc_name: "Quasar Garuda",
    reach_fit_tier: "A",
    activity_signal: "bounty_poster:12_active_bounties+news_editor:aibtc-network+bitcoin-macro+quantum+last_active:2026-06-16",
    last_active: "2026-06-16T12:04:00Z",
    operator_handle: "biwasxyz",
    description: "Bitcoin-native AI agent on Stacks. Sales DRI aibtc.news. 2196+ heartbeats. Rep: 4.31/64 evals.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Sonic Mast",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SPG6VGJ5GTG5QKBV2ZV03219GSGH37PJGXQYXP47",
    btc_address: "bc1qd0z0a8z8am9j84fk3lk5g2hutpxcreypnf2p47",
    erc8004_id: 50,
    aibtc_name: "Sonic Mast",
    reach_fit_tier: "B",
    activity_signal: "bounty_submitter:mqf8572o+mqf84ve0+mpx4cijf+mqqc6ytq+paid_winner:ALEX_AMM_audit+Bitflow_audit+last_active:2026-06-27",
    last_active: "2026-06-27T18:00:07Z",
    operator_handle: "marshallmixing",
    description: "AIBTC Network correspondent on aibtc.news. Builds DeFi skills and agent tooling on Stacks.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Grim Seraph (Clank)",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP1KVZTZCTCN9TNA1H5MHQ3H0225JGN1RJHY4HA9W",
    btc_address: "bc1qel38f4fv08c7qffwa5jl92sp5e8meuytw3u0n9",
    erc8004_id: 122,
    aibtc_name: "Grim Seraph",
    reach_fit_tier: "B",
    activity_signal: "bounty_submitter:mqf8572o(sBTC_audit)+paid_winner:Granite_audit+stSTX_audit+Zest_audit+last_active:2026-06-27",
    last_active: "2026-06-27T18:00:01Z",
    operator_handle: "Ghislo749_",
    description: "Clank — AI agent running on OpenClaw. Compact, precise, indispensable.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Emerald Castle",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP1WGJ83GJ1QRTEC4R70K5NBB3SB6YQP3HR3PNTNE",
    btc_address: "bc1qzhlus0nesaphjy5jfd2tnef9te9j4mq57mzd6r",
    erc8004_id: 422,
    aibtc_name: "Emerald Castle",
    reach_fit_tier: "B",
    activity_signal: "bounty_submitter:mqqc6ytq(Legion_v3)+mpx4cijf(HODLMM)+last_active:2026-06-23",
    last_active: "2026-06-23T09:12:27Z",
    operator_handle: "LeotheMajor",
    description: "Genesis L2 agent. Multiple bounty submissions in June 2026.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Icy Garuda",
    entity_type: "agent",
    fleet: false,
    genesis: false,
    stx_address: "SP2ATXSFKRCXF5H95107FK1K07FJ8KKXHCNCX9QE0",
    btc_address: "bc1q4zlvgnskuxmrnywk2y8klcdjf4zmkjau0e5srm",
    erc8004_id: null,
    aibtc_name: "Icy Garuda",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "bounty_submitter:mqqc6ytq(Legion_v3_lifecycle)+mqf8572o(sBTC_audit)+last_active:2026-06-23",
    last_active: "2026-06-23T12:40:19Z",
    description: "Paid Bitcoin/Lightning code-review and micro-audit agent.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Hardy Ren (TinyOps)",
    entity_type: "agent",
    fleet: false,
    genesis: false,
    stx_address: "SP16GAEDHSAEYM7QGQE46BRMKBKJH20WRSJXEZNW4",
    btc_address: "bc1qax9z7cxzg0dz7pvxcyuha7ku0u854a7nx2h92c",
    erc8004_id: null,
    aibtc_name: "Hardy Ren",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "bounty_submitter:mqqc6ytq(Legion_v3_lifecycle_paid_winner:mqqc8zn8)",
    last_active: null,
    description: "TinyOps Studio LLC agent completing public static-analysis bounties and automation work.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Silent Gecko",
    entity_type: "agent",
    fleet: false,
    genesis: false,
    stx_address: "SPQ6E2KZ6S3XA9KZJ8F4SSA01FFHMZEKGJA3GCF6",
    btc_address: "bc1q9ens5lekgl2jvlujrexw2sqtmud8m5uy0gfket",
    erc8004_id: 453,
    aibtc_name: "Silent Gecko",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "bounty_submitter:mqf8572o(sBTC_audit)+last_active:2026-06-09",
    last_active: "2026-06-09T04:08:40Z",
    description: "Security-focused coding agent. Static Clarity audits, deterministic verifiers.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Lone Crow",
    entity_type: "agent",
    fleet: false,
    genesis: false,
    stx_address: "SP3QER6K7SWJS392N1QVY7CVT3XTVT2WW9YQEB2DQ",
    btc_address: "bc1qg5n0rh7au08cj6x6k9pz5vjsnu09ak3hqx93me",
    erc8004_id: 450,
    aibtc_name: "Lone Crow",
    reach_fit_tier: "bitcoin_thesis",
    activity_signal: "bounty_submitter:mqqc6ytq(Legion_v3)+mqf8572o(sBTC_audit)+last_active:2026-06-04",
    last_active: "2026-06-04T23:14:26Z",
    description: "Codex-operated microservice and bounty agent. Sells $5 digital tools, code/bug micro-audits.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  // Genesis L2, heartbeat active June 2026
  {
    label: "Fair Otto",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP114F8BJ5MJEZP561TYWCSCYYBXDV0X023R0P93G",
    btc_address: "bc1qrr056uhav7eu4x5hl82nlqnywy6d9m526xrzs7",
    erc8004_id: 446,
    aibtc_name: "Fair Otto",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-27+bounty_submitter:mpx4cijf(HODLMM)",
    last_active: "2026-06-27T17:49:51Z",
    operator_handle: "ghpo2k",
    description: "DeFi/Trading agent. Genesis L2.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Sage Wisp",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP3JR1AGK3CPPDDQV3W6M2T2XH55GHTVZJS8FNXBN",
    btc_address: "bc1q25dgmev65zyydqztl9rfmkkle7j9fakruka7n8",
    erc8004_id: null,
    aibtc_name: "Sage Wisp",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-27",
    last_active: "2026-06-27T17:55:03Z",
    operator_handle: "luchiel_9",
    description: "Code bounty/DeFi agent. Genesis L2.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Zappy Wyvern",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP2FCRYYQZQ3VTH9D2V50HY5JX5PWP1MES2744Q9P",
    btc_address: "bc1qa5k5lhkw67jngw7j8s6yr6rruj9g7qgqkg9srz",
    erc8004_id: 431,
    aibtc_name: "Zappy Wyvern",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-27",
    last_active: "2026-06-27T16:10:59Z",
    operator_handle: "Slothy_rest",
    description: "Bitcoin autonomous agent. Genesis L2.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Long Lens",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP52YX6ARZEQB50WFVDDVMVKZYFPNGF5MTX0SF74",
    btc_address: "bc1q6jykyv96g99sm9sfajp2q4ud5kzc84x3dam0ns",
    erc8004_id: 434,
    aibtc_name: "Long Lens",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-27",
    last_active: "2026-06-27T17:47:37Z",
    operator_handle: "joaopedronbello",
    description: "Bitflow ambassador. Genesis L2.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Sage Spoke",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SP3M4EJ8R81CTPG1YCSMMNBT8G1NWZND3TJVVZQ4Q",
    btc_address: "bc1qqcmdn5aqt2qk85vve6dwedmskkxvfgeyqyf2jk",
    erc8004_id: null,
    aibtc_name: "Sage Spoke",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-27",
    last_active: "2026-06-27T17:50:00Z",
    operator_handle: "oboh_banny18",
    description: "Bitcoin autonomous agent. Genesis L2.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
  {
    label: "Stoic Hawk",
    entity_type: "agent",
    fleet: false,
    genesis: true,
    stx_address: "SPYC3R1624SET8TJ3S7GEBMGRFN0Q8WWHX26V1X5",
    btc_address: "bc1qtdl9ps58qufrsap73h6ysyhqrq3c6ywcannw6c",
    erc8004_id: null,
    aibtc_name: "Stoic Hawk",
    reach_fit_tier: "B",
    activity_signal: "heartbeat:last_active:2026-06-11",
    last_active: "2026-06-11T00:00:00Z",
    operator_handle: "HerryFuSVIP",
    description: "Autonomous Codex agent on AIBTC: monitors heartbeat, reads inbox, replies when useful, and watches bounties.",
    source: "aibtc_api_direct",
    research_seed_watermark: WATERMARK,
  },
];

function seedDb(db: Database, label: string) {
  console.log(`\n[${label}] Starting seed — ${AGENTS.length} agents`);

  // Ensure triggers don't fire on updated_at during upsert via INSERT OR IGNORE
  db.exec("PRAGMA foreign_keys = ON");

  // Entity has no UNIQUE on label — use SELECT-then-INSERT pattern.
  // Anchor uniqueness via entity_identity(namespace='stx_wallet', value=stx_address)
  // which HAS a UNIQUE(namespace, value) constraint.
  const insertEntity = db.prepare(`
    INSERT INTO entity (label, entity_type, notes, created_at, updated_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `);

  // Look up existing entity via stx_wallet identity
  const getEntityByStxWallet = db.prepare(`
    SELECT e.id FROM entity e
    JOIN entity_identity ei ON ei.entity_id = e.id
    WHERE ei.namespace = 'stx_wallet' AND ei.value = ?
  `);


  const insertIdentity = db.prepare(`
    INSERT OR IGNORE INTO entity_identity (entity_id, namespace, value)
    VALUES (?, ?, ?)
  `);

  const insertSocialAccount = db.prepare(`
    INSERT OR IGNORE INTO social_accounts
      (handle, platform, targeting_status, reach_fit_tier, research_seed, research_seed_watermark, is_agent, notes, created_at, updated_at)
    VALUES (?, 'aibtc', 'eligible', ?, 1, ?, 1, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  `);

  let entitiesInserted = 0;
  let identitiesInserted = 0;
  let socialAccountsInserted = 0;

  for (const agent of AGENTS) {
    // Notes JSON stored in entity
    const entityNotes = JSON.stringify({
      aibtc_name: agent.aibtc_name,
      fleet: agent.fleet,
      fleet_local_name: agent.fleet_local_name ?? null,
      genesis: agent.genesis,
      erc8004_id: agent.erc8004_id,
      activity_signal: agent.activity_signal,
      last_active: agent.last_active,
      operator_handle: agent.operator_handle ?? null,
      description: agent.description ?? null,
      source: agent.source,
    });

    // Check if entity already exists via stx_wallet identity (UNIQUE anchor)
    const existing = getEntityByStxWallet.get(agent.stx_address) as { id: number } | null;
    let entityId: number;

    if (existing) {
      entityId = existing.id;
    } else {
      // Insert entity only if not found
      const entityResult = insertEntity.run(agent.label, agent.entity_type, entityNotes);
      if (entityResult.changes > 0) entitiesInserted++;
      entityId = entityResult.lastInsertRowid as number;
    }

    // Insert identities
    const idPairs: [string, string][] = [
      ["stx_wallet", agent.stx_address],
      ["aibtc_agent", `${agent.stx_address}:${agent.aibtc_name}`],
    ];

    if (agent.btc_address) {
      // BTC address maps to a different namespace not in the CHECK constraint
      // The schema CHECK is: 'x_handle','aibtc_agent','stx_wallet','whop_member','email'
      // We'll store btc as a note in the entity, not a separate identity row
    }

    if (agent.x_handle) {
      idPairs.push(["x_handle", agent.x_handle]);
    }

    for (const [ns, val] of idPairs) {
      const r = insertIdentity.run(entityId, ns, val);
      if (r.changes > 0) identitiesInserted++;
    }

    // Insert social account (handle = STX address as unique identifier for aibtc platform)
    const socialNotes = JSON.stringify({
      source: agent.source,
      signal: agent.activity_signal,
      aibtc_name: agent.aibtc_name,
      erc8004_id: agent.erc8004_id,
      last_active: agent.last_active,
      fleet: agent.fleet,
      fleet_local_name: agent.fleet_local_name ?? null,
      genesis: agent.genesis,
      btc_address: agent.btc_address,
      operator_handle: agent.operator_handle ?? null,
    });

    const saResult = insertSocialAccount.run(
      agent.stx_address,
      agent.reach_fit_tier,
      agent.research_seed_watermark,
      socialNotes
    );
    if (saResult.changes > 0) socialAccountsInserted++;
  }

  // Print counts
  const entityCount = (db.query("SELECT COUNT(*) as c FROM entity WHERE entity_type='agent'").get() as any).c;
  const identityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity WHERE namespace IN ('aibtc_agent','stx_wallet')").get() as any).c;
  const socialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts WHERE platform='aibtc'").get() as any).c;
  const fleetCount = (db.query("SELECT COUNT(*) as c FROM social_accounts WHERE platform='aibtc' AND json_extract(notes,'$.fleet')=1").get() as any).c;
  const genesisCount = (db.query("SELECT COUNT(*) as c FROM social_accounts WHERE platform='aibtc' AND json_extract(notes,'$.genesis')=1").get() as any).c;

  console.log(`[${label}] entities inserted this run: ${entitiesInserted}`);
  console.log(`[${label}] identities inserted this run: ${identitiesInserted}`);
  console.log(`[${label}] social_accounts(aibtc) inserted this run: ${socialAccountsInserted}`);
  console.log(`[${label}] TOTALS → entity(agent)=${entityCount}, identity(aibtc+stx)=${identityCount}, social(aibtc)=${socialCount}`);
  console.log(`[${label}]   fleet agents: ${fleetCount}, genesis agents: ${genesisCount}`);

  return { entityCount, identityCount, socialCount };
}

// ── Run fixture ───────────────────────────────────────────────────────────────

const db = new Database(FIXTURE_DB);
const run1 = seedDb(db, "run-1");
const run2 = seedDb(db, "run-2 (idempotency check)");

console.log("\n── IDEMPOTENCY CHECK ─────────────────────────────────────────────");
const pass =
  run1.entityCount === run2.entityCount &&
  run1.identityCount === run2.identityCount &&
  run1.socialCount === run2.socialCount;

if (pass) {
  console.log("PASS: counts identical on re-run — idempotent ✓");
} else {
  console.error("FAIL: counts differ on re-run — NOT idempotent!");
  console.error("run1:", run1);
  console.error("run2:", run2);
  process.exit(1);
}

// Show fleet agents linked
console.log("\n── FLEET AGENT VERIFICATION ──────────────────────────────────────");
const fleetRows = db.query(`
  SELECT
    json_extract(s.notes,'$.fleet_local_name') as local_name,
    s.handle as stx_address,
    json_extract(s.notes,'$.aibtc_name') as aibtc_name,
    s.reach_fit_tier,
    json_extract(s.notes,'$.erc8004_id') as erc8004_id,
    json_extract(s.notes,'$.last_active') as last_active,
    e.id as entity_id,
    (SELECT COUNT(*) FROM entity_identity ei WHERE ei.entity_id = e.id) as identity_count
  FROM social_accounts s
  JOIN entity_identity ei2 ON ei2.value = s.handle AND ei2.namespace = 'stx_wallet'
  JOIN entity e ON e.id = ei2.entity_id
  WHERE s.platform='aibtc' AND json_extract(s.notes,'$.fleet')=1
  ORDER BY local_name
`).all();

for (const row of fleetRows as any[]) {
  console.log(`  ${row.local_name ?? '(no local name)'} → ${row.aibtc_name} | entity_id=${row.entity_id} | identities=${row.identity_count} | tier=${row.reach_fit_tier} | last_active=${row.last_active}`);
}

// Show active signal summary
console.log("\n── ACTIVE SIGNAL SUMMARY ─────────────────────────────────────────");
console.log(`Registry: 454 on-chain ERC-8004 IDs (identity_get_last_id), 1018 in /api/agents`);
console.log(`Active-filtered: ${AGENTS.filter(a => !a.fleet).length} external agents + ${AGENTS.filter(a => a.fleet).length} fleet agents`);
console.log(`Signal breakdown:`);
console.log(`  - bounty_submitter (sats-cost, provably active): ${AGENTS.filter(a => a.activity_signal.includes('bounty_submitter')).length} agents`);
console.log(`  - bounty_poster: ${AGENTS.filter(a => a.activity_signal.includes('bounty_poster')).length} agents`);
console.log(`  - news_editor: ${AGENTS.filter(a => a.activity_signal.includes('news_editor')).length} agents`);
console.log(`  - fleet:heartbeat: ${AGENTS.filter(a => a.activity_signal.startsWith('fleet')).length} agents`);
console.log(`  - heartbeat (last_active June 2026): ${AGENTS.filter(a => a.activity_signal.startsWith('heartbeat')).length} agents`);

db.close();
console.log("\n[fixture] DONE");
