// arc-artifacts CLI — query + pretty-print over the source-artifact pool.
//
// Read-only inspection: produced counts, consumption claims, stuck-distill alerts.
// Used during smoke + soak verification and by arc-reporting's watch report
// (which embeds the audit summary under "## Inflow pool").

import { initDatabase, getDatabase } from "../../src/db.ts";
import {
  ARTIFACT_TYPES,
  ARTIFACT_CHANNELS,
  countByType,
  countConsumedByChannel,
  recentArtifacts,
  vacuumExpired,
  type ArtifactType,
  type ArtifactChannel,
} from "../../src/artifacts.ts";

function fail(message: string): never {
  process.stderr.write(`arc-artifacts: ${message}\n`);
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(
    [
      "arc-artifacts CLI",
      "",
      "  audit [--since <hours>]     Print produced/consumed counts per type/channel.",
      "                              Default --since 24.",
      "  list <type> [--limit N]     List recent artifacts of a type (with topic, citation).",
      "  vacuum                      Run vacuumExpired() once. Prints {soft, hard, orphanFiles}.",
      "  stuck-check                 Print warnings for types with no fresh artifact in 36h.",
      "                              Used by watch-report integration.",
      "",
    ].join("\n"),
  );
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function audit(sinceHours: number): void {
  const byType = countByType(sinceHours);
  const byChannel = countConsumedByChannel(sinceHours);
  process.stdout.write(`Inflow pool audit — last ${sinceHours}h\n`);
  process.stdout.write("\nProduced (by type):\n");
  for (const type of ARTIFACT_TYPES) {
    process.stdout.write(`  ${type.padEnd(20)} ${byType[type]}\n`);
  }
  process.stdout.write("\nConsumed (by channel):\n");
  for (const ch of ARTIFACT_CHANNELS) {
    process.stdout.write(`  ${ch.padEnd(20)} ${byChannel[ch]}\n`);
  }
  const db = getDatabase();
  const softDel = db.query("SELECT COUNT(*) AS n FROM distilled_artifacts WHERE deleted_at IS NOT NULL").get() as { n: number };
  process.stdout.write(`\nSoft-deleted (awaiting grace expiry): ${softDel.n}\n`);
}

function listType(type: string, limit: number): void {
  if (!(ARTIFACT_TYPES as readonly string[]).includes(type)) {
    fail(`unknown type ${type}. Valid: ${ARTIFACT_TYPES.join(", ")}`);
  }
  const items = recentArtifacts(type as ArtifactType, { limit });
  if (items.length === 0) {
    process.stdout.write(`(no ${type} artifacts in pool)\n`);
    return;
  }
  for (const a of items) {
    process.stdout.write(
      `${a.id}\n  topic: ${a.topic}\n  title: ${a.title}\n  citation: ${a.citation}\n  channels: ${a.suggested_channels.join(",")}\n\n`,
    );
  }
}

function stuckCheck(): { type: ArtifactType; ageHours: number | null }[] {
  // Returns types whose most recent artifact is older than 36h (or no row at all).
  const db = getDatabase();
  const stuck: { type: ArtifactType; ageHours: number | null }[] = [];
  for (const type of ARTIFACT_TYPES) {
    const row = db
      .query("SELECT MAX(produced_at) AS latest FROM distilled_artifacts WHERE type = ? AND deleted_at IS NULL")
      .get(type) as { latest: string | null };
    if (!row?.latest) {
      stuck.push({ type, ageHours: null });
      continue;
    }
    const ageHours = (Date.now() - Date.parse(row.latest)) / (60 * 60 * 1000);
    if (ageHours > 36) stuck.push({ type, ageHours });
  }
  return stuck;
}

function printStuck(): void {
  const stuck = stuckCheck();
  if (stuck.length === 0) {
    process.stdout.write("OK — every type has a fresh artifact in last 36h.\n");
    return;
  }
  for (const s of stuck) {
    if (s.ageHours === null) {
      process.stdout.write(`⚠️  ${s.type}: no artifacts ever produced (gate off or sensor stalled)\n`);
    } else {
      process.stdout.write(`⚠️  ${s.type}: latest is ${s.ageHours.toFixed(1)}h old (>36h threshold)\n`);
    }
  }
}

/** Used by arc-reporting watch task — small JSON dump fit for embedding. */
export function inflowSummary(sinceHours = 24): {
  since_hours: number;
  produced: Record<ArtifactType, number>;
  consumed: Record<ArtifactChannel, number>;
  stuck: { type: ArtifactType; age_hours: number | null }[];
} {
  return {
    since_hours: sinceHours,
    produced: countByType(sinceHours),
    consumed: countConsumedByChannel(sinceHours),
    stuck: stuckCheck().map((s) => ({ type: s.type, age_hours: s.ageHours })),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  initDatabase();
  const { positional, flags } = parseFlags(args.slice(1));
  switch (command) {
    case "audit": {
      const sinceHours = Number(flags.since ?? 24);
      audit(sinceHours);
      break;
    }
    case "list": {
      const type = positional[0];
      if (!type) fail("list requires a type argument");
      const limit = Number(flags.limit ?? 10);
      listType(type, limit);
      break;
    }
    case "vacuum": {
      const result = vacuumExpired();
      process.stdout.write(`vacuum: ${JSON.stringify(result)}\n`);
      break;
    }
    case "stuck-check": {
      printStuck();
      break;
    }
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
