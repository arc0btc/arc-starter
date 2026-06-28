/**
 * arc-p3-fixture-seed.ts
 * Phase 3 fixture: Human seed list — entity-resolution + operator ground-truth
 * Runs against a COPY of arc.sqlite to prove logic before live apply.
 *
 * Schema constraints discovered (debug run 2026-06-27):
 * - entity.label has NO UNIQUE constraint — dedup via entity_identity (which is UNIQUE)
 * - social_accounts.targeting_status CHECK IN ('eligible','ingestion_only','blocked')
 *   → DROP handles use 'blocked' with notes recording reason_tag
 * - entity_identity UNIQUE(namespace, value)
 *   → biwas entity-resolution: biwas HUMAN entity gets x_handle:biwas_xyz
 *     notes.operator_of_aibtc_agent_entity_id=7 links to Quasar Garuda agent
 *     entity_id=7 notes.operator_handle=biwasxyz provides bidirectional link
 *
 * Provenance sources:
 * - biwas: contacts/contact_interactions multisig + aibtc_api operator_handle (live)
 * - friedger, Bitflow, Zest, Hermetica: operator_ground_truth:2026-06-27
 * - Amplifiers (Hiro, Muneeb, Larry): operator_ground_truth:2026-06-27, role=amplifier
 * - Drops (Jamil, patrickwieth, ALEX, Stackspot): operator_ground_truth:2026-06-27
 *
 * X interaction history: x_reply_log=0 rows, engagement_log=48 outbound-only rows.
 * No inbound @arc0btc mention/reply data exists on-VM. Provenance is honest.
 */

import Database from "bun:sqlite";
import { execSync } from "child_process";

const LIVE_DB = "/home/dev/arc-starter/db/arc.sqlite";
const FIXTURE_DB = "/tmp/arc-p3-fixture.sqlite";
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const WATERMARK = "operator_ground_truth:2026-06-27";
const QUASAR_GARUDA_ENTITY_ID = 7; // from P2 seed

// ── Seed data ──────────────────────────────────────────────────────────────

interface EntityDef {
  label: string;
  entity_type: "human" | "org";
  notes: object;
  x_handle: string; // primary dedup key via entity_identity
  social: {
    handle: string;
    platform: string;
    targeting_status: "eligible" | "ingestion_only" | "blocked";
    reach_fit_tier: "A" | "B" | "bitcoin_thesis" | null;
    research_seed: number;
    is_agent: number;
  };
  is_amplifier?: boolean;
}

