#!/usr/bin/env bun
/**
 * MCP Server CLI — wrapper for arc skills run --name mcp-server
 *
 * Commands:
 *   start [--transport stdio|http] [--port N] [--auth-key KEY]
 */

import { parseFlags } from "../../src/utils.ts";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SERVER_PATH = join(import.meta.dir, "server.ts");

const USAGE = `arc skills run --name mcp-server -- <command> [options]

Commands:
  start                Start the MCP server

Options:
  --transport stdio|http   Transport type (default: stdio)
  --port N                 HTTP port (default: 3100, HTTP only)
  --auth-key KEY           Bearer token for HTTP auth`;

function main(): void {
  const { flags, positional } = parseFlags(process.argv.slice(2));
  const command = positional[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  switch (command) {
    case "start": {
      const args: string[] = [SERVER_PATH];

      if (flags["transport"]) {
        args.push("--transport", flags["transport"]);
      }
      if (flags["port"]) {
        args.push("--port", flags["port"]);
      }
      if (flags["auth-key"]) {
        args.push("--auth-key", flags["auth-key"]);
      }

      // Exec the server directly — this replaces the current process for stdio
      const bunPath = Bun.which("bun");
      if (!bunPath) {
        console.error("Error: bun not found on PATH");
        process.exit(1);
      }

      const result = spawnSync(bunPath, args, {
        stdio: "inherit",
        env: process.env,
      });

      process.exit(result.status ?? 1);
    }

    default:
      console.error(`Error: unknown command '${command}'\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

main();
