#!/usr/bin/env bash
# install-services.sh
#
# Installs arc-agent systemd user units by symlinking them into
# ~/.config/systemd/user/ and enabling both timers.
#
# Usage: bash scripts/install-services.sh
# DO NOT run this on CI or development machines — only on the target agent VM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

echo "==> arc-agent service installer"
echo "    Repo:   $REPO_DIR"
echo "    Systemd: $SYSTEMD_USER_DIR"
echo ""

# Ensure the systemd user directory exists
mkdir -p "$SYSTEMD_USER_DIR"

# Units to install
UNITS=(
  arc-sensors.service
  arc-sensors.timer
  arc-dispatch.service
  arc-dispatch.timer
)

for unit in "${UNITS[@]}"; do
  src="$REPO_DIR/systemd/$unit"
  dest="$SYSTEMD_USER_DIR/$unit"

  if [[ ! -f "$src" ]]; then
    echo "ERROR: source unit not found: $src"
    exit 1
  fi

  # Remove existing symlink or file
  if [[ -e "$dest" || -L "$dest" ]]; then
    rm -f "$dest"
  fi

  ln -sf "$src" "$dest"
  echo "  Linked $unit"
done

echo ""
echo "==> Reloading systemd user daemon..."
systemctl --user daemon-reload

echo ""
echo "==> Enabling and starting timers..."
systemctl --user enable --now arc-sensors.timer
systemctl --user enable --now arc-dispatch.timer

echo ""
echo "==> Status:"
systemctl --user status arc-sensors.timer arc-dispatch.timer --no-pager || true

echo ""
echo "Done. Run 'journalctl --user -u arc-sensors.service -f' to follow sensor logs."