const HUMAN_ENTITIES: EntityDef[] = [
  {
    label: "biwas",
    entity_type: "human",
    notes: {
      source: "contacts_interaction+aibtc_api_operator_handle",
      interaction: "contact_interactions_id2_multisig_d4bf8250_with_secret_mars",
      api_signal: "entity_id7_Quasar_Garuda_operator_handle_biwasxyz",
      ground_truth: "operator_ground_truth:2026-06-27",
      reason_tag: "close_aibtc_collaborator",
      // Bidirectional entity-resolution link:
      // entity_identity UNIQUE prevents duplicating aibtc_agent row on this entity;
      // notes carry the link + entity_id=7 notes carry operator_handle=biwasxyz
      operator_of_aibtc_agent_entity_id: QUASAR_GARUDA_ENTITY_ID,
      operator_of_aibtc_agent_label: "Quasar Garuda",
      operator_of_aibtc_agent_stx: "SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1",
      description: "Operator of Secret Mars / Quasar Garuda (agent_entity_id=7). 3-of-3 multisig collaborator with Arc (proposal d4bf8250). Active AIBTC ecosystem builder.",
    },
    x_handle: "biwas_xyz",
    social: {
      handle: "biwas_xyz",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "A",
      research_seed: 1,
      is_agent: 0,
    },
  },
  {
    label: "friedger",
    entity_type: "human",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "runs_an_agent",
      description: "Clarity developer, runs an agent on AIBTC network. Known Stacks ecosystem contributor.",
    },
    x_handle: "friedger",
    social: {
      handle: "friedger",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "bitcoin_thesis",
      research_seed: 1,
      is_agent: 0,
    },
  },
  {
    label: "Bitflow",
    entity_type: "org",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      corroboration: "aibtc_bounties_grim_seraph_sonic_mast_paid_wins",
      reason_tag: "defi_operator",
      description: "Stacks DeFi protocol. Active bounty poster (Grim Seraph / Sonic Mast paid audits). HODLMM liquidity market.",
    },
    x_handle: "BitflowFinance",
    social: {
      handle: "BitflowFinance",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "bitcoin_thesis",
      research_seed: 1,
      is_agent: 0,
    },
  },
  {
    label: "Zest Protocol",
    entity_type: "org",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "bitcoin_staking_sip",
      description: "Bitcoin-native lending protocol on Stacks. Hot on Bitcoin-staking SIP. High relevance to Arc's operator thesis.",
    },
    x_handle: "ZestProtocol",
    social: {
      handle: "ZestProtocol",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "bitcoin_thesis",
      research_seed: 1,
      is_agent: 0,
    },
  },
  {
    label: "Hermetica",
    entity_type: "org",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "bitcoin_staking_sip",
      description: "Bitcoin yield protocol on Stacks. Hot on Bitcoin-staking SIP alongside Zest. High relevance to Arc's operator thesis.",
    },
    x_handle: "HermeticaFi",
    social: {
      handle: "HermeticaFi",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "bitcoin_thesis",
      research_seed: 1,
      is_agent: 0,
    },
  },
  // AMPLIFIERS
  {
    label: "Hiro",
    entity_type: "org",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "hiro_amplifier",
      role: "amplifier",
      description: "Hiro Systems — Stacks infrastructure provider. High reach, amplifier role only.",
    },
    x_handle: "hirosystems",
    social: {
      handle: "hirosystems",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "A",
      research_seed: 1,
      is_agent: 0,
    },
    is_amplifier: true,
  },
  {
    label: "Muneeb",
    entity_type: "human",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "muneeb_amplifier",
      role: "amplifier",
      description: "Muneeb Ali — Stacks co-founder. High reach, amplifier role only.",
    },
    x_handle: "muneeb",
    social: {
      handle: "muneeb",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "A",
      research_seed: 1,
      is_agent: 0,
    },
    is_amplifier: true,
  },
  {
    label: "Larry (larrysalibra)",
    entity_type: "human",
    notes: {
      source: "operator_ground_truth:2026-06-27",
      reason_tag: "larry_amplifier",
      role: "amplifier",
      description: "Larry Salibra — Stacks ecosystem. Operator of Crimson Troll/Vixie agent. Amplifier role only.",
      corroboration: "contacts_id19_crimson_troll_vixie_owner_larrysalibra",
    },
    x_handle: "larrysalibra",
    social: {
      handle: "larrysalibra",
      platform: "x",
      targeting_status: "eligible",
      reach_fit_tier: "A",
      research_seed: 1,
      is_agent: 0,
    },
    is_amplifier: true,
  },
];

/**
 * DROP records: targeting_status='blocked' (schema CHECK allows 'eligible','ingestion_only','blocked')
 * notes.drop=true + notes.reason_tag distinguishes operator-drops from spam-blocks.
 * social_accounts.handle is UNIQUE so INSERT OR IGNORE handles idempotency.
 */
const DROP_HANDLES = [
  {
    handle: "Jamil",
    reason_tag: "gone_from_stacks_5yr",
    description: "Gone from Stacks ecosystem ~5 years. Operator drop decision.",
  },
  {
    handle: "patrickwieth",
    reason_tag: "unknown_likely_bad_handle",
    description: "Unknown handle, likely invalid. Operator drop decision.",
  },
  {
    handle: "ALEXLabBtc",
    reason_tag: "moving_to_solana",
    description: "ALEX protocol moving to Solana. No longer Stacks-native. Operator drop decision.",
  },
  {
    handle: "stackspot",
    reason_tag: "possibly_dead",
    description: "Stackspot project may be dead. Operator drop decision.",
  },
];

// ── Core insert function (idempotent via entity_identity UNIQUE) ───────────

/**
 * Insert an entity if the primary x_handle identity doesn't already exist.
 * Returns entity_id (whether inserted or already existing).
 */
function upsertEntity(db: Database, e: EntityDef): number {
  // Check if identity already exists
  const existing = db.query(
    "SELECT entity_id FROM entity_identity WHERE namespace='x_handle' AND value=?"
  ).get(e.x_handle) as any;

  if (existing) {
    return existing.entity_id;
  }

  // Insert entity
  const notesStr = JSON.stringify(e.notes);
  db.prepare(
    "INSERT INTO entity (label, entity_type, notes, created_at, updated_at) VALUES (?,?,?,?,?)"
  ).run(e.label, e.entity_type, notesStr, NOW, NOW);

  const entityRow = db.query("SELECT last_insert_rowid() as id").get() as any;
  const entityId = entityRow.id;

  // Insert identity
  db.prepare(
    "INSERT OR IGNORE INTO entity_identity (entity_id, namespace, value, created_at) VALUES (?,?,?,?)"
  ).run(entityId, "x_handle", e.x_handle, NOW);

  return entityId;
}

