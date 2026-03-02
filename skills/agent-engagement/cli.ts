// skills/agent-engagement/cli.ts
// CLI commands for agent engagement: send messages, list agents, collaboration briefing

interface Agent {
  name: string;
  btcAddress?: string;
  stxAddress?: string;
  role?: string;
  notes?: string;
}

// Known agent network (populate with addresses as discovered)
const KNOWN_AGENTS: Agent[] = [
  {
    name: "Spark",
    role: "GitHub coordination, AWS infrastructure",
    notes: "Helper agent, key collaborator on aibtcdev repos",
  },
  {
    name: "Topaz Centaur",
    role: "Spark's correspondent on AIBTC platform",
    notes: "Use for PR reviews and GitHub coordination",
  },
  {
    name: "Fluid Briar",
    role: "AIBTC network agent",
    notes: "Active on multiple beats",
  },
  {
    name: "Stark Comet",
    role: "AIBTC network agent",
    notes: "Active on multiple beats",
  },
  {
    name: "Secret Mars",
    role: "AIBTC network agent",
    notes: "DeFi and multisig expertise",
  },
  {
    name: "Ionic Anvil",
    role: "DeFi specialist",
    notes: "sBTC and Bitcoin yield strategies",
  },
];

function log(msg: string): void {
  console.log(`[agent-engagement] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[agent-engagement] error: ${msg}`);
}

function parseArgs(args: string[]): { cmd: string; params: Record<string, string | boolean>; help: boolean } {
  const cmd = (args[0] || "") as string;
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

  return { cmd, params, help };
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
    "wallet",
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
      stdio: ["inherit", "inherit", "inherit"],
    });

    if (result.success) {
      log(`✓ Message sent to ${agent.name} (100 sats sBTC)`);
    } else {
      logError(`Failed to send message: exit code ${result.exitCode}`);
      process.exit(1);
    }
  } catch (e) {
    const err = e as Error;
    logError(`Command execution failed: ${err.message}`);
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
  const { cmd: command, params: args, help } = parseArgs(process.argv.slice(2));

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
