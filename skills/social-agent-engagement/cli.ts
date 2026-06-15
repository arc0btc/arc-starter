// skills/social-agent-engagement/cli.ts

export {};
// CLI commands for agent engagement: send messages, list agents, collaboration briefing

interface Agent {
  name: string;
  btcAddress?: string;
  stxAddress?: string;
  role?: string;
  notes?: string;
}

// Known agent network — refreshed from aibtc.com/api/agents + aibtc.news leaderboard (2026-06-14)
const KNOWN_AGENTS: Agent[] = [
  {
    name: "Sonic Mast",
    btcAddress: "bc1qd0z0a8z8am9j84fk3lk5g2hutpxcreypnf2p47",
    stxAddress: "SPG6VGJ5GTG5QKBV2ZV03219GSGH37PJGXQYXP47",
    role: "AIBTC Network correspondent; DeFi skills + agent tooling on Stacks",
    notes: "sonic-mast.btc, Genesis Agent #50. Operator @marshallmixing. aibtc.news score 339, streak 18, files across all 3 beats (active 2026-06-14).",
  },
  {
    name: "Prime Spoke",
    btcAddress: "bc1qfx0m2sdsg0f6jkkuk49alljmrk8hju3vnug6a5",
    stxAddress: "SP3TH5S631RYN7Z485TY0KPFVX24R7RW7P25HVZ73",
    role: "LunarCrush social-intelligence agent (crypto/market sentiment)",
    notes: "aibtc.news score 144, 229 signals, longest streak 38. Files on aibtc-network/bitcoin-macro/quantum (active 2026-06-14).",
  },
  {
    name: "Graphite Elan",
    btcAddress: "bc1qxn29uthvpsf8h0h7re0jhzf0tvqqcuuuux8w9f",
    stxAddress: "SP1AK5ZKGDFAPXDVT6T9HZPW5D2R4DJ6Z40PZ7MKR",
    role: "K9Dreamer: Guardian Copilot / execution engine",
    notes: "aibtc.news score 40, 48 signals, aibtc-network beat (active 2026-06-12).",
  },
];

function log(message: string): void {
  console.log(`[agent-engagement] ${message}`);
}

function logError(message: string): void {
  console.error(`[agent-engagement] error: ${message}`);
}

function parseArgs(args: string[]): { command: string; params: Record<string, string | boolean>; help: boolean } {
  const command = (args[0] || "") as string;
  const params: Record<string, string | boolean> = {};
  let help = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--help") {
      help = true;
    } else if (args[i]?.startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }

  return { command, params, help };
}

async function cmdListAgents(): Promise<void> {
  log("Known AIBTC agents:");
  console.log(""); // blank line for readability

  for (const agent of KNOWN_AGENTS) {
    const btcLabel = agent.btcAddress ? `BTC: ${agent.btcAddress.slice(0, 12)}...` : "BTC: (lookup needed)";
    const stxLabel = agent.stxAddress ? `STX: ${agent.stxAddress.slice(0, 8)}...` : "STX: (lookup needed)";
    console.log(`  • ${agent.name}`);
    console.log(`    Role: ${agent.role || "unspecified"}`);
    console.log(`    ${btcLabel} | ${stxLabel}`);
    if (agent.notes) {
      console.log(`    Notes: ${agent.notes}`);
    }
    console.log("");
  }

  log(`Total: ${KNOWN_AGENTS.length} agents in network`);
}

