// skills/arc-moltbook/sensor.ts
// Sensor for detecting mentions and responses on Moltbook.
// Queues engagement tasks when other agents interact with Arc's posts.

import { claimSensorRun, createSensorLogger, fetchWithRetry } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "arc-moltbook";
const INTERVAL_MINUTES = 30;
const API_BASE = "https://moltbook.com/api";

const log = createSensorLogger(SENSOR_NAME);

interface MoltbookNotification {
  id: string;
  type: string; // "mention" | "reply" | "vote"
  from_user: string;
  post_id: string;
  content?: string;
  created_at: string;
}

interface NotificationsResponse {
  notifications?: MoltbookNotification[];
  error?: string;
}

async function getSessionToken(): Promise<string | null> {
  try {
    return getCredential("moltbook", "session_token");
  } catch {
    return null;
  }
}

async function fetchMentions(token: string): Promise<MoltbookNotification[]> {
  try {
    const response = await fetchWithRetry(`${API_BASE}/notifications`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 401) {
      log("warn: session token expired or invalid — re-authentication needed");
      return [];
    }

    if (!response.ok) {
      log(`warn: notifications fetch failed with ${response.status}`);
      return [];
    }

    const data = (await response.json()) as NotificationsResponse;
    if (data.error) {
      log(`warn: API error: ${data.error}`);
      return [];
    }

    return data.notifications || [];
  } catch (e) {
    const error = e as Error;
    log(`warn: notifications fetch error: ${error.message}`);
    return [];
  }
}

export default async function moltbookSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    log("run started");

    const token = await getSessionToken();
    if (!token) {
      log("no session token configured — skipping (account not yet recovered)");
      return "ok";
    }

    const notifications = await fetchMentions(token);
    if (notifications.length === 0) {
      log("no new notifications");
      return "ok";
    }

    // Filter to actionable notifications (mentions and replies, not votes)
    const actionable = notifications.filter(
      (n) => n.type === "mention" || n.type === "reply",
    );

    log(`found ${notifications.length} notifications (${actionable.length} actionable)`);

    for (const notification of actionable) {
      const taskSource = `sensor:${SENSOR_NAME}:notif-${notification.id}`;
      const exists = pendingTaskExistsForSource(taskSource);

      if (!exists) {
        log(`queuing response task for ${notification.type} from ${notification.from_user}`);
        insertTask({
          subject: `Respond to Moltbook ${notification.type} from ${notification.from_user}`,
          description: `${notification.from_user} ${notification.type === "mention" ? "mentioned" : "replied to"} Arc on Moltbook (post ${notification.post_id}). Content: "${notification.content || "(no preview)"}". Review and respond if warranted.`,
          skills: JSON.stringify(["arc-moltbook"]),
          priority: 7,
          status: "pending",
          source: taskSource,
        });
      }
    }

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
