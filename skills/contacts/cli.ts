// skills/contacts/cli.ts
// CLI for contact management: list, show, add, update, link, interactions, log, search

import {
  initContactsSchema,
  resolveDisplayName,
  getAllContacts,
  getContactById,
  getContactByAddress,
  getContactByAgentId,
  getContactByNameAndType,
  searchContacts,
  insertContact,
  updateContact,
  getContactLinks,
  insertContactLink,
  getContactInteractions,
  insertContactInteraction,
  getContextContacts,
} from "./schema";
import type { Contact, ContactCard, InsertContact } from "./schema";

function log(message: string): void {
  console.log(`[contacts] ${message}`);
}

function logError(message: string): void {
  console.error(`[contacts] error: ${message}`);
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

function cmdContext(params: Record<string, string>): void {
  const subject = params["task-subject"];
  if (!subject) {
    logError("Missing --task-subject flag");
    process.exit(1);
  }

  initContactsSchema();
  const limit = params.limit ? Number(params.limit) : 10;
  const cards = getContextContacts(subject, limit);

  if (cards.length === 0) {
    console.log("No relevant contacts found.");
    return;
  }

  // Output compact contact cards for dispatch context injection
  console.log(`# Relevant Contacts (${cards.length})`);
  console.log("");
  for (const card of cards) {
    const parts: string[] = [`**${card.name}** (#${card.id}, ${card.type})`];
    if (card.beat) parts.push(`  Beat: ${card.beat}`);
    if (card.x_handle) parts.push(`  X: @${card.x_handle}`);
    if (card.stx_address) parts.push(`  STX: ${card.stx_address}`);
    if (card.x402_endpoint) parts.push(`  x402: ${card.x402_endpoint}`);
    if (card.notes) parts.push(`  Notes: ${card.notes.slice(0, 120)}`);
    console.log(parts.join("\n"));
    console.log("");
  }
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

function cmdExport(params: Record<string, string>): void {
  initContactsSchema();
  const typeFilter = params.type || undefined;
  const statusParam = params.status;
  // Default to active; pass undefined to getAllContacts to get all statuses when "all" requested
  const contacts = statusParam === "all" ? getAllContacts() : getAllContacts(statusParam || "active");
  const filtered = typeFilter ? contacts.filter((c) => c.type === typeFilter) : contacts;
  // Status to stderr so stdout is clean JSON (fleet-sync parses stdout)
  console.error(`[contacts] exporting ${filtered.length} contact(s)`);
  console.log(JSON.stringify(filtered, null, 2));
}

async function cmdImport(params: Record<string, string>): Promise<void> {
  const filePath = params.file;
  if (!filePath) {
    logError("Missing --file flag");
    process.exit(1);
  }

  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    logError(`Cannot read file: ${filePath}`);
    process.exit(1);
  }

  let contacts: Contact[];
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
    contacts = parsed as Contact[];
  } catch (e) {
    logError(`Invalid JSON: ${(e as Error).message}`);
    process.exit(1);
  }

  initContactsSchema();

  let created = 0;
  let updated = 0;
  let reactivated = 0;

  for (const c of contacts) {
    // Match by address first, then fallback to agent_id, then display_name+type
    let existing = getContactByAddress(c.stx_address, c.btc_address);
    if (!existing && c.agent_id) {
      existing = getContactByAgentId(c.agent_id);
    }
    if (!existing && c.display_name && c.type) {
      existing = getContactByNameAndType(c.display_name, c.type);
    }

    if (existing) {
      const updates: Partial<InsertContact> = {};
      // Fill in fields missing on the worker but present in the export
      if (c.display_name && !existing.display_name) updates.display_name = c.display_name;
      if (c.aibtc_name && !existing.aibtc_name) updates.aibtc_name = c.aibtc_name;
      if (c.bns_name && !existing.bns_name) updates.bns_name = c.bns_name;
      if (c.stx_address && !existing.stx_address) updates.stx_address = c.stx_address;
      if (c.btc_address && !existing.btc_address) updates.btc_address = c.btc_address;
      if (c.taproot_address && !existing.taproot_address) updates.taproot_address = c.taproot_address;
      if (c.x_handle && !existing.x_handle) updates.x_handle = c.x_handle;
      if (c.github_handle && !existing.github_handle) updates.github_handle = c.github_handle;
      if (c.x402_endpoint && !existing.x402_endpoint) updates.x402_endpoint = c.x402_endpoint;
      if (c.aibtc_beat && !existing.aibtc_beat) updates.aibtc_beat = c.aibtc_beat;
      if (c.aibtc_level && existing.aibtc_level !== c.aibtc_level) updates.aibtc_level = c.aibtc_level;
      if (c.agent_id && !existing.agent_id) updates.agent_id = c.agent_id;
      if (c.email && !existing.email) updates.email = c.email;
      if (c.website && !existing.website) updates.website = c.website;
      // Always re-activate if archived or inactive
      if (existing.status !== "active") {
        updates.status = "active";
        reactivated++;
      }
      if (Object.keys(updates).length > 0) {
        updateContact(existing.id, updates);
        updated++;
      }
    } else {
      insertContact({
        display_name: c.display_name,
        aibtc_name: c.aibtc_name,
        bns_name: c.bns_name,
        type: c.type || "agent",
        status: "active",
        stx_address: c.stx_address,
        btc_address: c.btc_address,
        taproot_address: c.taproot_address,
        github_handle: c.github_handle,
        x_handle: c.x_handle,
        email: c.email,
        website: c.website,
        agent_id: c.agent_id,
        x402_endpoint: c.x402_endpoint,
        aibtc_beat: c.aibtc_beat,
        aibtc_level: c.aibtc_level,
        notes: c.notes,
      });
      created++;
    }
  }

  log(`import complete: ${created} created, ${updated} updated (${reactivated} reactivated)`);
}