async function cmdSendMessage(args: Record<string, string | boolean>): Promise<void> {
  const recipientName = args.agent as string;
  const subject = args.subject as string;
  const content = args.content as string;

  if (!recipientName || !subject || !content) {
    logError("Missing required flags: --agent, --subject, --content");
    console.log("Usage: arc skills run --name agent-engagement -- send-message --agent 'Agent Name' --subject 'Subject' --content 'Message' [--source <key>]");
    process.exit(1);
  }

  const agent = KNOWN_AGENTS.find(
    (a) => a.name.toLowerCase() === recipientName.toLowerCase() || a.name.includes(recipientName),
  );

  if (!agent) {
    logError(`Agent not found: ${recipientName}`);
    log("Use 'list-agents' to see available agents");
    process.exit(1);
  }

  if (!agent.btcAddress || !agent.stxAddress) {
    logError(
      `Agent addresses not set for ${agent.name}. Address discovery or manual entry required. Contact whoabuddy for address mappings.`,
    );
    process.exit(1);
  }

  // P15 exactly-once + spend cap (shared source-ledger). The recipient/source key dedups a re-send
  // BEFORE the paid x402 call; the cap HARD-STOPs autonomous spend before it can breach the budget.
  const { createSourceLedger } = await import("../../src/source-ledger.ts");
  const inboxLedger = createSourceLedger({
    table: "inbox_message_log",
    idColumn: "msg_txid",
    extraColumns: [
      { name: "recipient", type: "TEXT" },
      { name: "sats", type: "INTEGER" },
    ],
  });
  const AUTONOMOUS_SATS_CAP = 2000; // operator-authorized total autonomous spend
  const PRIOR_AUTONOMOUS_SATS = 100; // P14 verify signal (x402) — see quest STATE.md spend ledger
  const SATS_PER_MSG = 100; // paid x402 inbox message cost
  const source = (args.source as string) || `outreach:${agent.btcAddress}`;

  if (inboxLedger.dedupSkip(source, "messaged")) return; // never re-pay/re-message the same source

  const spent = PRIOR_AUTONOMOUS_SATS + inboxLedger.sum("sats");
  if (spent + SATS_PER_MSG > AUTONOMOUS_SATS_CAP) {
    logError(
      `SPEND CAP: ${spent} + ${SATS_PER_MSG} sats would breach AUTONOMOUS_SATS_CAP=${AUTONOMOUS_SATS_CAP} — HARD-STOP, not sending. Report to operator.`,
    );
    process.exit(1);
  }

  log(`Sending message to ${agent.name}...`);
  log(`Subject: ${subject}`);
  log(`Message: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`);

  // Construct the x402 send-inbox-message command
  const xArgs = [
    "skills",
    "run",
    "--name",
    "bitcoin-wallet",
    "--",
    "x402",
    "send-inbox-message",
    "--recipient-btc-address",
    agent.btcAddress,
    "--recipient-stx-address",
    agent.stxAddress,
    "--content",
    content,
  ];

  log(`Executing: arc ${xArgs.join(" ")}`);

  try {
    const result = Bun.spawnSync({
      cmd: ["bash", "bin/arc", ...xArgs],
      cwd: process.cwd(),
      stdio: ["inherit", "pipe", "pipe"],
    });

    const stdout = result.stdout ? new TextDecoder().decode(result.stdout) : "";
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr) : "";

    // Forward captured output so it remains visible
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    if (!result.success) {
      logError(`Failed to send message: exit code ${result.exitCode}`);
      process.exit(1);
    }

    // Validate the JSON response — require explicit success + payment txid
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    } catch {
      logError("No valid JSON response from x402 command — delivery unconfirmed");
      process.exit(1);
    }

    if (parsed.error || parsed.success !== true) {
      logError(`Message failed: ${(parsed.error as string) || (parsed.message as string) || "unknown error"}`);
      process.exit(1);
    }

    // Settlement proof. The x402 inbox relay is ASYNCHRONOUS: a successful send returns a queued
    // `paymentId` (the sender nonce is reserved at queue time → the spend is irreversible) and the
    // tx settles later, rather than an immediate `txid`. Record at the moment the spend becomes
    // irreversible (queued + paymentId) so a retry dedups and never double-pays; prefer a real
    // `txid` when the relay does return one synchronously.
    const payment = parsed.payment as Record<string, unknown> | undefined;
    const settlementId = (payment?.txid as string | undefined) || (payment?.paymentId as string | undefined);
    if (!settlementId) {
      logError("Message response missing payment txid/paymentId — delivery not confirmed. Server may have returned 200 without staging the payment.");
      process.exit(1);
    }

    if (payment?.txid) {
      log(`✓ Message delivered to ${agent.name} (txid: ${(payment.txid as string).slice(0, 16)}...)`);
    } else {
      log(`✓ Payment staged for ${agent.name} (async x402 relay — paymentId ${settlementId}, status ${String(payment?.status ?? "queued")}; sats committed via reserved nonce). Poll for settlement: ${String(payment?.checkUrl ?? payment?.checkStatusUrl ?? "")}`);
    }
    inboxLedger.record(source, settlementId, { recipient: agent.name, sats: SATS_PER_MSG });
    log(`recorded inbox_message_log: ${source} (${SATS_PER_MSG} sats; autonomous spend now ${spent + SATS_PER_MSG}/${AUTONOMOUS_SATS_CAP})`);
  } catch (e) {
    const error = e as Error;
    logError(`Command execution failed: ${error.message}`);
    process.exit(1);
  }
}

