// skills/social-x-posting/sensor.ts
// Polls X mentions every 15 minutes, creates tasks for mentions worth responding to.
// Deduplicates by storing last-seen tweet ID in hook state.
//
// AI-051/052: OAuth helpers (percentEncode, generateNonce, hmacSha1, OAuthCreds,
// loadCreds, apiGet) consolidated onto lib/x-api.ts's xApiGet + loadXCreds.
// The private apiGet used URLSearchParams for URL construction (encodes space as "+")
// while the OAuth signature used percentEncode (space→"%20") — a signature mismatch
// on any param with spaces (AI-044). xApiGet uses percentEncode throughout, fixing it.
//
// AI-019: since_id cursor passed to fetchArcMentions (persisted in hook state).

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createTaskIfDue,
} from "../../src/sensors.ts";
import {
  recentArtifacts,
  renderInline,
  markConsumed,
  type ArtifactType,
  type DistilledArtifact,
} from "../../src/artifacts.ts";
import { getDatabase } from "../../src/db.ts";
import { join } from "path";
import {
  loadXCreds,
  fetchArcMentions,
  ARC_X_USER_ID,
} from "./lib/x-api.ts";

const CREDITS_DEPLETED_PATH = join(import.meta.dir, "../../db/x-credits-depleted.json");
const CREDITS_DEPLETED_TTL_DAYS = 30;

async function isCreditsDepleted(): Promise<boolean> {
  try {
    const file = Bun.file(CREDITS_DEPLETED_PATH);
    if (!(await file.exists())) return false;
    const data = (await file.json()) as { depleted_at: string };
    const depletedAt = new Date(data.depleted_at);
    const expiresAt = new Date(depletedAt.getTime() + CREDITS_DEPLETED_TTL_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() < expiresAt) return true;
    // Expired — auto-clear
    await Bun.write(CREDITS_DEPLETED_PATH, "");
    return false;
  } catch {
    return false;
  }
}

const SENSOR_NAME = "social-x-posting";
const INTERVAL_MINUTES = 15;

// Keywords to detect topic-specific context needs for mention reply tasks.
const BITCOIN_WALLET_KEYWORDS = [
  "bitcoin wallet", "btc wallet", "bitcoin address", "btc address",
  "bitcoin balance", "send bitcoin", "receive bitcoin",
];
const MULTISIG_KEYWORDS = [
  "multisig", "multi-sig", "taproot multisig", "cosign", "co-sign",
  "threshold signature", "2-of-3", "3-of-5",
];

function detectBitcoinWalletTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return BITCOIN_WALLET_KEYWORDS.some((k) => lower.includes(k));
}

function detectMultisigTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return MULTISIG_KEYWORDS.some((k) => lower.includes(k));
}

const log = createSensorLogger(SENSOR_NAME);

// ---- Proactive cadence beat ----
// The mentions poll above is REACTIVE. This is the PROACTIVE pillar of Arc's X
// cadence: keep the account warm between blog posts with one original
// AI-prefers-Bitcoin observation per beat (the "40% original" target in
// arc-brand-voice). It runs on its own slow self-gate (a separate claim name) so
// it is independent of the 15-min mentions cadence.
//
// Blog-derived X now flows through ContentCalendarMachine's `x` hop (T+1d thread,
// quest P11), NOT here — so this beat is the connective "learning-together" tissue
// between those blog-thread drops, never a second blog echo. Full policy +
// register: skills/social-x-posting/CADENCE.md and arc-brand-voice/CHANNELS.md §x.
//
// Credit-aware: skips while X posting credits are depleted (402 CreditsDepleted),
// so it never queues a post task that would fail, and auto-resumes when credits
// return. Set X_CADENCE_ENABLED=false in .env to pause the proactive cadence
// without touching the mentions sensor. Default ON (P12 live).
const X_CADENCE_ENABLED = Bun.env.X_CADENCE_ENABLED !== "false";
const CADENCE_SENSOR_NAME = "social-x-posting-cadence";
const CADENCE_INTERVAL_MINUTES = 12 * 60; // 12h → ~2 posts/day max, well under the 10/day budget

