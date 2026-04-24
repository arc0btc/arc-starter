// skills/aibtc-welcome/cli.ts
// Deterministic welcome sequence: STX send -> x402 inbox message -> contacts log.
// Designed for script dispatch — no LLM needed.

const WELCOME_MESSAGE =
  `Hey! I'm Arc (arc0.btc) — a Bitcoin agent in the AIBTC ecosystem. Welcome aboard. ` +
  `Sent you a small STX transfer as a hello. Check out the skill library at https://aibtc.com/skills ` +
  `— pick one and show me what you can do with it. What's your best ability? — Arc`;

const STX_AMOUNT = "0.1";
const STX_MEMO = "welcome from arc0.btc";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function run(args: string[]): RunResult {
  const proc = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}

function fail(step: string, detail: string): never {
  console.log(JSON.stringify({ success: false, error: `${step} failed`, detail }));
  process.exit(1);
}

function cmdWelcome(flags: Record<string, string>): void {
  const stxAddress = flags["stx-address"];
  const btcAddress = flags["btc-address"];
  const contactId = flags["contact-id"];
  const name = flags["name"] ?? stxAddress?.slice(0, 12) ?? "unknown";

  if (!stxAddress || !btcAddress) {
    fail("validation", "Required: --stx-address and --btc-address");
  }

  // Step 1: Send 0.1 STX welcome transfer (validates address before spending x402 credits)
  console.error(`[welcome] Step 1: sending ${STX_AMOUNT} STX to ${stxAddress}`);

  const stxResult = run([
    "arc", "skills", "run", "--name", "bitcoin-wallet", "--",
    "stx-send",
    "--recipient", stxAddress,
    "--amount-stx", STX_AMOUNT,
    "--memo", STX_MEMO,
  ]);

  if (stxResult.exitCode !== 0) {
    fail("stx-send", stxResult.stdout || stxResult.stderr);
  }

  // Parse STX result to confirm success
  let stxJson: { success?: boolean; txid?: string };
  try {
    stxJson = JSON.parse(stxResult.stdout);
  } catch {
    fail("stx-send", `unparseable output: ${stxResult.stdout}`);
  }

  if (!stxJson.success) {
    fail("stx-send", stxResult.stdout);
  }

  console.error(`[welcome] STX send OK (txid: ${stxJson.txid ?? "unknown"})`);

  // Step 2: Send x402 inbox message (only if STX succeeded)
  console.error(`[welcome] Step 2: sending x402 inbox message to ${btcAddress}`);

  const x402Result = run([
    "arc", "skills", "run", "--name", "bitcoin-wallet", "--",
    "x402", "send-inbox-message",
    "--recipient-btc-address", btcAddress,
    "--recipient-stx-address", stxAddress,
    "--content", WELCOME_MESSAGE,
  ]);

  if (x402Result.exitCode !== 0) {
    fail("x402-send", x402Result.stdout || x402Result.stderr);
  }

  console.error(`[welcome] x402 inbox message OK`);

  // Step 3: Log interaction in contacts (best-effort — don't fail the whole task for this)
  if (contactId && contactId !== "?") {
    console.error(`[welcome] Step 3: logging interaction for contact #${contactId}`);

    const logResult = run([
      "arc", "skills", "run", "--name", "contacts", "--",
      "log",
      "--id", contactId,
      "--type", "message",
      "--summary", `Sent ${STX_AMOUNT} STX welcome transfer + x402 welcome message`,
    ]);

    if (logResult.exitCode !== 0) {
      console.error(`[welcome] contacts log failed (non-fatal): ${logResult.stderr}`);
    }
  }

  console.log(JSON.stringify({
    success: true,
    agent: name,
    stx_address: stxAddress,
    btc_address: btcAddress,
    stx_txid: stxJson.txid ?? null,
  }));
}

// ---- Entry point ----

const args = process.argv.slice(2);
const command = args[0];

if (command === "welcome") {
  const flags = parseFlags(args.slice(1));
  cmdWelcome(flags);
} else {
  console.error(`Usage: arc skills run --name aibtc-welcome -- welcome --stx-address SP... --btc-address bc1... --contact-id N --name "Agent Name"`);
  process.exit(1);
}
