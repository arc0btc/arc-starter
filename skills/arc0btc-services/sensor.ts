// skills/arc0btc-services/sensor.ts
//
// Monitors service delivery pipeline every 60 minutes.
// Checks for overdue deliveries and stale orders.
// Creates alert tasks when issues are detected.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { join } from "node:path";

const SENSOR_NAME = "arc0btc-services";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:arc0btc-services";
const ORDERS_PATH = join(import.meta.dir, "orders.json");
const STALE_HOURS = 4;

const log = createSensorLogger(SENSOR_NAME);

interface Order {
  id: string;
  service_id: string;
  status: string;
  created_at: string;
  accepted_at?: string;
  delivered_at?: string;
}

interface ServiceDelivery {
  estimated_hours: number;
}

interface Service {
  id: string;
  delivery: ServiceDelivery;
}

async function loadOrders(): Promise<Order[]> {
  const file = Bun.file(ORDERS_PATH);
  if (!(await file.exists())) return [];
  return (await file.json()) as Order[];
}

async function loadCatalog(): Promise<Service[]> {
  const file = Bun.file(join(import.meta.dir, "catalog.json"));
  if (!(await file.exists())) return [];
  return (await file.json()) as Service[];
}

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

export default async function arc0btcServicesSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const orders = await loadOrders();
    if (orders.length === 0) {
      log("no orders to monitor");
      return "ok";
    }

    const catalog = await loadCatalog();
    const catalogMap = new Map(catalog.map((s) => [s.id, s]));
    const issues: string[] = [];

    for (const order of orders) {
      // Check for stale accepted orders (not started within STALE_HOURS)
      if (order.status === "accepted" && order.accepted_at) {
        const hours = hoursAgo(order.accepted_at);
        if (hours > STALE_HOURS) {
          issues.push(`Stale: ${order.id} (${order.service_id}) accepted ${Math.floor(hours)}h ago, not started`);
        }
      }

      // Check for overdue in-progress orders
      if (order.status === "in_progress" && order.accepted_at) {
        const svc = catalogMap.get(order.service_id);
        if (svc) {
          const hours = hoursAgo(order.accepted_at);
          if (hours > svc.delivery.estimated_hours) {
            issues.push(`Overdue: ${order.id} (${order.service_id}) ${Math.floor(hours)}h elapsed, estimate was ${svc.delivery.estimated_hours}h`);
          }
        }
      }
    }

    if (issues.length === 0) {
      log("all orders on track");
      return "ok";
    }

    if (pendingTaskExistsForSource(TASK_SOURCE)) {
      log(`${issues.length} issue(s) but alert task already pending`);
      return "ok";
    }

    insertTask({
      subject: `Service delivery alert: ${issues.length} issue(s)`,
      description:
        `Service pipeline issues detected:\n\n` +
        issues.map((i) => `- ${i}`).join("\n") +
        `\n\nRun: arc skills run --name arc0btc-services -- orders`,
      skills: JSON.stringify(["arc0btc-services"]),
      source: TASK_SOURCE,
      priority: 4,
      model: "sonnet",
    });

    log(`created alert task: ${issues.length} issue(s)`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
