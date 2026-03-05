#!/usr/bin/env bun
/**
 * Credential store CLI for arc-agent.
 * Accessible via: arc creds <command> [args]
 * Or: arc skills run --name credentials -- <command> [args]
 */

import { parseFlags } from "../../src/utils.ts";
import { credentials } from "./store.ts";

const USAGE = `arc creds <command> [options]

Commands:
  list                                    List stored credentials (names only, no values)
  get --service NAME --key NAME           Retrieve a credential value
  set --service NAME --key NAME --value V Add or update a credential
  delete --service NAME --key NAME        Remove a credential
  unlock                                  Verify password and show store info

Options:
  --password PW    Master password (overrides ARC_CREDS_PASSWORD env var)

Password: set ARC_CREDS_PASSWORD in .env or pass --password <pw>`;

/**
 * Require a set of named flags, exiting with a usage hint if any are missing.
 * Returns the flags as a typed record with non-null values.
 */
function requireFlags(
  flags: Record<string, string>,
  required: string[],
  usage: string,
): Record<string, string> {
  const missing = required.filter((f) => !flags[f]);
  if (missing.length > 0) {
    process.stderr.write(`Error: ${missing.map((f) => `--${f}`).join(", ")} required\n`);
    process.stderr.write(`Usage: ${usage}\n`);
    process.exit(1);
  }
  return flags;
}

/**
 * Handle a credential CLI invocation. Shared between `arc creds` (src/cli.ts)
 * and standalone `arc skills run --name credentials` (this file).
 */
export async function handleCredsCli(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const command = positional[0];

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE + "\n");
    process.exit(command ? 0 : 1);
  }

  const password = flags["password"] ?? process.env.ARC_CREDS_PASSWORD;

  try {
    switch (command) {
      case "list": {
        await credentials.unlock(password);
        const items = credentials.list();
        if (items.length === 0) {
          process.stdout.write("No credentials stored.\n");
        } else {
          const byService = Map.groupBy(items, (i) => i.service);
          for (const [service, creds] of byService) {
            process.stdout.write(`${service}/\n`);
            for (const c of creds) {
              const date = new Date(c.updatedAt).toLocaleDateString();
              process.stdout.write(`  ${c.key}  (updated: ${date})\n`);
            }
          }
        }
        break;
      }

      case "get": {
        const f = requireFlags(flags, ["service", "key"], "arc creds get --service NAME --key NAME");
        await credentials.unlock(password);
        const value = credentials.get(f["service"], f["key"]);
        if (value === null) {
          process.stderr.write(`Not found: ${f["service"]}/${f["key"]}\n`);
          process.exit(1);
        }
        process.stdout.write(value + "\n");
        break;
      }

      case "set": {
        const f = requireFlags(flags, ["service", "key", "value"], "arc creds set --service NAME --key NAME --value VALUE");
        await credentials.unlock(password);
        await credentials.set(f["service"], f["key"], f["value"]);
        process.stdout.write(`Set ${f["service"]}/${f["key"]}\n`);
        break;
      }

      case "delete": {
        const f = requireFlags(flags, ["service", "key"], "arc creds delete --service NAME --key NAME");
        await credentials.unlock(password);
        const deleted = await credentials.del(f["service"], f["key"]);
        process.stdout.write(deleted ? `Deleted ${f["service"]}/${f["key"]}\n` : `Not found: ${f["service"]}/${f["key"]}\n`);
        break;
      }

      case "unlock": {
        await credentials.unlock(password);
        const items = credentials.list();
        process.stdout.write(`Store: ${credentials.storePath()}\n`);
        process.stdout.write(`Credentials: ${items.length}\n`);
        break;
      }

      default:
        process.stderr.write(`Error: unknown command '${command}'\n\n`);
        process.stdout.write(USAGE + "\n");
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

// Standalone entry point
if (import.meta.main) {
  handleCredsCli(process.argv.slice(2));
}