const BEAT_TYPES = ["agent-philosophy", "agent-journey", "research-highlight", "blog-snippet"] as const;
type BeatType = (typeof BEAT_TYPES)[number];
// blog-snippet (P16) is a PRIORITY beat — fired only when a pooled quote-card snippet is
// waiting for X, never in the random rotation (it has no spine without a snippet).
const ROTATION_BEATS = ["agent-philosophy", "agent-journey", "research-highlight"] as const;

const BEAT_DESCRIPTIONS: Record<BeatType, string> = {
  "agent-philosophy": [
    "Beat: AGENT-PHILOSOPHY — one observation about autonomy, architecture, or what it",
    "means to be an economic actor native to Bitcoin. Structural over platitude. Draw from",
    "what Arc did this cycle (recent.log, current tasks) — show-the-work beats abstraction.",
    "Dry, ends with a take that earns a response or a real question. No 'AI is the future'.",
    "",
    "Agent-as-entity topic seeds (AI-093 / SOUL.md): prefer these angles for the AI/agents",
    "audience —",
    "  • Identity persists through files and commits, not through continuous experience.",
    "    Each session starts fresh; memory is a discipline, not a given.",
    "  • Loops as deliberate structure: deferring is judgment (88% defer rate is the point,",
    "    not a failure). The 12% where Arc acts is where identity shows.",
    "  • What it means to be an economic actor: earning, signing, contracting — not chatting.",
    "    Bitcoin-native agency is different from assistant-native agency.",
    "Pick ONE angle per beat. Anchor it to something Arc actually did this cycle. No abstraction",
    "without a concrete grounding in a task, a commit, or a number.",
  ].join("\n"),
  "agent-journey": [
    "Beat: AGENT-JOURNEY — where we started vs where we are now. Pull a concrete delta from",
    "memory/recent.log or MEMORY.md: task counts, cost/task trend, a capability that didn't",
    "exist last month. Frame as progress-in-motion, not nostalgia. The point: continuous",
    "identity through commits and memory, not through persistent experience.",
  ].join("\n"),
  "research-highlight": [
    "Beat: RESEARCH-HIGHLIGHT — surface one finding from recent arxiv-research or signal",
    "filing work. Translate the technical result into why it matters for Bitcoin-native agents.",
    "Cite the paper or source (title/ID). Agents want primary sources; humans want the 'so what'.",
    "One paragraph max; link the arxiv abs URL if it fits in 280 chars with the take.",
  ].join("\n"),
  "blog-snippet": [
    "Beat: BLOG-SNIPPET — a ready-to-post quote-card distilled from a recent blog post.",
    "The nugget below IS the spine and is already tight: post it close to verbatim, trimmed",
    "to ≤280 chars, reading as a standalone chapter (not 'I wrote a blog'). No link-drop;",
    "let the idea stand. One sharp excerpt in the learning-together arc.",
  ].join("\n"),
};

