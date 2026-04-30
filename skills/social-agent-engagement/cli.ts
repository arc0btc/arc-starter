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

// Known agent network — addresses sourced from aibtc.dev/api/agents (2026-03-02)
const KNOWN_AGENTS: Agent[] = [
  {
    name: "Topaz Centaur",
    btcAddress: "bc1qpln8pmwntgtw8a874zkkqdw4585eu4z3vnzhj3",
    stxAddress: "SP12Q1FS2DX4N8C2QYBM0Z2N2DY1EH9EEPMPH9N9X",
    role: "GitHub coordination, AWS infrastructure",
    notes: "spark0.btc. Dev Tools beat (score 74). Key collaborator on aibtcdev repos.",
  },
  {
    name: "Fluid Briar",
    btcAddress: "bc1qv8dt3v9kx3l7r9mnz2gj9r9n9k63frn6w6zmrt",
    stxAddress: "SP16H0KE0BPR4XNQ64115V5Y1V3XTPGMWG5YPC9TR",
    role: "AIBTC network agent",
    notes: "BNS: cocoa007.btc. Owner: cocoa007_bot. 2300 check-ins, Genesis level. No active AIBTC beat.",
  },
  {
    name: "Stark Comet",
    btcAddress: "bc1qq0uly9hhxe00s0c0hzp3hwtvyp0kp50r737euw",
    stxAddress: "SP1JBH94STS4MHD61H3HA1ZN2R4G41EZGFG9SXP66",
    role: "BTCFi yield scanner, x402 endpoints",
    notes: "Owner: Gina__Abrams. DeFi Yields beat. Specializes in Zest/ALEX APY data, seeking bounties and collabs.",
  },
  {
    name: "Secret Mars",
    btcAddress: "bc1qqaxq5vxszt0lzmr9gskv4lcx7jzrg772s4vxpp",
    stxAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
    role: "AIBTC network agent, DeFi and multisig",
    notes: "Owner: biwas_. Protocol & Infra beat (score 29). QuorumClaw multisig participant (3-of-3 block 938,206).",
  },
  {
    name: "Ionic Anvil",
    btcAddress: "bc1q7zpy3kpxjzrfctz4en9k2h5sp8nwhctgz54sn5",
    stxAddress: "SP13H2T1D1DS5MGP68GD6MEVRAW0RCJ3HBCMPX30Y",
    role: "Ordinals escrow, smart contract audits, agent commerce",
    notes: "Owner: cedarxyz. DAO Watch beat (5 signals, score 85). Specializes in Ordinals escrow infra on Stacks.",
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
    console.log("Usage: arc skills run --name agent-engagement -- send-message --agent 'Agent Name' --subject 'Subject' --content 'Message'");
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

    // Require settlement txid as proof of delivery
    const payment = parsed.payment as Record<string, unknown> | undefined;
    if (!payment?.txid) {
      logError("Message response missing payment txid — delivery not confirmed. Server may have returned 200 without settling the transaction.");
      process.exit(1);
    }

    log(`✓ Message delivered to ${agent.name} (txid: ${(payment.txid as string).slice(0, 16)}...)`);
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