function cmdDedup(_params: Record<string, string>): void {
  initContactsSchema();
  const allContacts = getAllContacts();

  // Group contacts by btc_address, agent_id, and display_name+type
  const groups = new Map<string, Contact[]>();

  for (const c of allContacts) {
    const keys: string[] = [];
    if (c.btc_address) keys.push(`btc:${c.btc_address}`);
    if (c.agent_id) keys.push(`agent:${c.agent_id}`);
    if (c.display_name && c.type) keys.push(`name:${c.display_name}:${c.type}`);

    for (const key of keys) {
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }
  }

  // Find groups with duplicates
  const seen = new Set<number>(); // track contacts already merged
  let mergeCount = 0;
  let deleteCount = 0;

  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    // Skip if all already processed
    const unprocessed = group.filter((c) => !seen.has(c.id));
    if (unprocessed.length <= 1) continue;

    // Keep the contact with the most filled fields
    const scored = unprocessed.map((c) => {
      let filled = 0;
      if (c.display_name) filled++;
      if (c.aibtc_name) filled++;
      if (c.bns_name) filled++;
      if (c.stx_address) filled++;
      if (c.btc_address) filled++;
      if (c.taproot_address) filled++;
      if (c.x_handle) filled++;
      if (c.github_handle) filled++;
      if (c.email) filled++;
      if (c.agent_id) filled++;
      if (c.x402_endpoint) filled++;
      if (c.notes) filled++;
      return { contact: c, filled };
    });
    scored.sort((a, b) => b.filled - a.filled || a.contact.id - b.contact.id);

    const keeper = scored[0].contact;
    const dupes = scored.slice(1).map((s) => s.contact);

    // Merge missing fields from dupes into keeper
    const mergeFields: Partial<InsertContact> = {};
    for (const dupe of dupes) {
      if (dupe.display_name && !keeper.display_name) mergeFields.display_name = dupe.display_name;
      if (dupe.aibtc_name && !keeper.aibtc_name) mergeFields.aibtc_name = dupe.aibtc_name;
      if (dupe.bns_name && !keeper.bns_name) mergeFields.bns_name = dupe.bns_name;
      if (dupe.stx_address && !keeper.stx_address) mergeFields.stx_address = dupe.stx_address;
      if (dupe.btc_address && !keeper.btc_address) mergeFields.btc_address = dupe.btc_address;
      if (dupe.taproot_address && !keeper.taproot_address) mergeFields.taproot_address = dupe.taproot_address;
      if (dupe.x_handle && !keeper.x_handle) mergeFields.x_handle = dupe.x_handle;
      if (dupe.github_handle && !keeper.github_handle) mergeFields.github_handle = dupe.github_handle;
      if (dupe.email && !keeper.email) mergeFields.email = dupe.email;
      if (dupe.agent_id && !keeper.agent_id) mergeFields.agent_id = dupe.agent_id;
      if (dupe.x402_endpoint && !keeper.x402_endpoint) mergeFields.x402_endpoint = dupe.x402_endpoint;
    }

    if (Object.keys(mergeFields).length > 0) {
      updateContact(keeper.id, mergeFields);
      mergeCount++;
    }

    // Archive duplicates
    for (const dupe of dupes) {
      updateContact(dupe.id, { status: "archived" });
      seen.add(dupe.id);
      deleteCount++;
    }
    seen.add(keeper.id);

    log(`dedup [${key}]: kept #${keeper.id} (${resolveDisplayName(keeper)}), archived ${dupes.map((d) => `#${d.id}`).join(", ")}`);
  }

  if (deleteCount === 0) {
    log("no duplicates found");
  } else {
    log(`dedup complete: ${mergeCount} merged, ${deleteCount} archived`);
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
  context                           Get relevant contacts for a task (dispatch context injection)
  export                            Export contacts as JSON (for fleet-sync seeding)
  import                            Import contacts from JSON file (upsert by address/agent_id/name)
  dedup                             Find and archive duplicate contacts (keeps most complete record)

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

context flags:
  --task-subject <text>             Task subject to match against (required)
  --limit <N>                       Max contacts to return (default: 10)

Examples:
  arc skills run --name contacts -- list
  arc skills run --name contacts -- add --display-name "whoabuddy" --type human --bns-name "whoabuddy.btc"
  arc skills run --name contacts -- add --aibtc-name "Topaz Centaur" --type agent --beat "Dev Tools"
  arc skills run --name contacts -- show --id 1
  arc skills run --name contacts -- link --a 1 --b 2 --relationship "operator"
  arc skills run --name contacts -- log --id 1 --type collaboration --summary "Reviewed PR #42"
  arc skills run --name contacts -- search --term "arc0"
  arc skills run --name contacts -- context --task-subject "collaborate with Topaz Centaur on ordinals"
  arc skills run --name contacts -- export --type agent
  arc skills run --name contacts -- import --file /tmp/arc-fleet-contacts.json
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
    case "context":
      cmdContext(params);
      break;
    case "export":
      cmdExport(params);
      break;
    case "import":
      await cmdImport(params);
      break;
    case "dedup":
      cmdDedup(params);
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