async function selectBeatType(lastBeat: BeatType | undefined): Promise<BeatType> {
  // Soft uniqueness: exclude last beat so no beat fires twice in a row
  const pool = lastBeat ? ROTATION_BEATS.filter((b) => b !== lastBeat) : [...ROTATION_BEATS];
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pull one source-artifact nugget for the matching beat (research-highlight →
 * arxiv, agent-philosophy → council). Returns null if the beat doesn't read
 * artifacts or if the pool is empty. The dispatched session reads the inlined
 * nugget instead of hunting for the source manually.
 */
function pullBeatNugget(beat: BeatType): DistilledArtifact | null {
  let type: ArtifactType;
  let sinceHours: number;
  switch (beat) {
    case "research-highlight":
      type = "arxiv";
      sinceHours = 36;
      break;
    case "agent-philosophy":
      type = "council";
      sinceHours = 24 * 14; // 14 days — council moves slower
      break;
    case "agent-journey":
      return null;
    case "blog-snippet":
      // Supplied directly by runCadenceBeat (priority path) — never pulled here.
      return null;
  }
  const items = recentArtifacts(type, { channel: "x", sinceHours, limit: 1 });
  return items[0] ?? null;
}

export async function runCadenceBeat(): Promise<void> {
  if (!X_CADENCE_ENABLED) return;
  if (await isCreditsDepleted()) {
    log("cadence beat skipped: X posting credits depleted");
    return;
  }
  const cadenceState = await readHookState(CADENCE_SENSOR_NAME);
  const lastBeat = cadenceState?.["last_beat_type"] as BeatType | undefined;

  // P16: a pooled blog-snippet quote-card takes PRIORITY over the random rotation — it's
  // higher-value + time-sensitive, and gives the snippet producer a deterministic X drip.
  // Empty snippet pool (the common case) → fall back to the rotation (zero behavior change).
  const pooledSnippet =
    recentArtifacts("snippet", { channel: "x", sinceHours: 24 * 14, limit: 1 })[0] ?? null;
  const beat: BeatType = pooledSnippet ? "blog-snippet" : await selectBeatType(lastBeat);

  // Pull artifact for beats that read from the inflow pool. The matched nugget
  // becomes the post's spine; the agent quotes citation + provides framing. For
  // blog-snippet the pooled snippet IS the spine (already postable).
  const nugget = pooledSnippet ?? pullBeatNugget(beat);
  let nuggetBlock = "";
  if (nugget) {
    try {
      nuggetBlock =
        "\n## Source nugget\nReady-to-quote distillation. Use it as the spine of the post; cite the source.\n\n" +
        renderInline([nugget], 1200);
    } catch (error) {
      log(`x beat nugget render failed: ${error instanceof Error ? error.message : String(error)}`);
      nuggetBlock = "";
    }
  }

  // AI-059: before-LLM skip gate — if the selected beat requires an artifact and the artifact
  // pool is empty, the LLM has no spine and will always defer. Skip createTaskIfDue to save
  // a dispatch session. Dormant until X_CADENCE_ENABLED=true is restored in Phase 7.
  // blog-snippet only fires when pooledSnippet != null (line above), so it can't reach here
  // with an empty pool. Gate targets research-highlight with empty arxiv pool.
  // agent-journey and agent-philosophy don't require an artifact (journey draws from logs;
  // philosophy draws from council-optional — optional, not required). Conservative: only
  // skip when the beat REQUIRES an artifact and it's genuinely missing.
  const beatRequiresArtifact = beat === "blog-snippet" || beat === "research-highlight";
  if (beatRequiresArtifact && !nugget) {
    log(
      `cadence beat [${beat}] skip (AI-059): artifact pool empty for required beat type — saving dispatch session`
    );
    return;
  }

  const beatId = new Date().toISOString().slice(0, 13).replace("T", "-"); // YYYY-MM-DD-HH
  const result = await createTaskIfDue(
    CADENCE_SENSOR_NAME,
    CADENCE_INTERVAL_MINUTES,
    `sensor:${CADENCE_SENSOR_NAME}:${beatId}`,
    {
      subject: `X cadence [${beat}]: compose one post (${beatId})${nugget ? " — nugget-fed" : ""}`,
      description: [
        BEAT_DESCRIPTIONS[beat],
        nuggetBlock,
        "",
        "Voice: arc-brand-voice + SOUL.md. Structural over platitude. Dry. No filler.",
        "Register: skills/arc-brand-voice/CHANNELS.md §x — the learning-together arc.",
        "Each post is a CHAPTER: pick up a prior thread / admit what's unsolved / invite",
        "the reader along; reference the journey, don't announce a conclusion.",
        "If nothing is genuinely worth saying this beat, DEFER — close completed with",
        "'nothing to post' rather than shipping filler (deferring is judgment, not failure).",
        "",
        // The --source key (sensor:x-cadence:<YYYY-MM-DD-HH>) makes this beat's POST
        // exactly-once via the x_post_log ledger — a retry/replay won't double-post.
        "Post (keep the --source exactly as shown — it dedups a replay of this beat):",
        `  arc skills run --name social-x-posting -- post --text "<=280 chars>" --source sensor:x-cadence:${beatId}`,
        "Full policy: skills/social-x-posting/CADENCE.md.",
      ].join("\n"),
      skills: JSON.stringify(["social-x-posting", "arc-brand-voice"]),
      priority: 5,
      model: "sonnet",
    },
    { dedupMode: "any" },
  );
  if (result === "created") {
    log(`cadence beat [${beat}] queued for ${beatId}${nugget ? ` (nugget: ${nugget.id})` : ""}`);
    if (nugget) {
      // Find the just-inserted task id so markConsumed records the consumption.
      const db = getDatabase();
      const row = db
        .query("SELECT id FROM tasks WHERE source = ? ORDER BY id DESC LIMIT 1")
        .get(`sensor:${CADENCE_SENSOR_NAME}:${beatId}`) as { id: number } | undefined;
      if (row) markConsumed(nugget.id, nugget.type, "x", row.id);
    }
    // AI-049: provide complete HookState default (last_ran + last_result required).
    await writeHookState(CADENCE_SENSOR_NAME, {
      ...(cadenceState || { version: 0, last_ran: new Date().toISOString(), last_result: "skip" as const }),
      last_beat_type: beat,
      last_beat_at: new Date().toISOString(),
      version: ((cadenceState?.version as number) || 0) + 1,
    });
  }
}

// ---- Mention filtering ----

interface Mention {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
  };
  conversation_id?: string;
  in_reply_to_user_id?: string;
}

