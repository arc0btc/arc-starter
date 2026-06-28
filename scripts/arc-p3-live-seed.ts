/**
 * arc-p3-live-seed.ts
 * Phase 3 LIVE seed: Human seed list against /home/dev/arc-starter/db/arc.sqlite
 * Run ONLY after fixture passes ALL checks. .bak is created before this runs.
 *
 * Same logic as arc-p3-fixture-seed.ts but targets the live DB.
 * Idempotent: safe to re-run (entity_identity UNIQUE + social_accounts.handle UNIQUE).
 */

import Database from "bun:sqlite";

const LIVE_DB = "/home/dev/arc-starter/db/arc.sqlite";
const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const WATERMARK = "operator_ground_truth:2026-06-27";
const QUASAR_GARUDA_ENTITY_ID = 7;

interface EntityDef {
  label: string;
  entity_type: "human" | "org";
  notes: object;
  x_handle: string;
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

function log(msg: string) {
  console.log(`[p3-live-seed] ${msg}`);
}

function upsertEntity(db: Database, e: EntityDef): number {
  const existing = db.query(
    "SELECT entity_id FROM entity_identity WHERE namespace='x_handle' AND value=?"
  ).get(e.x_handle) as any;
  if (existing) return existing.entity_id;

  db.prepare(
    "INSERT INTO entity (label, entity_type, notes, created_at, updated_at) VALUES (?,?,?,?,?)"
  ).run(e.label, e.entity_type, JSON.stringify(e.notes), NOW, NOW);
  const entityRow = db.query("SELECT last_insert_rowid() as id").get() as any;
  const entityId = entityRow.id;
  db.prepare(
    "INSERT OR IGNORE INTO entity_identity (entity_id, namespace, value, created_at) VALUES (?,?,?,?)"
  ).run(entityId, "x_handle", e.x_handle, NOW);
  return entityId;
}

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

function run() {
  log(`Opening live DB: ${LIVE_DB}`);
  const db = new Database(LIVE_DB);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  const preEntityCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
  const preSocialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts").get() as any).c;
  const preIdentityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity").get() as any).c;
  log(`Pre-counts: entities=${preEntityCount}, identities=${preIdentityCount}, social=${preSocialCount}`);

  log("Inserting human/org entities (KEEP+ADD+AMPLIFIERS)...");
  let entitiesInserted = 0;
  for (const e of HUMAN_ENTITIES) {
    const preCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
    const eid = upsertEntity(db, e);
    const postCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
    if (postCount > preCount) entitiesInserted++;
    upsertSocial(db, e, eid);
    log(`  ${e.label} (${e.entity_type}) → entity_id=${eid} ${postCount > preCount ? "[NEW]" : "[EXISTING]"}`);
  }

  log("Inserting DROP records...");
  let dropsInserted = 0;
  for (const d of DROP_HANDLES) {
    const notes = JSON.stringify({
      source: "operator_ground_truth:2026-06-27",
      reason_tag: d.reason_tag,
      drop: true,
      description: d.description,
    });
    const result = db.prepare(
      `INSERT OR IGNORE INTO social_accounts
         (handle, platform, targeting_status, reach_fit_tier, research_seed, research_seed_watermark, is_agent, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(d.handle, "x", "blocked", null, 0, WATERMARK, 0, notes, NOW, NOW);
    if (result.changes) dropsInserted++;
    log(`  DROP: ${d.handle} (${d.reason_tag}) ${result.changes ? "[NEW]" : "[EXISTING]"}`);
  }

  const postEntityCount = (db.query("SELECT COUNT(*) as c FROM entity").get() as any).c;
  const postHumanOrgCount = (db.query("SELECT COUNT(*) as c FROM entity WHERE entity_type IN ('human','org')").get() as any).c;
  const postSocialCount = (db.query("SELECT COUNT(*) as c FROM social_accounts").get() as any).c;
  const postIdentityCount = (db.query("SELECT COUNT(*) as c FROM entity_identity").get() as any).c;

  db.close();

  console.log("\n=== Live Seed Summary ===");
  console.log(`Entities: ${preEntityCount} → ${postEntityCount} (new: ${postEntityCount - preEntityCount})`);
  console.log(`Identities: ${preIdentityCount} → ${postIdentityCount} (new: ${postIdentityCount - preIdentityCount})`);
  console.log(`Social accounts: ${preSocialCount} → ${postSocialCount} (new: ${postSocialCount - preSocialCount})`);
  console.log(`Human/org entities: ${postHumanOrgCount}`);
  console.log(`entities_inserted: ${entitiesInserted}`);
  console.log(`drops_inserted: ${dropsInserted}`);
}

run();
