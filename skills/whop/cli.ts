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

const API_BASE = "https://api.whop.com/api/v5";

interface WhopError {
  status: number;
  body: string;
}

function fail(message: string): never {
  process.stderr.write(`whop: ${message}\n`);
  process.exit(1);
}

async function requireApiKey(): Promise<string> {
  const key = await getCredential("whop", "api_key");
  if (!key) {
    fail(
      "no API key. Run: arc creds set --service whop --key api_key --value <company API key>\n" +
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
  const me = await whopRequest("GET", "/me", apiKey);
  process.stdout.write(JSON.stringify(me, null, 2) + "\n");
}

async function cmdListExperiences(apiKey: string): Promise<void> {
  const experiences = await whopRequest("GET", "/experiences", apiKey);
  process.stdout.write(JSON.stringify(experiences, null, 2) + "\n");
}

async function cmdPostChat(apiKey: string, flags: Record<string, string>): Promise<void> {
  const content = flags.content;
  if (!content) fail("post-chat requires --content <markdown>");
  const channel = flags.channel ?? (await getCredential("whop", "chat_channel_id"));
  if (!channel) {
    fail("post-chat requires --channel exp_xxx (or set creds key chat_channel_id)");
  }
  const result = await whopRequest("POST", "/messages", apiKey, {
    channel_id: channel,
    content,
  });
  process.stdout.write(`posted to ${channel}\n` + JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateCourse(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.experience || !flags.title) fail("create-course requires --experience and --title");
  const result = await whopRequest("POST", "/courses", apiKey, {
    experience_id: flags.experience,
    title: flags.title,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateChapter(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.course || !flags.title) fail("create-chapter requires --course and --title");
  const result = await whopRequest("POST", "/course-chapters", apiKey, {
    course_id: flags.course,
    title: flags.title,
    order: flags.order ? Number(flags.order) : undefined,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function cmdCreateLesson(apiKey: string, flags: Record<string, string>): Promise<void> {
  if (!flags.chapter || !flags.title) fail("create-lesson requires --chapter and --title");
  const result = await whopRequest("POST", "/course-lessons", apiKey, {
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
