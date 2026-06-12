#!/usr/bin/env bun

// skills/whop/cli.ts
//
// CLI for the `whop` skill: post hot-topics into Whop chat experiences and
// publish blog-derived courses via the Whop API. All commands read the company
// API key from the encrypted credential store and fail gracefully if it is
// absent — safe to land before credentials are provisioned.
//
// See SKILL.md for command syntax and STRATEGY.md for the monetization plan.

import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";

// Host root — each call carries its own API version. The v5 surface covers
// company/messages/course endpoints; experience listing only lives on v2.
const API_BASE = "https://api.whop.com/api";

interface WhopError {
  status: number;
  body: string;
}

function fail(message: string): never {
  process.stderr.write(`whop: ${message}\n`);
  process.exit(1);
}

async function requireApiKey(): Promise<string> {
  const key = await getCredential("whop", "company_api_key");
  if (!key) {
    fail(
      "no API key. Run: arc creds set --service whop --key company_api_key --value <company API key>\n" +
        "Scope it: chat:message:create, experience:create, course:*, membership:read",
    );
  }
  return key;
}

async function whopRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const error: WhopError = { status: response.status, body: text };
    fail(`HTTP ${error.status} on ${method} ${path}: ${error.body.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function printHelp(): void {
  process.stdout.write(
    [
      "whop CLI — monetize Arc's output via whop.com",
      "",
      "  whoami                                 verify the API key and show the company",
      "  list-experiences                       list experiences (find chat/course ids)",
      "  list-channels [--company biz_xxx]      list chat feeds (find the chat_feed_xxx channel id)",
      "  post-chat --content <md> [--channel exp_xxx]",
      "                                         post a hot-topic into a chat experience",
      "  create-course --experience exp_xxx --title <t>",
      "  create-chapter --course cou_xxx --title <t> [--order N]",
      "  create-lesson --chapter cha_xxx --title <t> [--type text|video|quiz|assignment]",
      "                [--content <md>] [--video-url <url>] [--order N]",
      "",
    ].join("\n"),
  );
}

async function cmdWhoami(apiKey: string): Promise<void> {
  // Company API keys authenticate against /v5/company, not /v5/me (the latter
  // requires a user token and returns 403 for a company key).
  const company = await whopRequest("GET", "/v5/company", apiKey);
  process.stdout.write(JSON.stringify(company, null, 2) + "\n");
}

async function cmdListExperiences(apiKey: string): Promise<void> {
  // Experience listing only exists on v2; /v5/experiences 404s.
  const experiences = await whopRequest("GET", "/v2/experiences", apiKey);
  process.stdout.write(JSON.stringify(experiences, null, 2) + "\n");
}

async function cmdListChannels(apiKey: string, flags: Record<string, string>): Promise<void> {
  // Chat feeds live on v1; each carries the canonical channel_id (chat_feed_xxx)
  // and the experience it backs. company_id defaults to the stored credential.
  const companyId = flags.company ?? (await getCredential("whop", "company_id"));
  if (!companyId) fail("list-channels requires --company biz_xxx (or set creds key company_id)");
  const channels = await whopRequest(
    "GET",
    `/v1/chat_channels?company_id=${encodeURIComponent(companyId)}`,
    apiKey,
  );
  process.stdout.write(JSON.stringify(channels, null, 2) + "\n");
}

async function cmdPostChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  const content = flags.content;
  if (!content) fail("post-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) {
    fail("post-chat requires --channel (or set creds key chat_channel_id)");
  }
  // Messages live on v1, not v5 (/api/v5/messages 404s). channel_id accepts an
  // exp_xxx experience id or a chat_feed_xxx feed id — list feeds via
  // GET /api/v1/chat_channels?company_id=biz_xxx.
  const result = await whopRequest("POST", "/v1/messages", apiKey, {
    channel_id: channel,
    content,
  });
  process.stdout.write(`posted to ${channel}\n` + JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateCourse(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience || !flags.title) fail("create-course requires --experience and --title");
  const result = await whopRequest("POST", "/v5/courses", apiKey, {
    experience_id: flags.experience,
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateChapter(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.course || !flags.title) fail("create-chapter requires --course and --title");
  const result = await whopRequest("POST", "/v5/course-chapters", apiKey, {
    course_id: flags.course,
    title: flags.title,
    order: flags.order ? Number(flags.order) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateLesson(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.chapter || !flags.title) fail("create-lesson requires --chapter and --title");
  const result = await whopRequest("POST", "/v5/course-lessons", apiKey, {
    chapter_id: flags.chapter,
    title: flags.title,
    type: flags.type ?? "text",
    content: flags.content,
    video_url: flags["video-url"],
    order: flags.order ? Number(flags.order) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = parseFlags(args.slice(1)).flags;

  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  const apiKey = await requireApiKey();

  switch (command) {
    case "whoami":
      await cmdWhoami(apiKey);
      break;
    case "list-experiences":
      await cmdListExperiences(apiKey);
      break;
    case "list-channels":
      await cmdListChannels(apiKey, flags);
      break;
    case "post-chat":
      await cmdPostChat(apiKey, flags);
      break;
    case "create-course":
      await cmdCreateCourse(apiKey, flags);
      break;
    case "create-chapter":
      await cmdCreateChapter(apiKey, flags);
      break;
    case "create-lesson":
      await cmdCreateLesson(apiKey, flags);
      break;
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
