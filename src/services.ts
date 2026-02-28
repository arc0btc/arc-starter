/**
 * Cross-platform service installer for arc-agent.
 *
 * Linux: systemd user units (service + timer)
 * macOS: launchd user agents (plist)
 *
 * Invoked via `arc services install|uninstall|status`
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const HOME = homedir();
const PLATFORM = platform();

// ---- Shared helpers ----

function bunPath(): string {
  const path = Bun.which("bun");
  if (!path) {
    throw new Error("bun not found on PATH");
  }
  return path;
}

function run(cmd: string, args: string[], opts?: { quiet?: boolean }): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, { encoding: "utf-8" });
  const ok = result.status === 0;
  if (!opts?.quiet && !ok && result.stderr) {
    process.stderr.write(result.stderr);
  }
  return { ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ---- Linux (systemd) ----

function systemdDir(): string {
  return join(HOME, ".config/systemd/user");
}

function generateServiceUnit(command: string, description: string, timeoutSec?: number): string {
  const bun = bunPath();
  const envFile = join(ROOT, ".env");
  const envLine = existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : "";
  const timeoutLine = timeoutSec ? `TimeoutStopSec=${timeoutSec}\n` : "";
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

const SYSTEMD_UNITS: Array<{ name: string; content: () => string }> = [
  { name: "arc-sensors.service", content: () => generateServiceUnit("sensors", "arc-agent sensors runner") },
  { name: "arc-sensors.timer", content: () => generateTimerUnit("arc-agent sensors timer — fires every 1 minute", "1min", "1min") },
  { name: "arc-dispatch.service", content: () => generateServiceUnit("run", "arc-agent dispatch runner", 3600) },
  { name: "arc-dispatch.timer", content: () => generateTimerUnit("arc-agent dispatch timer — fires every 1 minute", "2min", "1min") },
  { name: "arc-web.service", content: () => generateWebServiceUnit() },
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
  process.stdout.write("Enabled and started timers + web service\n");
}

function systemdUninstall(): void {
  run("systemctl", ["--user", "stop", "arc-sensors.timer"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-dispatch.timer"], { quiet: true });
  run("systemctl", ["--user", "stop", "arc-web.service"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-sensors.timer"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-dispatch.timer"], { quiet: true });
  run("systemctl", ["--user", "disable", "arc-web.service"], { quiet: true });

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
}

// ---- macOS (launchd) ----

const LAUNCHD_DIR = join(HOME, "Library/LaunchAgents");

const TIMER_AGENTS = [
  { label: "com.arc-agent.sensors", interval: 60, command: "sensors" },
  { label: "com.arc-agent.dispatch", interval: 60, command: "run" },
] as const;

const WEB_AGENT = { label: "com.arc-agent.web" } as const;

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

  process.stdout.write("\n");

  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label];
  for (const label of allLabels) {
    const plist = plistPath(label);
    run("launchctl", ["unload", plist], { quiet: true });
    run("launchctl", ["load", plist]);
  }
  process.stdout.write("Loaded launch agents + web service\n");
}

function launchdUninstall(): void {
  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label];
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
  const allLabels = [...TIMER_AGENTS.map(a => a.label), WEB_AGENT.label];
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
