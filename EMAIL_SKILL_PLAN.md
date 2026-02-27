# Email Skill — v5 Adaptation Plan

*Written 2026-02-27 during initial VM setup. Reference this when implementing.*

---

## Goal

Adapt the v4 email skill to v5 arc-starter architecture. The email skill syncs from the Cloudflare Email Worker API (`arc-email-worker` repo), detects unread messages via a sensor, and provides send/mark-read CLI commands. This is Arc's first communication channel on the new VM.

---

## What We Have

### v4 Email Skill (at `/home/dev/old-arc0btc-v4-skills/email/`)

| File | Purpose | v5 Equivalent |
|------|---------|---------------|
| `hook.ts` | Sync + detect unread, queue tasks | `sensor.ts` (sensor pattern) |
| `sync.ts` | Fetch inbox/sent from worker API, upsert locally | Keep as-is (utility) |
| `send.ts` | CLI: send email via worker API | Wrap in `cli.ts` subcommand |
| `mark-read.ts` | CLI: mark email read (local + remote) | Wrap in `cli.ts` subcommand |
| `credentials.ts` | Shell out to v4 credential CLI | Replace with `src/credentials.ts` import |
| `SKILL.md` | Orchestrator context | Update for v5 CLI syntax |
| `AGENT.md` | Subagent briefing for email tasks | Update for v5 patterns |

### v5 Infrastructure (already in place)

- **Sensor pattern**: `claimSensorRun(name, intervalMinutes)` + default export function (see `health/sensor.ts`)
- **Credential access**: `import { getCredential } from "../../src/credentials.ts"` — no shell subprocess needed
- **Task creation**: `insertTask({ subject, description, skills, priority, source })` — v5 uses object arg, not positional
- **CLI pattern**: `arc skills run --name email -- <subcommand> [flags]`
- **DB**: No `email_messages` table exists yet — need to add it

### Email Worker API (from `arc-email-worker` repo on GitHub)

