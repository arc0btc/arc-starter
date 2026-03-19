#!/usr/bin/env bun
// skills/arc0btc-services/cli.ts
// Service catalog and delivery pipeline management for arc0btc.com (D1).

import { join } from "node:path";

const SKILL_DIR = join(import.meta.dir);
const CATALOG_PATH = join(SKILL_DIR, "catalog.json");
const ORDERS_PATH = join(SKILL_DIR, "orders.json");

interface ServicePricing {
  base_sats: number;
  currency: string;
}

interface ServiceDelivery {
  estimated_hours: number;
  model_tier: string;
}

interface Service {
  id: string;
  name: string;
  description: string;
  pricing: ServicePricing;
  delivery: ServiceDelivery;
  status: "active" | "draft" | "paused" | "retired";
  tags: string[];
}

interface Order {
  id: string;
  service_id: string;
  customer_btc_address: string;
  details: string;
  status: "received" | "accepted" | "in_progress" | "delivered" | "confirmed";
  created_at: string;
  accepted_at?: string;
  delivered_at?: string;
  task_id?: number;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function loadCatalog(): Promise<Service[]> {
  const file = Bun.file(CATALOG_PATH);
  if (!(await file.exists())) return [];
  return (await file.json()) as Service[];
}

async function loadOrders(): Promise<Order[]> {
  const file = Bun.file(ORDERS_PATH);
  if (!(await file.exists())) return [];
  return (await file.json()) as Order[];
}

async function saveOrders(orders: Order[]): Promise<void> {
  await Bun.write(ORDERS_PATH, JSON.stringify(orders, null, 2) + "\n");
}

async function cmdCatalog(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const catalog = await loadCatalog();

  const statusFilter = typeof flags["status"] === "string" ? flags["status"] : undefined;
  const filtered = statusFilter ? catalog.filter((s) => s.status === statusFilter) : catalog;

  if (filtered.length === 0) {
    console.log("No services found.");
    return;
  }

  for (const svc of filtered) {
    const price = `${svc.pricing.base_sats.toLocaleString()} ${svc.pricing.currency}`;
    console.log(`[${svc.status}] ${svc.id}: ${svc.name} — ${price} (${svc.delivery.estimated_hours}h)`);
  }
  console.log(`\n${filtered.length} service(s)`);
}

async function cmdShow(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const id = typeof flags["id"] === "string" ? flags["id"] : undefined;

  if (!id) {
    process.stderr.write("Error: --id required\n");
    process.exit(1);
  }

  const catalog = await loadCatalog();
  const svc = catalog.find((s) => s.id === id);

  if (!svc) {
    process.stderr.write(`Error: service '${id}' not found\n`);
    process.exit(1);
  }

  console.log(JSON.stringify(svc, null, 2));
}

async function cmdOrders(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const orders = await loadOrders();

  const statusFilter = typeof flags["status"] === "string" ? flags["status"] : undefined;
  const filtered = statusFilter ? orders.filter((o) => o.status === statusFilter) : orders;

  if (filtered.length === 0) {
    console.log("No orders found.");
    return;
  }

  for (const order of filtered) {
    console.log(`[${order.status}] ${order.id}: ${order.service_id} — ${order.customer_btc_address.substring(0, 12)}...`);
  }
  console.log(`\n${filtered.length} order(s)`);
}

async function cmdDeliver(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const orderId = typeof flags["order-id"] === "string" ? flags["order-id"] : undefined;

  if (!orderId) {
    process.stderr.write("Error: --order-id required\n");
    process.exit(1);
  }

  const orders = await loadOrders();
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    process.stderr.write(`Error: order '${orderId}' not found\n`);
    process.exit(1);
  }

  if (order.status === "delivered" || order.status === "confirmed") {
    process.stderr.write(`Error: order '${orderId}' already ${order.status}\n`);
    process.exit(1);
  }

  order.status = "delivered";
  order.delivered_at = new Date().toISOString();
  await saveOrders(orders);
  console.log(`Order ${orderId} marked as delivered at ${order.delivered_at}`);
}

function printUsage(): void {
  process.stdout.write(`arc0btc-services CLI — Service catalog and delivery pipeline

USAGE
  arc skills run --name arc0btc-services -- <subcommand> [flags]

SUBCOMMANDS
  catalog [--status STATUS]     List services (filter: active|draft|paused|retired)
  show --id <service-id>        Show service detail as JSON
  orders [--status STATUS]      List orders (filter: received|accepted|in_progress|delivered|confirmed)
  deliver --order-id <id>       Mark an order as delivered

EXAMPLES
  arc skills run --name arc0btc-services -- catalog --status active
  arc skills run --name arc0btc-services -- show --id blockchain-analysis
  arc skills run --name arc0btc-services -- orders
  arc skills run --name arc0btc-services -- deliver --order-id ord-001
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "catalog":
      await cmdCatalog(args.slice(1));
      break;
    case "show":
      await cmdShow(args.slice(1));
      break;
    case "orders":
      await cmdOrders(args.slice(1));
      break;
    case "deliver":
      await cmdDeliver(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
