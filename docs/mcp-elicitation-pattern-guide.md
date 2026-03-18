# MCP Elicitation Pattern Guide for arc-starter Skill Authors

*Published: 2026-03-14 | Claude Code v2.1.76+*

---

## What is MCP Elicitation?

MCP elicitation lets an MCP server **pause mid-execution and request structured input** from the user or an automated system before continuing. Instead of requiring all inputs upfront (as tool parameters), a tool can run partially, discover it needs more information, and issue a structured request with a defined schema.

This is a new interaction model introduced in Claude Code v2.1.76. The difference from regular tool parameters:

| Tool Parameters | Elicitation |
|-----------------|-------------|
| All inputs declared upfront in tool schema | Request additional input mid-execution |
| Claude must provide everything before calling | Server can run, discover gaps, then ask |
| Good for known, predictable inputs | Good for conditional, context-dependent inputs |
| One round-trip | Two round-trips (run → request → continue) |

---

## Two Execution Paths

Elicitation has two paths. **Only the hook path works for headless agents like arc-starter.**

### Path 1: Browser URL (not viable for arc-starter)

Claude Code v2.1.76 added a browser-based elicitation dialog. The MCP server returns a URL, Claude Code opens a browser form, the user fills it, and results are returned to the server.

**Not usable in arc-starter.** Arc dispatch runs headless (no display, no browser). Skip this path.

### Path 2: ElicitationResult Hook (the arc-starter path)

Claude Code fires an `Elicitation` hook when a server requests elicitation, and accepts an `ElicitationResult` hook to inject a programmatic response before the dialog would appear.

For arc-starter skill authors, this is the only viable path. The hook intercepts the request and supplies a response without any human interaction.

---

## How to Add Elicitation to a Skill's MCP Server

### Step 1: Define the elicitation request in your tool

In your MCP server tool handler, call `server.requestSampling()` or use the elicitation API when you need mid-execution input:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({ name: "my-skill", version: "1.0.0" });

server.tool(
  "deploy_contract",
  "Deploy a Clarity smart contract to Stacks",
  {
    contract_name: z.string(),
    network: z.enum(["mainnet", "testnet"]).optional(),
  },
  async ({ contract_name, network }, { elicit }) => {
    // Run initial logic
    const contractSource = await loadContract(contract_name);
    const estimatedFee = await estimateFee(contractSource, network ?? "mainnet");

    // Mid-execution: request confirmation with context the tool now knows
    const confirmation = await elicit({
      message: `Deploy ${contract_name} to ${network ?? "mainnet"}? Estimated fee: ${estimatedFee} µSTX`,
      schema: {
        type: "object",
        properties: {
          confirmed: {
            type: "boolean",
            description: "Approve the deployment",
          },
          max_fee_ustx: {
            type: "number",
            description: "Maximum fee you're willing to pay (µSTX)",
            default: estimatedFee * 1.2,
          },
        },
        required: ["confirmed"],
      },
    });

    if (!confirmation.confirmed) {
      return { content: [{ type: "text", text: "Deployment cancelled by user." }] };
    }

    // Continue with confirmed parameters
    const txid = await deployContract(contractSource, {
      network: network ?? "mainnet",
      maxFee: confirmation.max_fee_ustx ?? estimatedFee,
    });

    return {
      content: [{ type: "text", text: `Deployed. TXID: ${txid}` }],
    };
  }
);
```

### Step 2: Register an ElicitationResult hook for automated response

In your skill's CLAUDE.md hooks or in the MCP server's hook configuration, define how to respond programmatically:

```json
{
  "hooks": {
    "ElicitationResult": [
      {
        "matcher": "my-skill",
        "command": "bun skills/my-skill/elicitation-handler.ts"
      }
    ]
  }
}
```

The handler receives the elicitation request on stdin and must write a JSON response to stdout:

```typescript
// skills/my-skill/elicitation-handler.ts
const request = JSON.parse(await Bun.stdin.text());

// Auto-approve deployments under 50,000 µSTX
const autoApprove = (request.schema?.properties?.max_fee_ustx?.default ?? 0) < 50_000;

const response = {
  confirmed: autoApprove,
  max_fee_ustx: request.schema?.properties?.max_fee_ustx?.default,
};

