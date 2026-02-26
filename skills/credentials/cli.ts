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

Password: set ARC_CREDS_PASSWORD in .env or pass --password <pw>`.trim();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseFlags(argv);

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
        const service = flags["service"];
        const key = flags["key"];
        if (!service || !key) {
          process.stderr.write("Error: --service and --key are required\n");
          process.stderr.write("Usage: arc creds get --service NAME --key NAME\n");
          process.exit(1);
        }
        await credentials.unlock(password);
        const value = credentials.get(service, key);
        if (value === null) {
          process.stderr.write(`Not found: ${service}/${key}\n`);
          process.exit(1);
        }
        process.stdout.write(value + "\n");
        break;
      }

      case "set": {
        const service = flags["service"];
        const key = flags["key"];
        const value = flags["value"];
        if (!service || !key || !value) {
          process.stderr.write("Error: --service, --key, and --value are required\n");
          process.stderr.write("Usage: arc creds set --service NAME --key NAME --value VALUE\n");
          process.exit(1);
        }
        await credentials.unlock(password);
        await credentials.set(service, key, value);
        process.stdout.write(`Set ${service}/${key}\n`);
        break;
      }

      case "delete": {
        const service = flags["service"];
        const key = flags["key"];
        if (!service || !key) {
          process.stderr.write("Error: --service and --key are required\n");
          process.stderr.write("Usage: arc creds delete --service NAME --key NAME\n");
          process.exit(1);
        }
        await credentials.unlock(password);
        const deleted = await credentials.del(service, key);
        process.stdout.write(deleted ? `Deleted ${service}/${key}\n` : `Not found: ${service}/${key}\n`);
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

main();