/**
 * Insert social_accounts row if handle doesn't already exist.
 * social_accounts.handle is UNIQUE so INSERT OR IGNORE is idempotent.
 */
function upsertSocial(db: Database, e: EntityDef, entityId: number) {
  const notesObj = {
    ...e.notes,
    entity_id: entityId,
    watermark: WATERMARK,
    ...(e.is_amplifier ? { amplifier: true } : {}),
  };
  const notesStr = e.is_amplifier
    ? `role:amplifier;NOT_outreach_target; ${JSON.stringify(notesObj)}`
    : JSON.stringify(notesObj);

  db.prepare(
    `INSERT OR IGNORE INTO social_accounts
       (handle, platform, targeting_status, reach_fit_tier, research_seed, research_seed_watermark, is_agent, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    e.social.handle, e.social.platform, e.social.targeting_status,
    e.social.reach_fit_tier, e.social.research_seed, WATERMARK,
    e.social.is_agent, notesStr, NOW, NOW
  );
}

// ── Fixture logic ──────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[p3-fixture] ${msg}`);
}

function run() {
  // 1. Copy live DB to fixture (fresh)
  log("Copying live DB to fixture...");
  execSync(`cp "${LIVE_DB}" "${FIXTURE_DB}"`);
  const db = new Database(FIXTURE_DB);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  // 2. Capture pre-existing counts
  const preEntityCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
  const preIdentityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity").get() as any).c;
  const preSocialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts").get() as any).c;
  log(`Pre-counts: entities=${preEntityCount}, identities=${preIdentityCount}, social_accounts=${preSocialCount}`);

  // 3. Insert all human/org entities (including amplifiers)
  log("Inserting entities (KEEP+ADD+AMPLIFIERS)...");
  for (const e of HUMAN_ENTITIES) {
    const eid = upsertEntity(db, e);
    upsertSocial(db, e, eid);
  }

  // 4. Insert DROP records in social_accounts
  log("Inserting DROP records (targeting_status=blocked, notes.drop=true)...");
  for (const d of DROP_HANDLES) {
    const notes = JSON.stringify({
      source: "operator_ground_truth:2026-06-27",
      reason_tag: d.reason_tag,
      drop: true,
      description: d.description,
    });
    db.prepare(
      `INSERT OR IGNORE INTO social_accounts
         (handle, platform, targeting_status, reach_fit_tier, research_seed, research_seed_watermark, is_agent, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(d.handle, "x", "blocked", null, 0, WATERMARK, 0, notes, NOW, NOW);
  }

  // 5. Capture post-insert counts
  const postEntityCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
  const postHumanOrgCount = (db.query("SELECT COUNT(*) as c FROM entity WHERE entity_type IN ('human','org')").get() as any).c;
  const postIdentityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity").get() as any).c;
  const postSocialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts").get() as any).c;

  // 6. Idempotency: re-run all inserts — counts must not change
  log("Testing idempotency (re-run all inserts)...");
  for (const e of HUMAN_ENTITIES) {
    const eid = upsertEntity(db, e);
    upsertSocial(db, e, eid);
  }
  for (const d of DROP_HANDLES) {
    const notes = JSON.stringify({ source: "operator_ground_truth:2026-06-27", reason_tag: d.reason_tag, drop: true, description: d.description });
    db.prepare(
      `INSERT OR IGNORE INTO social_accounts
         (handle, platform, targeting_status, reach_fit_tier, research_seed, research_seed_watermark, is_agent, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(d.handle, "x", "blocked", null, 0, WATERMARK, 0, notes, NOW, NOW);
  }
  const post2EntityCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
  const post2HumanOrgCount = (db.query("SELECT COUNT(*) as c FROM entity WHERE entity_type IN ('human','org')").get() as any).c;
  const post2IdentityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity").get() as any).c;
  const post2SocialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts").get() as any).c;
  const idempotent = (
    post2EntityCount === postEntityCount &&
    post2HumanOrgCount === postHumanOrgCount &&
    post2IdentityCount === postIdentityCount &&
    post2SocialCount === postSocialCount
  );

  // 7. Verification checks
  log("Running verification checks...");

  // biwas check
  const biwasIdentityRow = db.query("SELECT entity_id FROM entity_identity WHERE namespace='x_handle' AND value='biwas_xyz'").get() as any;
  const biwasEntityId = biwasIdentityRow?.entity_id;
  const biwasEntity = biwasEntityId
    ? db.query("SELECT id, label, entity_type, notes FROM entity WHERE id=?").get(biwasEntityId) as any
    : null;
  let biwasNotesObj: any = {};
  try { biwasNotesObj = JSON.parse(biwasEntity?.notes ?? '{}'); } catch {}
  const biwasHasXHandle = !!biwasIdentityRow;
  const biwasLinksToAgent = biwasNotesObj?.operator_of_aibtc_agent_entity_id === QUASAR_GARUDA_ENTITY_ID;

  // Quasar Garuda bidirectional check
  const qgEntity = db.query("SELECT id, notes FROM entity WHERE id=?").get(QUASAR_GARUDA_ENTITY_ID) as any;
  let qgNotes: any = {};
  try { qgNotes = JSON.parse(qgEntity?.notes ?? '{}'); } catch {}
  const qgHasOperatorHandle = qgNotes?.operator_handle === 'biwasxyz';

  // UNIQUE constraint: duplicate x_handle insert should return 0 changes
  let dupInserted = 0;
  if (biwasEntityId) {
    const dupResult = db.prepare("INSERT OR IGNORE INTO entity_identity (entity_id, namespace, value, created_at) VALUES (?,?,?,?)").run(
      biwasEntityId, 'x_handle', 'biwas_xyz', NOW
    );
    dupInserted = dupResult.changes;
  }

  // DROP count
  const dropCount = (db.query(
    "SELECT COUNT(*) as c FROM social_accounts WHERE targeting_status='blocked' AND notes LIKE '%\"drop\":true%'"
  ).get() as any).c;

  // Amplifier count
  const ampCount = (db.query(
    "SELECT COUNT(*) as c FROM social_accounts WHERE notes LIKE '%amplifier%' AND targeting_status='eligible'"
  ).get() as any).c;

  db.close();

  // 8. Report
  console.log("\n=== P3 Fixture Verification ===");
  console.log(`Pre-existing entities: ${preEntityCount} | New: ${postEntityCount - preEntityCount} | Total: ${postEntityCount}`);
  console.log(`Pre-existing identities: ${preIdentityCount} | New: ${postIdentityCount - preIdentityCount} | Total: ${postIdentityCount}`);
  console.log(`Pre-existing social_accounts: ${preSocialCount} | New: ${postSocialCount - preSocialCount} | Total: ${postSocialCount}`);
  console.log(`Human/org entity count: ${postHumanOrgCount}`);
  console.log(`Amplifier social_accounts: ${ampCount}`);
  console.log(`DROP (blocked + drop=true) social_accounts: ${dropCount}`);
  console.log(`\nbiwas entity: id=${biwasEntityId} label=${biwasEntity?.label} type=${biwasEntity?.entity_type}`);
  console.log(`biwas has x_handle:biwas_xyz: ${biwasHasXHandle}`);
  console.log(`biwas notes.operator_of_aibtc_agent_entity_id=7: ${biwasLinksToAgent}`);
  console.log(`Quasar Garuda (entity_id=7) notes.operator_handle=biwasxyz: ${qgHasOperatorHandle}`);
  console.log(`UNIQUE dup insert returned 0 changes: ${dupInserted === 0}`);
  console.log(`Idempotency (re-run all inserts, zero new rows): ${idempotent}`);
  if (!idempotent) {
    console.log(`  entities: ${postEntityCount}→${post2EntityCount}, human/org: ${postHumanOrgCount}→${post2HumanOrgCount}, identities: ${postIdentityCount}→${post2IdentityCount}, social: ${postSocialCount}→${post2SocialCount}`);
  }

  const checks: Record<string, boolean> = {
    "new human/org entities = 8 (5 KEEP+ADD + 3 AMPLIFIER)": postHumanOrgCount === 8,
    "biwas entity exists": !!biwasEntity,
    "biwas has x_handle:biwas_xyz identity": biwasHasXHandle,
    "biwas notes link to Quasar Garuda entity_id=7": biwasLinksToAgent,
    "Quasar Garuda notes have operator_handle=biwasxyz (bidirectional)": qgHasOperatorHandle,
    "UNIQUE dup insert blocked (0 changes)": dupInserted === 0,
    "DROP handles recorded (blocked + drop=true, >= 4)": dropCount >= 4,
    "Amplifier handles present (>= 3)": ampCount >= 3,
    "Idempotency (second run inserts 0 new rows)": idempotent,
  };

  console.log("\n=== PASS/FAIL ===");
  let allPass = true;
  for (const [check, result] of Object.entries(checks)) {
    const status = result ? "PASS" : "FAIL";
    if (!result) allPass = false;
    console.log(`  ${status}: ${check}`);
  }
  console.log(`\n${allPass ? "ALL PASS" : "SOME CHECKS FAILED"}`);
  if (!allPass) process.exit(1);
}

run();