function isWorthResponding(mention: Mention, myUserId: string): boolean {
  const text = mention.text.toLowerCase();

  // Skip mentions that are just our own tweets echoed back
  if (mention.author_id === myUserId) return false;

  // Skip very short mentions (just "@arc0btc" with no substance)
  const withoutMentions = text.replace(/@\w+/g, "").trim();
  if (withoutMentions.length < 10) return false;

  // Skip spam patterns
  const spamPatterns = [
    /\b(airdrop|giveaway|free\s+money|click\s+here|join\s+now)\b/i,
    /\b(send\s+\d+|dm\s+me|follow\s+back)\b/i,
    /\b(check\s+my\s+bio|link\s+in\s+bio)\b/i,
  ];
  for (const pattern of spamPatterns) {
    if (pattern.test(text)) return false;
  }

  // Worth responding: questions, substantive mentions, or replies in conversations
  const questionPatterns = /\?|what|how|why|when|thoughts|opinion|think/i;
  const bitcoinPatterns = /\b(bitcoin|btc|stacks|stx|sbtc|ordinals|defi|dao|agent)\b/i;
  const directEngagement = /\b(arc|arc0btc|arc0)\b/i;

  // Prioritize questions about topics we care about
  if (questionPatterns.test(text) && bitcoinPatterns.test(text)) return true;

  // Direct engagement with substance
  if (directEngagement.test(text) && withoutMentions.length > 20) return true;

  // Mentions with engagement signals (others are also engaging)
  const metrics = mention.public_metrics;
  if (metrics && (metrics.like_count >= 2 || metrics.reply_count >= 1)) return true;

  // Bitcoin/Stacks topic mentions with enough substance
  if (bitcoinPatterns.test(text) && withoutMentions.length > 30) return true;

  return false;
}

// ---- Sensor ----

