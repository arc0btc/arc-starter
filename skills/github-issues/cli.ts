#!/usr/bin/env bun
// skills/github-issues/cli.ts
// CLI for GitHub issue triage and code analysis.

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

function authHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function ghFetch(url: string, token?: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${url}`);
  return response.json();
}

async function cmdTriage(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const repo = typeof flags["repo"] === "string" ? flags["repo"] : "";
  const issueN = typeof flags["issue"] === "string" ? parseInt(flags["issue"], 10) : 0;
  if (!repo || !issueN) {
    process.stderr.write("Error: --repo OWNER/REPO and --issue N are required\n");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  const issue = await ghFetch(`https://api.github.com/repos/${repo}/issues/${issueN}`, token) as Record<string, unknown>;

  const labels = (issue["labels"] as Array<{ name: string }>).map((l) => l.name);
  const assignees = (issue["assignees"] as Array<{ login: string }>).map((a) => a.login);

  console.log(JSON.stringify({
    number: issue["number"],
    title: issue["title"],
    state: issue["state"],
    labels,
    assignees,
    created_at: issue["created_at"],
    updated_at: issue["updated_at"],
    url: issue["html_url"],
    body: typeof issue["body"] === "string" ? issue["body"].slice(0, 2000) : null,
    comments: issue["comments"],
  }, null, 2));
}

async function cmdAnalyze(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const repo = typeof flags["repo"] === "string" ? flags["repo"] : "";
  const issueN = typeof flags["issue"] === "string" ? parseInt(flags["issue"], 10) : 0;
  const localPath = typeof flags["path"] === "string" ? flags["path"] : ".";
  if (!repo || !issueN) {
    process.stderr.write("Error: --repo OWNER/REPO and --issue N are required\n");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  const issue = await ghFetch(`https://api.github.com/repos/${repo}/issues/${issueN}`, token) as Record<string, unknown>;

  const labels = (issue["labels"] as Array<{ name: string }>).map((l) => l.name);

  // Classify issue type
  const labelLow = labels.map((l) => l.toLowerCase());
  let type = "feature";
  if (labelLow.some((l) => l.includes("bug") || l.includes("security"))) type = "bug";
  else if (labelLow.some((l) => l.includes("question") || l.includes("doc"))) type = "question";

  console.log(JSON.stringify({
    issue_number: issueN,
    repo,
    title: issue["title"],
    type,
    labels,
    analysis_path: localPath,
    body_excerpt: typeof issue["body"] === "string" ? issue["body"].slice(0, 1000) : null,
    guidance: type === "bug"
      ? `Search ${localPath} for code paths mentioned in the issue body. Look for the specific function, file, or behavior described.`
      : type === "security"
      ? `Review ${localPath} for the vulnerability pattern. Check inputs, outputs, and trust boundaries.`
      : `Review ${localPath} to assess effort and architectural fit for this feature request.`,
    next_steps: type === "bug"
      ? ["Reproduce locally", "Identify affected code path", "Write fix + test", "Open PR via Arc fleet-handoff"]
      : ["Assess scope and effort", "Create planning task if approved", "Route to Arc for PR creation"],
  }, null, 2));
}

async function cmdList(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const repo = typeof flags["repo"] === "string" ? flags["repo"] : "";
  if (!repo) {
    process.stderr.write("Error: --repo OWNER/REPO is required\n");
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  const issues = await ghFetch(
    `https://api.github.com/repos/${repo}/issues?state=open&sort=updated&per_page=20`,
    token,
  ) as Array<Record<string, unknown>>;

  const filtered = issues.filter((i) => !i["pull_request"]);

  console.log(JSON.stringify({
    repo,
    count: filtered.length,
    issues: filtered.map((i) => ({
      number: i["number"],
      title: i["title"],
      labels: (i["labels"] as Array<{ name: string }>).map((l) => l.name),
      assignees: (i["assignees"] as Array<{ login: string }>).map((a) => a.login),
      updated_at: i["updated_at"],
      url: i["html_url"],
    })),
  }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`github-issues CLI

USAGE
  arc skills run --name github-issues -- <subcommand> [flags]

SUBCOMMANDS
  list --repo OWNER/REPO
    List open issues for a repo.

  triage --repo OWNER/REPO --issue N
    Fetch and display full issue details.

  analyze --repo OWNER/REPO --issue N [--path PATH]
    Fetch issue and provide analysis guidance with local path context.

ENVIRONMENT
  GITHUB_TOKEN  Optional — increases rate limit from 60 to 5000 req/hr

EXAMPLES
  arc skills run --name github-issues -- list --repo aibtcdev/skills
  arc skills run --name github-issues -- triage --repo aibtcdev/skills --issue 42
  arc skills run --name github-issues -- analyze --repo aibtcdev/skills --issue 42 --path ./skills
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "list":
      await cmdList(args.slice(1));
      break;
    case "triage":
      await cmdTriage(args.slice(1));
      break;
    case "analyze":
      await cmdAnalyze(args.slice(1));
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