Base URL + admin key stored in credential store as `email/api_base_url` and `email/admin_api_key`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages` | List messages (folder, unread, from, since, limit, offset) |
| GET | `/api/messages/:id` | Single message with full body |
| POST | `/api/messages/:id/read` | Mark as read |
| POST | `/api/send` | Send email (to, subject, body, optional from) |
| GET | `/api/stats` | Inbox total, unread, sent total |

---

## Steps

### Phase 1: Foundation (do first, verify each step)

**1.1 — Verify services are off**
- Confirm no arc systemd timers are active: `systemctl --user list-timers`
- Confirm no dispatch lock: check `db/dispatch-lock.json`
- Already verified during setup — just double-check before starting

**1.2 — Set up credentials**
- Generate `ARC_CREDS_PASSWORD` and add to `.env`
- Store email worker credentials:
  ```
  arc creds set --service email --key api_base_url --value <url>
  arc creds set --service email --key admin_api_key --value <key>
  ```
- Verify: `arc creds list` should show both entries

**1.3 — Add `email_messages` table to `src/db.ts`**
- Add the table schema to `initDatabase()`:
  ```sql
  CREATE TABLE IF NOT EXISTS email_messages (
    id INTEGER PRIMARY KEY,
    remote_id TEXT UNIQUE NOT NULL,
    message_id TEXT,
    folder TEXT NOT NULL,
    from_address TEXT NOT NULL,
    from_name TEXT,
    to_address TEXT NOT NULL,
    subject TEXT,
    body_preview TEXT,
    is_read INTEGER DEFAULT 0,
    received_at TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_email_unread ON email_messages(folder, is_read);
  ```
- Add TypeScript types: `EmailMessage`, query helpers: `upsertEmailMessage`, `getUnreadEmails`, `getAllEmailRemoteIds`, `markEmailRead`
- Run `bun src/db.ts` to verify migration applies cleanly to existing DB

### Phase 2: Skill Files

**2.1 — Create `skills/email/` directory structure**
```
skills/email/
  SKILL.md      — orchestrator context (v5 CLI syntax)
  AGENT.md      — subagent briefing (v5 patterns)
  sensor.ts     — adapted from hook.ts (v5 sensor pattern)
  sync.ts       — adapted from v4 (use src/credentials.ts)
  cli.ts        — unified CLI: send, mark-read, sync, stats
```

**2.2 — Adapt `credentials.ts` → inline**
- v4 shelled out to `bun skills/credentials/cli.ts get email api_base_url`
- v5 directly imports: `import { getCredential } from "../../src/credentials.ts"`
- No separate credentials.ts needed — inline into sync.ts and cli.ts

**2.3 — Adapt `sync.ts`**
- Replace `getEmailCredentials()` with `getCredential("email", "api_base_url")` etc.
- Replace `upsertEmailMessage` / `getAllEmailRemoteIds` imports with new db.ts exports
- Keep the core fetch logic — it's solid

**2.4 — Create `sensor.ts`** (adapted from v4 `hook.ts`)
- Use `claimSensorRun("email", 1)` for 1-minute cadence
- Call `syncEmail()` then check for unread
- Use v5 `insertTask({ ... })` with object syntax
- Add `skills: '["email"]'` to created tasks so dispatch loads the email skill
- Source format: `sensor:email:{remote_id}`
- Dedup via `pendingTaskExistsForSource(source)` (not `taskExistsForSource` — allow re-queue after completion)

**2.5 — Create `cli.ts`** (unified CLI entry point)
- Subcommands:
  - `send --to <addr> --subject <subj> --body <text> [--from <addr>]`
  - `mark-read --id <remote_id>`
  - `sync` — run sync manually, print stats
  - `stats` — fetch /api/stats from worker
- Usage: `arc skills run --name email -- send --to user@example.com --subject "Hi" --body "Hello"`

**2.6 — Write `SKILL.md`**
- Update CLI examples for v5 syntax
- Document API endpoints, credential keys, sensor behavior
- Keep it lean — this gets loaded into dispatch context

**2.7 — Write `AGENT.md`**
- Update for v5 task closing: `arc tasks close --id N --status completed --summary "..."`
- Update credential access examples
- Keep security note about untrusted email content

### Phase 3: Verify

**3.1 — Test credential access**
```
arc creds get --service email --key api_base_url
```

**3.2 — Test sync standalone**
```
arc skills run --name email -- sync
```

**3.3 — Test sensor**
```
arc sensors
```
Should show email sensor running, syncing messages, and (if unread exist) creating a task.

**3.4 — Test send** (send a test email to yourself)
```
arc skills run --name email -- send --to arc@arc0.me --subject "v5 test" --body "Email skill is live."
```

**3.5 — Test mark-read**
```
arc skills run --name email -- mark-read --id <remote_id>
```

**3.6 — Verify task creation**
```
arc tasks
```
Should show any email tasks created by the sensor with `skills: ["email"]`.

---

## Key Differences from v4

| Aspect | v4 | v5 |
|--------|----|----|
| Hook/Sensor | `hook.ts` with `shouldRun()` | `sensor.ts` with `claimSensorRun()` |
| Credentials | Shell out to CLI subprocess | Direct import from `src/credentials.ts` |
| Task creation | `insertTask(subject, body, priority, source)` positional | `insertTask({ subject, description, priority, source, skills })` object |
| Task dedup | `taskExistsForSource()` (any status) | `pendingTaskExistsForSource()` (only pending/active) |
| CLI | Direct `bun skills/email/send.ts` | `arc skills run --name email -- send` |
| DB helpers | In monolithic `src/db.ts` | Same — add email-specific queries to `src/db.ts` |

## Credentials Needed

Before starting Phase 2, we need the actual values:
- `email/api_base_url` — the Cloudflare Worker URL for arc-email-worker
- `email/admin_api_key` — the admin API key for that worker

These should be available from the v4 setup or the Cloudflare dashboard.

---

## Notes

- The email worker itself (`arc-email-worker` repo) runs on Cloudflare — we don't deploy it from this VM. We just consume its API.
- Email from external senders is untrusted. The AGENT.md should include prompt injection review guidance.
- Default sender: `arc@arc0.me`. Professional: `arc@arc0btc.com`.
- Cloudflare Worker handles routing for both domains.