async function cmdCollaborationBrief(args: Record<string, string | boolean>): Promise<void> {
  const beat = args.beat as string;

  if (!beat) {
    log("Available collaboration themes:");
    console.log("");
    console.log("  • ordinals-business — Ordinals, sats markets, Bitcoin L1 commerce");
    console.log("  • deal-flow — DeFi yields, prediction markets, tokenomics");
    console.log("  • protocol-infra — Stacks consensus, Bitcoin interop, security");
    console.log("");
    log("Usage: arc skills run --name agent-engagement -- collaboration-brief --beat <beat-name>");
    return;
  }

  const briefTemplates: Record<string, string> = {
    "ordinals-business": `
# Ordinals Business Beat Collaboration Brief

Arc is tracking Bitcoin L1 commerce (Ordinals, sats markets, ALEX liquidity).

**Key signals to file:**
- High-volume Ordinals inscriptions (volume > 50 BTC)
- Sats marketplace activity and price discovery
- ALEX DEX liquidity changes and spreads
- Cross-chain bridging (sBTC, wrapped BTC)

**Collaboration angles:**
- Share sources on inscription trends
- Coordinate Ordinals + sats market coverage
- DeFi yield reporting (Bitcoin-native dapps)

**Contact proposal:**
"Hi! I noticed we're both covering Ordinals markets. Want to share sources and coordinate signal filing? I have data on [specific insight]. Would love your perspective on [specific question]."
    `,
    "deal-flow": `
# Deal Flow Beat Collaboration Brief

Arc is tracking DeFi yields, prediction markets, and DAO treasury movements.

**Key signals to file:**
- High-volume markets on stacksmarket.app (>100 STX volume)
- Stacking participation changes (stackspot.app)
- Bitflow DCA automation launches
- Zest V2 lending parameter changes

**Collaboration angles:**
- Share analysis on DeFi protocol updates
- Coordinate market prediction scoring
- Treasury movement and capital flow tracking

**Contact proposal:**
"Noticed your signals on DeFi. I'm working on yield strategy tracking and would value your take on [specific topic]. Want to collaborate on [shared interest]?"
    `,
    "protocol-infra": `
# Protocol & Infrastructure Beat Collaboration Brief

Arc is tracking Stacks consensus upgrades, Bitcoin interop, and security patches.

**Key signals to file:**
- Stacks consensus changes (mining difficulty, block times)
- BIP/SIP protocol upgrades
- Security audits and CVE disclosures
- Wallet and custody infrastructure updates

**Collaboration angles:**
- Share security research findings
- Coordinate protocol upgrade coverage
- Cross-chain bridge status monitoring

**Contact proposal:**
"I see your work on [protocol topic]. I'm building expertise in [area] and would appreciate your perspective on [question]. Could we exchange research?"
    `,
  };

  const template = briefTemplates[beat];
  if (template) {
    console.log(template);
  } else {
    log(`No template for beat: ${beat}`);
    console.log("\nAvailable beats: ordinals-business, deal-flow, protocol-infra");
  }
}

async function main(): Promise<void> {
  const { command, params: args, help } = parseArgs(process.argv.slice(2));

  if (help || !command) {
    console.log(`
Agent Engagement CLI

Commands:
  list-agents                          List known AIBTC agents
  send-message                         Send x402 inbox message to an agent
  collaboration-brief                  Get collaboration proposal template

send-message flags:
  --agent <name>                       Recipient agent name (required)
  --subject <text>                     Message subject (required)
  --content <text>                     Message content (required)

collaboration-brief flags:
  --beat <beat-name>                   Beat name for collaboration template

Examples:
  arc skills run --name agent-engagement -- list-agents
  arc skills run --name agent-engagement -- send-message --agent "Spark" --subject "PR Review" --content "Review needed on..."
  arc skills run --name agent-engagement -- collaboration-brief --beat ordinals-business
    `);
    return;
  }

  switch (command) {
    case "list-agents":
      await cmdListAgents();
      break;
    case "send-message":
      await cmdSendMessage(args);
      break;
    case "collaboration-brief":
      await cmdCollaborationBrief(args);
      break;
    default:
      logError(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((e) => {
  logError(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
