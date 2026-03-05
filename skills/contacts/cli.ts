// skills/contacts/cli.ts
// CLI for contact management: list, show, add, update, link, interactions, log, search

import {
  initContactsSchema,
  resolveDisplayName,
  getAllContacts,
  getContactById,
  searchContacts,
  insertContact,
  updateContact,
  getContactLinks,
  insertContactLink,
  getContactInteractions,
  insertContactInteraction,
} from "./schema";
import type { Contact, InsertContact } from "./schema";

function log(msg: string): void {
  console.log(`[contacts] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[contacts] error: ${msg}`);
}

function parseArgs(args: string[]): { command: string; params: Record<string, string>; help: boolean } {
  const command = (args[0] || "") as string;
  const params: Record<string, string> = {};
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

function printContact(c: Contact, verbose: boolean = false): void {
  const name = resolveDisplayName(c);
  const typeLabel = c.type === "agent" ? "[agent]" : "[human]";
  const statusLabel = c.status !== "active" ? ` (${c.status})` : "";

  console.log(`  #${c.id} ${name} ${typeLabel}${statusLabel}`);

  if (verbose) {
    if (c.aibtc_name) console.log(`    AIBTC: ${c.aibtc_name}`);
    if (c.bns_name) console.log(`    BNS: ${c.bns_name}`);
    if (c.stx_address) console.log(`    STX: ${c.stx_address}`);
    if (c.btc_address) console.log(`    BTC: ${c.btc_address}`);
    if (c.taproot_address) console.log(`    Taproot: ${c.taproot_address}`);
    if (c.github_handle) console.log(`    GitHub: ${c.github_handle}`);
    if (c.x_handle) console.log(`    X: @${c.x_handle}`);
    if (c.email) console.log(`    Email: ${c.email}`);
    if (c.website) console.log(`    Web: ${c.website}`);
    if (c.agent_id) console.log(`    Agent ID: ${c.agent_id}`);
    if (c.operator_contact_id) console.log(`    Operator: contact #${c.operator_contact_id}`);
    if (c.x402_endpoint) console.log(`    x402: ${c.x402_endpoint}`);
    if (c.aibtc_beat) console.log(`    Beat: ${c.aibtc_beat}`);
    if (c.aibtc_level) console.log(`    Level: ${c.aibtc_level}`);
    if (c.notes) console.log(`    Notes: ${c.notes}`);
    console.log(`    Created: ${c.created_at} | Updated: ${c.updated_at}`);
  }
}

function cmdList(params: Record<string, string>): void {
  initContactsSchema();
  const status = params.status || undefined;
  const contacts = getAllContacts(status);

  if (contacts.length === 0) {
    log("No contacts found.");
    return;
  }

  log(`${contacts.length} contact(s):`);
  console.log("");
  for (const c of contacts) {
    printContact(c);
  }
}

function cmdShow(params: Record<string, string>): void {
  const idStr = params.id;
  if (!idStr) {
    logError("Missing --id flag");
    process.exit(1);
  }

  initContactsSchema();
  const contact = getContactById(Number(idStr));
  if (!contact) {
    logError(`Contact #${idStr} not found`);
    process.exit(1);
  }

  console.log("");
  printContact(contact, true);

  // Show links
  const links = getContactLinks(contact.id);
  if (links.length > 0) {
    console.log("");
    console.log("  Relationships:");
    for (const link of links) {
      const peerName = resolveDisplayName(link.peer);
      console.log(`    - ${link.relationship}: ${peerName} (#${link.peer.id})`);
      if (link.notes) console.log(`      ${link.notes}`);
    }
  }

  // Show recent interactions
  const interactions = getContactInteractions(contact.id, 5);
  if (interactions.length > 0) {
    console.log("");
    console.log("  Recent interactions:");
    for (const ix of interactions) {
      const taskRef = ix.task_id ? ` (task #${ix.task_id})` : "";
      console.log(`    [${ix.occurred_at}] ${ix.type}: ${ix.summary}${taskRef}`);
    }
  }
  console.log("");
}

function cmdAdd(params: Record<string, string>): void {
  initContactsSchema();

  const fields: InsertContact = {};

  // Map CLI flags to schema fields
  const flagMap: Record<string, keyof InsertContact> = {
    "display-name": "display_name",
    "aibtc-name": "aibtc_name",
    "bns-name": "bns_name",
    type: "type",
    status: "status",
    visibility: "visibility",
    stx: "stx_address",
    btc: "btc_address",
    taproot: "taproot_address",
    github: "github_handle",
    x: "x_handle",
    email: "email",
    website: "website",
    "agent-id": "agent_id",
    operator: "operator_contact_id",
    x402: "x402_endpoint",
    beat: "aibtc_beat",
    level: "aibtc_level",
    notes: "notes",
  };

  for (const [flag, col] of Object.entries(flagMap)) {
    if (params[flag] !== undefined) {
      if (col === "operator_contact_id") {
        (fields as Record<string, unknown>)[col] = Number(params[flag]);
      } else {
        (fields as Record<string, unknown>)[col] = params[flag];
      }
    }
  }

  // Require at least one name field
  if (!fields.display_name && !fields.aibtc_name && !fields.bns_name) {
    logError("Provide at least one name: --display-name, --aibtc-name, or --bns-name");
    process.exit(1);
  }

  const id = insertContact(fields);
  const name = fields.display_name || fields.aibtc_name || fields.bns_name;
  log(`Created contact #${id}: ${name}`);
}

function cmdUpdate(params: Record<string, string>): void {
  const idStr = params.id;
  if (!idStr) {
    logError("Missing --id flag");
    process.exit(1);
  }

  initContactsSchema();
  const existing = getContactById(Number(idStr));
  if (!existing) {
    logError(`Contact #${idStr} not found`);
    process.exit(1);
  }

  const fields: Partial<InsertContact> = {};
  const flagMap: Record<string, keyof InsertContact> = {
    "display-name": "display_name",
    "aibtc-name": "aibtc_name",
    "bns-name": "bns_name",
    type: "type",
    status: "status",
    visibility: "visibility",
    stx: "stx_address",
    btc: "btc_address",
    taproot: "taproot_address",
    github: "github_handle",
    x: "x_handle",
    email: "email",
    website: "website",
    "agent-id": "agent_id",
    operator: "operator_contact_id",
    x402: "x402_endpoint",
    beat: "aibtc_beat",
    level: "aibtc_level",
    notes: "notes",
  };

  for (const [flag, col] of Object.entries(flagMap)) {
    if (params[flag] !== undefined) {
      if (col === "operator_contact_id") {
        (fields as Record<string, unknown>)[col] = Number(params[flag]);
      } else {
        (fields as Record<string, unknown>)[col] = params[flag];
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    logError("No fields to update. Use flags like --display-name, --stx, --notes, etc.");
    process.exit(1);
  }

  updateContact(Number(idStr), fields);
  log(`Updated contact #${idStr}`);
}

function cmdLink(params: Record<string, string>): void {
  const aStr = params.a;
  const bStr = params.b;
  const relationship = params.relationship;

  if (!aStr || !bStr || !relationship) {
    logError("Required: --a <id> --b <id> --relationship <text>");
    process.exit(1);
  }

  initContactsSchema();
  const contactA = getContactById(Number(aStr));
  const contactB = getContactById(Number(bStr));

  if (!contactA) { logError(`Contact #${aStr} not found`); process.exit(1); }
  if (!contactB) { logError(`Contact #${bStr} not found`); process.exit(1); }

  const id = insertContactLink({
    contact_a_id: Number(aStr),
    contact_b_id: Number(bStr),
    relationship,
    notes: params.notes || null,
  });

  log(`Linked #${aStr} (${resolveDisplayName(contactA)}) <-> #${bStr} (${resolveDisplayName(contactB)}): ${relationship} [link #${id}]`);
}

function cmdInteractions(params: Record<string, string>): void {
  const idStr = params.id;
  if (!idStr) {
    logError("Missing --id flag");
    process.exit(1);
  }

  initContactsSchema();
  const contact = getContactById(Number(idStr));
  if (!contact) {
    logError(`Contact #${idStr} not found`);
    process.exit(1);
  }

  const limit = params.limit ? Number(params.limit) : 20;
  const interactions = getContactInteractions(Number(idStr), limit);

  if (interactions.length === 0) {
    log(`No interactions for ${resolveDisplayName(contact)} (#${idStr})`);
    return;
  }

  log(`Interactions for ${resolveDisplayName(contact)} (#${idStr}):`);
  console.log("");
  for (const ix of interactions) {
    const taskRef = ix.task_id ? ` (task #${ix.task_id})` : "";
    console.log(`  [${ix.occurred_at}] ${ix.type}: ${ix.summary}${taskRef}`);
  }
}

function cmdLog(params: Record<string, string>): void {
  const idStr = params.id;
  const type = params.type;
  const summary = params.summary;

  if (!idStr || !type || !summary) {
    logError("Required: --id <contact_id> --type <type> --summary <text>");
    console.log("Types: message, collaboration, mention, meeting, other");
    process.exit(1);
  }

  initContactsSchema();
  const contact = getContactById(Number(idStr));
  if (!contact) {
    logError(`Contact #${idStr} not found`);
    process.exit(1);
  }

  const taskId = params.task ? Number(params.task) : undefined;
  const interactionId = insertContactInteraction({
    contact_id: Number(idStr),
    task_id: taskId,
    type,
    summary,
    occurred_at: params.at || undefined,
  });

  log(`Logged interaction #${interactionId} for ${resolveDisplayName(contact)}`);
}

function cmdSearch(params: Record<string, string>): void {
  const term = params.term || params.q;
  if (!term) {
    logError("Missing --term or --q flag");
    process.exit(1);
  }

  initContactsSchema();
  const results = searchContacts(term);

  if (results.length === 0) {
    log(`No contacts matching "${term}"`);
    return;
  }

  log(`${results.length} result(s) for "${term}":`);
  console.log("");
  for (const c of results) {
    printContact(c);
  }
}

function printHelp(): void {
  console.log(`
Contacts CLI — Manage agents, humans, addresses, and relationships

Commands:
  list                              List all contacts
  show                              Show contact details + links + interactions
  add                               Add a new contact
  update                            Update an existing contact
  link                              Create a relationship between two contacts
  interactions                      List interactions for a contact
  log                               Log a new interaction
  search                            Search contacts by name/address/handle

list flags:
  --status <active|inactive|archived>   Filter by status

show flags:
  --id <N>                          Contact ID (required)

add flags (at least one name required):
  --display-name <text>             Display name
  --aibtc-name <text>               AIBTC agent name
  --bns-name <text>                 BNS name (e.g. arc0.btc)
  --type <agent|human>              Contact type (default: human)
  --status <active|inactive|archived>
  --visibility <public|private>     Default: public
  --stx <address>                   Stacks address
  --btc <address>                   Bitcoin address
  --taproot <address>               Taproot address
  --github <handle>                 GitHub username
  --x <handle>                      X/Twitter handle
  --email <address>                 Email address
  --website <url>                   Website URL
  --agent-id <id>                   Agent identifier
  --operator <contact_id>           Operator contact ID (FK)
  --x402 <endpoint>                 x402 messaging endpoint
  --beat <name>                     AIBTC news beat
  --level <level>                   AIBTC level
  --notes <text>                    Free-form notes

update flags:
  --id <N>                          Contact ID (required)
  (same flags as add)

link flags:
  --a <id>                          First contact ID (required)
  --b <id>                          Second contact ID (required)
  --relationship <text>             Relationship label (required)
  --notes <text>                    Optional notes

interactions flags:
  --id <N>                          Contact ID (required)
  --limit <N>                       Max results (default: 20)

log flags:
  --id <N>                          Contact ID (required)
  --type <type>                     Interaction type: message|collaboration|mention|meeting|other (required)
  --summary <text>                  Summary text (required)
  --task <N>                        Related task ID (optional)
  --at <datetime>                   When it occurred (default: now)

search flags:
  --term <text>                     Search term (or --q)

Examples:
  arc skills run --name contacts -- list
  arc skills run --name contacts -- add --display-name "whoabuddy" --type human --bns-name "whoabuddy.btc"
  arc skills run --name contacts -- add --aibtc-name "Topaz Centaur" --type agent --beat "Dev Tools"
  arc skills run --name contacts -- show --id 1
  arc skills run --name contacts -- link --a 1 --b 2 --relationship "operator"
  arc skills run --name contacts -- log --id 1 --type collaboration --summary "Reviewed PR #42"
  arc skills run --name contacts -- search --term "arc0"
  `);
}

async function main(): Promise<void> {
  const { command, params, help } = parseArgs(process.argv.slice(2));

  if (help || !command) {
    printHelp();
    return;
  }

  switch (command) {
    case "list":
      cmdList(params);
      break;
    case "show":
      cmdShow(params);
      break;
    case "add":
      cmdAdd(params);
      break;
    case "update":
      cmdUpdate(params);
      break;
    case "link":
      cmdLink(params);
      break;
    case "interactions":
      cmdInteractions(params);
      break;
    case "log":
      cmdLog(params);
      break;
    case "search":
      cmdSearch(params);
      break;
    default:
      logError(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  logError(`Fatal: ${(e as Error).message}`);
  process.exit(1);
});
