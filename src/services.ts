/**
 * Cross-platform service installer for arc-agent.
 *
 * Linux: systemd user units (service + timer)
 * macOS: launchd user agents (plist)
 *
 * Invoked via `arc services install|uninstall|status`
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const HOME = process.env.HOME!;
const PLATFORM = process.platform;

// ---- Shared helpers ----

function bunPath(): string {
  const path = Bun.which("bun");
  if (!path) {
    throw new Error("bun not found on PATH");
  }
  return path;
}

function run(cmd: string, args: string[], opts?: { quiet?: boolean }): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync([cmd, ...args]);
  const ok = result.exitCode === 0;
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (!opts?.quiet && !ok && stderr) {
    process.stderr.write(stderr);
  }
  return { ok, stdout, stderr };
}

// ---- Linux (systemd) ----

function systemdDir(): string {
  return join(HOME, ".config/systemd/user");
}

function generateServiceUnit(command: string, description: string, timeoutSec?: number): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  const timeoutLine = timeoutSec ? `TimeoutStartSec=${timeoutSec}\nTimeoutStopSec=${timeoutSec}\n` : "";
  return `[Unit]
Description=${description}
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=${bun} src/cli.ts ${command}
Environment="HOME=${HOME}"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin:${HOME}/.local/bin"
${envLine}${timeoutLine}StandardOutput=journal
StandardError=journal
`;
}

function generateWebServiceUnit(): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  const port = process.env.ARC_WEB_PORT || "3000";
  return `[Unit]
Description=Arc Web Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${bun} src/web.ts
Restart=on-failure
RestartSec=5
Environment="HOME=${HOME}"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin:${HOME}/.local/bin"
Environment="ARC_WEB_PORT=${port}"
${envLine}StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

function generateObservatoryServiceUnit(): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  return `[Unit]
Description=Arc Observatory — Fleet Dashboard
After=network.target arc-web.service

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${bun} skills/arc-observatory/cli.ts start
Restart=on-failure
RestartSec=5
Environment="HOME=${HOME}"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin:${HOME}/.local/bin"
${envLine}StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

function generateMcpServiceUnit(): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  const port = process.env.ARC_MCP_PORT || "3100";
  return `[Unit]
Description=Arc MCP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${bun} skills/arc-mcp-server/server.ts --transport http --port ${port}
Restart=on-failure
RestartSec=5
Environment="HOME=${HOME}"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin:${HOME}/.local/bin"
Environment="ARC_MCP_PORT=${port}"
${envLine}StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;
}

function generateTimerUnit(description: string, bootSec: string, intervalSec: string): string {
  return `[Unit]
Description=${description}

[Timer]
OnBootSec=${bootSec}
OnUnitActiveSec=${intervalSec}

[Install]
WantedBy=timers.target
`;
}

function generateWatchdogServiceUnit(): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  return `[Unit]
Description=Arc External Dispatch Watchdog
After=network.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=${bun} src/external-watchdog.ts
Environment="HOME=${HOME}"
Environment="PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin:${HOME}/.local/bin"
${envLine}StandardOutput=journal
StandardError=journal
`;
}

const SYSTEMD_UNITS: Array<{ name: string; content: () => string }> = [
  { name: "arc-sensors.service", content: () => generateServiceUnit("sensors", "arc-agent sensors runner") },
  { name: "arc-sensors.timer", content: () => generateTimerUnit("arc-agent sensors timer — fires every 1 minute", "1min", "1min") },
  { name: "arc-dispatch.service", content: () => generateServiceUnit("run", "arc-agent dispatch runner", 6000) },
  { name: "arc-dispatch.timer", content: () => generateTimerUnit("arc-agent dispatch timer — fires every 1 minute", "2min", "1min") },
  { name: "arc-web.service", content: () => generateWebServiceUnit() },
  { name: "arc-mcp.service", content: () => generateMcpServiceUnit() },
  { name: "arc-observatory.service", content: () => generateObservatoryServiceUnit() },
  { name: "arc-watchdog.service", content: () => generateWatchdogServiceUnit() },
  { name: "arc-watchdog.timer", content: () => generateTimerUnit("Arc external dispatch watchdog — fires every 15 minutes", "5min", "15min") },
];

function systemdInstall(): void {
  const dir = systemdDir();
  mkdirSync(dir, { recursive: true });

  for (const unit of SYSTEMD_UNITS) {
    const dest = join(dir, unit.name);
    writeFileSync(dest, unit.content());
    process.stdout.write(`  Wrote ${unit.name}\n`);
  }

  process.stdout.write("\n");

  run("systemctl", ["--user", "daemon-reload"]);
  process.stdout.write("Reloaded systemd daemon\n");

  run("systemctl", ["--user", "enable", "--now", "arc-sensors.timer"]);
  run("systemctl", ["--user", "enable", "--now", "arc-dispatch.timer"]);
  run("systemctl", ["--user", "enable", "--now", "arc-web.service"]);
  run("systemctl", ["--user", "enable", "--now", "arc-mcp.service"]);
  run("systemctl", ["--user", "enable", "--now", "arc-observatory.service"]);
  run("systemctl", ["--user", "enable", "--now", "arc-watchdog.timer"]);
  process.stdout.write("Enabled and started timers + web + MCP + observatory + watchdog services\n");
}

function systemdUninstall(): void {
  run("systemctl", ["--user", "stop", "arc-sensors.timer"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-dispatch.timer"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-web.service"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-mcp.service"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-observatory.service"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-watchdog.timer"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-sensors.timer"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-dispatch.timer"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-web.service"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-mcp.service"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-observatory.service"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-watchdog.timer"], { quiet: true });

  const dir = systemdDir();
  for (const unit of SYSTEMD_UNITS) {
    const dest = join(dir, unit.name);
    if (existsSync(dest)) {
      unlinkSync(dest);
      process.stdout.write(`  Removed ${unit.name}\n`);
    }
  }

  run("systemctl", ["--user", "daemon-reload"]);
  process.stdout.write("Services uninstalled\n");
}

function systemdStatus(): void {
  const { stdout: timerStatus } = run("systemctl", [
    "--user", "status",
    "arc-sensors.timer", "arc-dispatch.timer",
    "--no-pager",
  ], { quiet: true });
  process.stdout.write(timerStatus || "Timers not found. Run: arc services install\n");

  process.stdout.write("\n");

  const { stdout: webStatus } = run("systemctl", [
    "--user", "status",
    "arc-web.service",
    "--no-pager",
  ], { quiet: true });
  process.stdout.write(webStatus || "Web service not found. Run: arc services install\n");

  process.stdout.write("\n");

  const { stdout: mcpStatus } = run("systemctl", [
    "--user", "status",
    "arc-mcp.service",
    "--no-pager",
  ], { quiet: true });
  process.stdout.write(mcpStatus || "MCP service not found. Run: arc services install\n");

  process.stdout.write("\n");

  const { stdout: observatoryStatus } = run("systemctl", [
    "--user", "status",
    "arc-observatory.service",
    "--no-pager",
  ], { quiet: true });
  process.stdout.write(observatoryStatus || "Observatory service not found. Run: arc services install\n");

  process.stdout.write("\n");

  const { stdout: watchdogStatus } = run("systemctl", [
    "--user", "status",
    "arc-watchdog.timer",
    "--no-pager",
  ], { quiet: true });
  process.stdout.write(watchdogStatus || "Watchdog timer not found. Run: arc services install\n");
}

// ---- macOS (launchd) ----

const LAUNCHD_DIR = join(HOME, "Library/LaunchAgents");

const TIMER_AGENTS = [
  { label: "com.arc-agent.sensors", interval: 60, command: "sensors" },
  { label: "com.arc-agent.dispatch", interval: 60, command: "run" },
] as const;

const WEB_AGENT = { label: "com.arc-agent.web" } as const;
const MCP_AGENT = { label: "com.arc-agent.mcp" } as const;
const OBSERVATORY_AGENT = { label: "com.arc-agent.observatory" } as const;

function plistPath(label: string): string {
  return join(LAUNCHD_DIR, `${label}.plist`);
}

function generatePlist(agent: { label: string; interval: number }, command: string): string {
  const bun = bunPath();
  const logDir = join(ROOT, "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${agent.label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bun}</string>
        <string>src/cli.ts</string>
        <string>${command}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>StartInterval</key>
    <integer>${agent.interval}</integer>
    <key>StandardOutPath</key>
    <string>${logDir}/${command}.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/${command}.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin</string>
    </dict>
</dict>
</plist>`;
}

function generateWebPlist(): string {
  const bun = bunPath();
  const logDir = join(ROOT, "logs");
  const port = process.env.ARC_WEB_PORT || "3000";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${WEB_AGENT.label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bun}</string>
        <string>src/web.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/web.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/web.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin</string>
        <key>ARC_WEB_PORT</key>
        <string>${port}</string>
    </dict>
</dict>
</plist>`;
}

function generateObservatoryPlist(): string {
  const bun = bunPath();
  const logDir = join(ROOT, "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${OBSERVATORY_AGENT.label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bun}</string>
        <string>skills/arc-observatory/cli.ts</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/observatory.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/observatory.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin</string>
    </dict>
</dict>
</plist>`;
}

function generateMcpPlist(): string {
  const bun = bunPath();
  const logDir = join(ROOT, "logs");
  const port = process.env.ARC_MCP_PORT || "3100";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${MCP_AGENT.label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${bun}</string>
        <string>skills/arc-mcp-server/server.ts</string>
        <string>--transport</string>
        <string>http</string>
        <string>--port</string>
        <string>${port}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/mcp.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/mcp.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/.bun/bin</string>
        <key>ARC_MCP_PORT</key>
        <string>${port}</string>
    </dict>
</dict>
</plist>`;
}

function launchdInstall(): void {
  mkdirSync(LAUNCHD_DIR, { recursive: true });
  mkdirSync(join(ROOT, "logs"), { recursive: true });

  // Timer-based agents (sensors + dispatch)
  for (const agent of TIMER_AGENTS) {
    const plist = plistPath(agent.label);
    writeFileSync(plist, generatePlist(agent, agent.command));
    process.stdout.write(`  Wrote ${agent.label}.plist\n`);
  }

  // Persistent web service
  const webPlist = plistPath(WEB_AGENT.label);
  writeFileSync(webPlist, generateWebPlist());
  process.stdout.write(`  Wrote ${WEB_AGENT.label}.plist\n`);

  // Persistent MCP server
  const mcpPlist = plistPath(MCP_AGENT.label);
  writeFileSync(mcpPlist, generateMcpPlist());
  process.stdout.write(`  Wrote ${MCP_AGENT.label}.plist\n`);

  // Persistent observatory
  const obsPlist = plistPath(OBSERVATORY_AGENT.label);
  writeFileSync(obsPlist, generateObservatoryPlist());
  process.stdout.write(`  Wrote ${OBSERVATORY_AGENT.label}.plist\n`);

  process.stdout.write("\n");

  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label, MCP_AGENT.label, OBSERVATORY_AGENT.label];
  for (const label of allLabels) {
    const plist = plistPath(label);
    run("launchctl", ["unload", plist], { quiet: true });
    run("launchctl", ["load", plist]);
  }
  process.stdout.write("Loaded launch agents + web + MCP services\n");
}

function launchdUninstall(): void {
  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label, MCP_AGENT.label, OBSERVATORY_AGENT.label];
  for (const label of allLabels) {
    const plist = plistPath(label);
    if (existsSync(plist)) {
      run("launchctl", ["unload", plist], { quiet: true });
      unlinkSync(plist);
      process.stdout.write(`  Removed ${label}.plist\n`);
    }
  }
  process.stdout.write("Launch agents uninstalled\n");
}

function launchdStatus(): void {
  let found = false;
  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label, MCP_AGENT.label, OBSERVATORY_AGENT.label];
  for (const label of allLabels) {
    const { stdout } = run("launchctl", ["list", label], { quiet: true });
    if (stdout.includes(label)) {
      process.stdout.write(`${label}: running\n`);
      found = true;
    }
  }
  if (!found) {
    process.stdout.write("No launch agents found. Run: arc services install\n");
  }
}

// ---- Public API ----

interface PlatformHandlers {
  linux: () => void;
  darwin: () => void;
}

function dispatchByPlatform(handlers: PlatformHandlers): void {
  const handler = handlers[PLATFORM as keyof PlatformHandlers];
  if (handler) {
    handler();
  } else {
    process.stderr.write(`Unsupported platform: ${PLATFORM}\n`);
    process.exit(1);
  }
}

export function servicesInstall(): void {
  process.stdout.write("==> Installing arc-agent services\n\n");
  dispatchByPlatform({ linux: systemdInstall, darwin: launchdInstall });
  process.stdout.write("\nDone. Use 'arc services status' to verify.\n");
}

export function servicesUninstall(): void {
  process.stdout.write("==> Uninstalling arc-agent services\n\n");
  dispatchByPlatform({ linux: systemdUninstall, darwin: launchdUninstall });
}

export function servicesStatus(): void {
  dispatchByPlatform({ linux: systemdStatus, darwin: launchdStatus });
}
