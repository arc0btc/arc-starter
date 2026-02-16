/**
 * Example Query Tool
 *
 * Query tools allow on-demand lookups and actions.
 * Unlike sensors (which run on a schedule), query tools respond to requests.
 *
 * Pattern:
 * - Query tools are functions that take input and return output
 * - They can be called from API endpoints, commands, or other tools
 * - They should be fast and focused on a single concern
 * - They can chain together (one query tool calls another)
 *
 * Common query tool types:
 * - Database queries
 * - API lookups
 * - File system searches
 * - Data transformations
 */

/**
 * Example: Simple status query
 * Returns server status information
 */
export function queryStatus(): {
  status: string;
  uptime: number;
  timestamp: string;
} {
  return {
    status: "running",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Example: Data lookup query
 * In a real agent, this would query a database or external API
 */
export async function queryData(id: string): Promise<{
  id: string;
  found: boolean;
  data?: unknown;
}> {
  // Simulate async lookup
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Mock data
  const mockDatabase: Record<string, unknown> = {
    "1": { name: "Item One", value: 100 },
    "2": { name: "Item Two", value: 200 },
    "3": { name: "Item Three", value: 300 },
  };

  const data = mockDatabase[id];

  return {
    id,
    found: !!data,
    data: data || null,
  };
}

/**
 * Example: Aggregation query
 * Combines multiple data sources into a single result
 */
export async function queryAggregate(): Promise<{
  sources: string[];
  total: number;
  timestamp: string;
}> {
  // In a real agent, these would be actual data sources
  const sources = ["source-a", "source-b", "source-c"];
  const values = await Promise.all([
    Promise.resolve(10),
    Promise.resolve(20),
    Promise.resolve(30),
  ]);

  return {
    sources,
    total: values.reduce((sum, v) => sum + v, 0),
    timestamp: new Date().toISOString(),
  };
}

/**
 * How to use query tools:
 *
 * 1. From an API endpoint:
 *    ```typescript
 *    app.get("/api/status", (c) => {
 *      const status = queryStatus();
 *      return c.json(status);
 *    });
 *    ```
 *
 * 2. From a command handler (Discord bot, CLI, etc.):
 *    ```typescript
 *    async function handleStatusCommand() {
 *      const status = queryStatus();
 *      console.log("Status:", status);
 *    }
 *    ```
 *
 * 3. From another query tool (composition):
 *    ```typescript
 *    async function queryFullReport() {
 *      const status = queryStatus();
 *      const aggregate = await queryAggregate();
 *      return { status, aggregate };
 *    }
 *    ```
 */
