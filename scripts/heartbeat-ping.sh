#!/usr/bin/env bash
# scripts/heartbeat-ping.sh
#
# Outage-hardening (2026-07-19, p9 of arc-x-research-channel quest). POSTs a heartbeat to
# arc-heartbeat-worker (Cloudflare, off-LAN) so the dead-man's-switch cron can page Discord
# when Arc goes fully silent -- as happened for ~46h during the 2026-07-17->07-19 monsoon
# outage, which all in-house (same-LAN) monitoring was blind to by construction.
#
# Deliberately standalone: no dependency on arc-starter's DB, credential store, or dispatch/
# sensor machinery -- reads a plain env file and does one bounded curl. This must keep beating
# even if arc-sensors.service / arc-dispatch.service wedge.
#
# SCOPE (dev-council Hohpe lens, 2026-07-19): "independent" above means independent of the
# SOFTWARE wedge modes that caused the 07-17->07-19 incident (bun runtime / DB / credential
# store / dispatch-sensor code paths) -- not zero shared fate in every sense. This timer still
# shares the same systemd --user manager/slice, kernel, VM, and network uplink as
# arc-sensors/arc-dispatch. That residual sharing is benign for THIS purpose: a shared-fate
# failure (user-manager OOM, NIC down) manifests as heartbeat silence too, which is exactly the
# alert trigger -- shared network fate is a feature here, not a coupling defect. (Linger=yes on
# this systemd user session is what closes the one non-benign variant: SSH logout tearing down
# the user manager and killing all three timers with it.)
set -euo pipefail

ENV_FILE="/home/dev/arc-starter/.env.heartbeat"
if [ ! -f "$ENV_FILE" ]; then
  echo "heartbeat-ping: $ENV_FILE missing, cannot send heartbeat" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -z "${HEARTBEAT_TOKEN:-}" ] || [ -z "${HEARTBEAT_URL:-}" ]; then
  echo "heartbeat-ping: HEARTBEAT_TOKEN or HEARTBEAT_URL not set" >&2
  exit 1
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --max-time bounds the whole call (connect + transfer) so this can never itself hang --
# the exact class of bug this whole phase exists to guard against.
HTTP_CODE=$(curl -sS --max-time 10 -o /tmp/heartbeat-ping-last.json -w "%{http_code}" \
  -X POST "$HEARTBEAT_URL" \
  -H "Authorization: Bearer $HEARTBEAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"agent\":\"arc\",\"ts\":\"$TS\"}" || echo "curl_failed")

if [ "$HTTP_CODE" != "200" ]; then
  echo "heartbeat-ping: FAILED (http=$HTTP_CODE) at $TS" >&2
  exit 1
fi

echo "heartbeat-ping: ok at $TS"
