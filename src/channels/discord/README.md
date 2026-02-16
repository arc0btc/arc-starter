# Discord Integration Setup

This directory contains a stub Discord client. To enable real Discord integration:

## Prerequisites

1. **Discord Bot Token**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to Bot section
   - Click "Reset Token" and copy your bot token
   - **Never commit tokens to git!**

2. **Server/Guild ID**
   - Right-click your Discord server → Copy Server ID
   - (You need Developer Mode enabled in Discord settings)

3. **Invite Bot to Server**
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Read Message History`, `Use Slash Commands`
   - Copy generated URL and open in browser
   - Select your server and authorize

## Installation

```bash
# Install discord.js
bun add discord.js
```

## Implementation

Replace the stub in `index.ts` with this real implementation:

```typescript
import { Client, GatewayIntentBits, Message } from "discord.js";
import { eventBus } from "../../server/events";

export class DiscordClient {
  private client: Client;
  private config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async connect(): Promise<void> {
    // Handle messages
    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return; // Ignore other bots

      // Emit event for message handling
      eventBus.emit("channel:message", {
        channel: "discord",
        message: message.content,
      });

      // Example command: !status
      if (message.content === "!status") {
        const uptime = process.uptime();
        await message.reply(`🤖 Bot online • Uptime: ${Math.floor(uptime)}s`);
      }
    });

    // Login
    await this.client.login(this.config.token);
    console.log("[Discord] Connected successfully");
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
    console.log("[Discord] Disconnected");
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.config.notificationChannelId) return;

    const channel = await this.client.channels.fetch(
      this.config.notificationChannelId
    );

    if (channel?.isTextBased()) {
      await channel.send(content);
    }
  }

  isConnected(): boolean {
    return this.client.isReady();
  }
}
```

## Environment Variables

Add to your `.env` file (never commit this!):

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here
DISCORD_NOTIFICATION_CHANNEL_ID=your_channel_id_here
```

## Usage

```typescript
// In src/index.ts
import { initDiscord } from "./channels/discord";

const discord = await initDiscord({
  token: process.env.DISCORD_TOKEN || "",
  guildId: process.env.DISCORD_GUILD_ID,
  notificationChannelId: process.env.DISCORD_NOTIFICATION_CHANNEL_ID,
});
```

## Commands

The bot will respond to messages in your server. Example commands to implement:

- `!status` - Show agent status
- `!health` - Show health check
- `!tasks` - List scheduled tasks
- `!help` - Show available commands

## Events

The Discord client emits `channel:message` events that you can listen to:

```typescript
eventBus.on("channel:message", (payload) => {
  console.log("Message from Discord:", payload.message);
  // Route to command handler, etc.
});
```

## Resources

- [discord.js Guide](https://discordjs.guide/)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord.js Documentation](https://discord.js.org/)