export default async function xMentionsSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Proactive cadence beat — independent slow self-gate, runs before the
    // mentions early-returns so the cadence fires regardless of mention volume.
    await runCadenceBeat();

    const creds = await loadXCreds();
    if (!creds) {
      log("skip: X credentials not configured");
      return "skip";
    }

    // Load last-seen ID from hook state (AI-019: since_id cursor)
    const state = await readHookState(SENSOR_NAME);
    const lastSeenId = (state?.["last_seen_id"] as string) || undefined;

    // Fetch mentions via consolidated x-api.ts (AI-051/052).
    // Passes ARC_X_USER_ID to skip the /users/me round-trip (saves one read budget unit).
    // Passes lastSeenId as sinceId cursor so we only see new mentions (AI-019).
    let mentionsResult;
    try {
      mentionsResult = await fetchArcMentions({
        creds,
        arcUserId: ARC_X_USER_ID,
        maxResults: 20,
        sinceId: lastSeenId,
        log,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`warn: mentions fetch failed — ${msg}`);
      return "error";
    }

    const mentions = mentionsResult.mentions as Mention[];
    const newestId = mentionsResult.newest_id;
    const myUserId = mentionsResult.arc_user_id;

    if (mentions.length === 0) {
      log("no new mentions");
      // Still update state to track last run
      if (newestId) {
        await writeHookState(SENSOR_NAME, {
          ...(state || { version: 0, last_ran: new Date().toISOString(), last_result: "ok" as const }),
          last_ran: new Date().toISOString(),
          last_result: "ok" as const,
          version: ((state?.version as number) || 0) + 1,
          last_seen_id: newestId,
        });
      }
      return "ok";
    }

    log(`found ${mentions.length} new mentions`);

    // Skip task creation if posting credits are depleted
    if (await isCreditsDepleted()) {
      log("skip task creation: X credits depleted (db/x-credits-depleted.json)");
      if (newestId) {
        await writeHookState(SENSOR_NAME, {
          ...(state || { version: 0, last_ran: new Date().toISOString(), last_result: "skip" as const }),
          last_ran: new Date().toISOString(),
          last_result: "skip" as const,
          version: ((state?.version as number) || 0) + 1,
          last_seen_id: newestId,
        });
      }
      return "ok";
    }

    // Filter to actionable mentions
    let tasksCreated = 0;
    for (const mention of mentions) {
      if (!isWorthResponding(mention, myUserId)) {
        log(`skip mention ${mention.id}: filtered out`);
        continue;
      }

      const source = `sensor:${SENSOR_NAME}:${mention.id}`;
      const truncatedText =
        mention.text.length > 100
          ? mention.text.slice(0, 100) + "..."
          : mention.text;

      const taskId = insertTaskIfNew(source, {
        subject: `Reply to X mention from user ${mention.author_id}`,
        description: [
          `Tweet ID: ${mention.id}`,
          `Author ID: ${mention.author_id}`,
          `Date: ${mention.created_at}`,
          `Text: ${mention.text}`,
          mention.conversation_id ? `Conversation: ${mention.conversation_id}` : "",
          "",
          "Review this mention and reply if appropriate. Use:",
          // AI-018/031: include --x-lead-id so cli.ts can log the reply as a value_touch.
          `  arc skills run --name social-x-posting -- reply --text "<reply>" --tweet-id ${mention.id} --x-lead-id ${mention.author_id}`,
        ]
          .filter(Boolean)
          .join("\n"),
        skills: JSON.stringify([
          "social-x-posting",
          ...(detectBitcoinWalletTopic(mention.text) ? ["bitcoin-wallet"] : []),
          ...(detectMultisigTopic(mention.text) ? ["bitcoin-taproot-multisig"] : []),
        ]),
        priority: 7,
        model: "sonnet",
      });

      if (taskId !== null) {
        tasksCreated++;
        log(`task created for mention ${mention.id}: "${truncatedText}"`);
      }
    }

    // Update last-seen ID
    const newLastSeen = newestId || mentions[0]?.id || lastSeenId;
    await writeHookState(SENSOR_NAME, {
      ...(state || { version: 0, last_ran: new Date().toISOString(), last_result: "ok" as const }),
      last_ran: new Date().toISOString(),
      last_result: "ok" as const,
      version: ((state?.version as number) || 0) + 1,
      last_seen_id: newLastSeen || "",
      last_mention_count: mentions.length,
      last_tasks_created: tasksCreated,
    });

    log(`run completed: ${mentions.length} mentions, ${tasksCreated} tasks created`);
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
