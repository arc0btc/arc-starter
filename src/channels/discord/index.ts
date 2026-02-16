/**
 * Discord Channel (Stub)
 *
 * This is a placeholder showing how to integrate Discord.
 * It doesn't actually connect to Discord - see README.md for setup instructions.
 *
 * Pattern:
 * - Channels are bidirectional: receive messages, send responses
 * - They translate between external protocols and internal events
 * - Commands are parsed and routed to handlers
 * - Responses are formatted for the channel's protocol
 *
 * Why Discord?
 * - Rich UI (embeds, buttons, threads)
 * - Real-time communication
 * - Familiar to users
 * - Good bot API
 *
 * For full Discord integration, see:
 * - arc-starter/src/channels/discord/README.md
 */

import { eventBus } from "../../server/events";

/**
 * Discord configuration
 */
export interface DiscordConfig {
  /** Bot token (from Discord Developer Portal) */
  token: string;
  /** Server ID to connect to */
  guildId?: string;
  /** Channel ID for notifications */
  notificationChannelId?: string;
}

/**
 * Discord client stub
 * Replace this with actual discord.js implementation
 */
export class DiscordClient {
  private config: DiscordConfig;
  private connected = false;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  /**
   * Connect to Discord
   * Stub implementation - doesn't actually connect
   */
  async connect(): Promise<void> {
    console.log("[Discord] Connecting...");

    // In a real implementation, this would:
    // 1. Create discord.js Client
    // 2. Login with token
    // 3. Set up event handlers (messageCreate, etc.)
    // 4. Emit channel:message events

    this.connected = true;
    console.log("[Discord] Connected (stub mode - not actually connected)");

    // Example: Listen to server events and send to Discord
    eventBus.on("task:completed", (payload) => {
      this.sendMessage(`✅ Task completed: ${payload.taskName}`);
    });

    eventBus.on("task:failed", (payload) => {
      this.sendMessage(`❌ Task failed: ${payload.taskName} - ${payload.error}`);
    });
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    console.log("[Discord] Disconnected");
  }

  /**
   * Send a message to Discord
   * Stub implementation - just logs
   */
  sendMessage(content: string): void {
    if (!this.connected) {
      console.warn("[Discord] Cannot send message - not connected");
      return;
    }

    // In a real implementation, this would send to Discord
    console.log(`[Discord] Would send message: ${content}`);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Initialize Discord client (if credentials available)
 */
export async function initDiscord(
  config?: DiscordConfig
): Promise<DiscordClient | null> {
  if (!config?.token) {
    console.log(
      "[Discord] No token provided - Discord integration disabled"
    );
    console.log(
      "   See arc-starter/src/channels/discord/README.md for setup"
    );
    return null;
  }

  const client = new DiscordClient(config);
  await client.connect();
  return client;
}

/**
 * Example usage:
 *
 * ```typescript
 * // In src/index.ts
 * import { initDiscord } from "./channels/discord";
 *
 * const discord = await initDiscord({
 *   token: process.env.DISCORD_TOKEN || "",
 *   guildId: process.env.DISCORD_GUILD_ID,
 * });
 *
 * if (discord) {
 *   discord.sendMessage("🤖 Agent online");
 * }
 * ```
 */