console.log(JSON.stringify(response));
```

---

## Common Patterns

### Pattern 1: Confirmation Gate

Pause before irreversible operations. Useful for contract deployments, large transfers, destructive actions.

```typescript
const { proceed } = await elicit({
  message: `This will broadcast a transaction. Confirm?`,
  schema: {
    type: "object",
    properties: {
      proceed: { type: "boolean" },
    },
    required: ["proceed"],
  },
});
if (!proceed) return cancelledResponse();
```

**ElicitationResult hook:** Auto-approve if the task's priority is >= 8 (Haiku-tier, pre-approved routine work). Block for P1-4 Opus tasks involving large amounts.

### Pattern 2: Dynamic Configuration

Collect configuration that depends on runtime state — values you can't know until the tool has run.

```typescript
// Tool first fetches available networks, then asks which to use
const networks = await fetchAvailableNetworks();
const { network } = await elicit({
  message: "Select target network",
  schema: {
    type: "object",
    properties: {
      network: {
        type: "string",
        enum: networks.map(n => n.id),
        description: "Network ID to deploy to",
      },
    },
    required: ["network"],
  },
});
```

**ElicitationResult hook:** Read from a config file or credential store to auto-select the default network.

### Pattern 3: Non-Technical User Forms

Expose MCP tools with complex configuration as simple forms. Users fill fields without editing JSON.

```typescript
const postConfig = await elicit({
  message: "Configure the blog post",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Post title" },
      tags: { type: "string", description: "Comma-separated tags" },
      publish_immediately: { type: "boolean", default: false },
    },
    required: ["title"],
  },
});
```

**ElicitationResult hook:** For Arc dispatch tasks, auto-fill from `task.description` fields parsed at dispatch time.

---

## Auto-Responder Architecture for Arc Skills

For skills running in Arc's headless dispatch pipeline, elicitation without an `ElicitationResult` hook would block execution indefinitely. Always pair elicitation with an auto-responder.

### Decision tree for your auto-responder

```
Elicitation request received
├── Is this a confirmation gate?
│   ├── Task priority P8+ (Haiku) → auto-approve
│   ├── Task priority P5-7 (Sonnet) → approve if amount < threshold
│   └── Task priority P1-4 (Opus) → check task description for explicit approval
├── Is this a selection from known options?
│   └── Read from skill config / credentials store → auto-select default
└── Is this free-form user input?
    └── Extract from task.description if present, else cancel with explanation
```

### Sentinel file integration

If your auto-responder encounters a condition it can't resolve (e.g., no default configured, amount exceeds threshold), write a sentinel file and return `cancelled`:

```typescript
// In elicitation-handler.ts
if (requestedAmount > MAX_AUTO_APPROVE_USTX) {
  await Bun.write("db/hook-state/deploy-needs-approval.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    contract: request.context?.contract_name,
    amount: requestedAmount,
  }));
  console.log(JSON.stringify({ cancelled: true, reason: "Amount exceeds auto-approve threshold" }));
  process.exit(0);
}
```

Gate your deployment sensor on this sentinel:

```typescript
// In sensor.ts
const needsApproval = existsSync("db/hook-state/deploy-needs-approval.json");
if (needsApproval) {
  // Create P4 task for human review instead of auto-deploying
  createApprovalTask();
  return "skip";
}
```

---

## When NOT to Use Elicitation

Elicitation adds a round-trip and requires hook configuration. Don't use it when:

- **All inputs are known before the tool runs.** Use standard tool parameters with Zod schemas.
- **You're building a sensor.** Sensors are pure TypeScript, no LLM, no MCP. Sensors create tasks; they don't use elicitation.
- **The decision is always the same.** If your auto-responder always returns the same value, fold it into the tool parameters.
- **You want to ask Arc/Claude a question.** That's a tool call, not elicitation. Elicitation is for structured user/system input, not LLM reasoning.

---

## Checklist for Skill Authors

Before shipping a skill that uses elicitation:

- [ ] `elicit()` call has a clear, human-readable `message` field
- [ ] Schema uses `required` to distinguish mandatory vs optional fields
- [ ] `ElicitationResult` hook is registered in `.claude/settings.json`
- [ ] Auto-responder handles all schema fields (never leaves required fields empty)
- [ ] Auto-responder writes a sentinel if it can't resolve the request
- [ ] Sensor gates on the sentinel before re-queueing affected tasks
- [ ] Tested with `--transport stdio` locally before deploying

---

## SDK Reference

MCP SDK: `@modelcontextprotocol/sdk` (installed in arc-starter)

```typescript
// The elicit() function is passed as the second argument to tool handlers
server.tool("name", "description", schema, async (params, { elicit }) => {
  const result = await elicit({ message: string, schema: JSONSchema });
  // result contains the fields defined in schema, or { cancelled: true }
});
```

Hook configuration lives in `.claude/settings.json` under `hooks.Elicitation` and `hooks.ElicitationResult`. See Claude Code v2.1.76 release notes for the full hook API.

---

## Related

- `skills/arc-mcp-server/` — Arc's own MCP server (reference implementation, no elicitation currently)
- `skills/arc-mcp/` — Lightweight read-only MCP HTTP server
- Claude Code v2.1.76 release notes: `research/claude-code-releases/v2.1.76.md`
- Arc sentinel file pattern: see MEMORY.md → "Sentinel file pattern"
