#!/usr/bin/env bash
# install-prerequisites.sh — Install everything needed to run arc-agent
#
# Works on: macOS (arm64/x64), Linux (Debian/Ubuntu)
# Installs: tmux, bun, gh, claude CLI
# Configures: git identity from GitHub profile, database, arc CLI, linger
# Idempotent: safe to run multiple times
#
# Usage:
#   bash scripts/install-prerequisites.sh              # interactive (default)
#   bash scripts/install-prerequisites.sh --autonomous # enable DANGEROUS=true for unattended dispatch

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

OS="$(uname -s)"
AUTONOMOUS=false
ENV_FILE="$REPO_DIR/.env"

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --autonomous) AUTONOMOUS=true ;;
    *)
      echo "Unknown flag: $arg"
      echo "Usage: bash scripts/install-prerequisites.sh [--autonomous]"
      exit 1
      ;;
  esac
done

echo "==> arc-agent prerequisites"
echo "    Repo: $REPO_DIR"
echo "    OS:   $OS"
echo "    Mode: $(if $AUTONOMOUS; then echo "autonomous (DANGEROUS=true)"; else echo "interactive"; fi)"
echo ""

# ---- 1. tmux (session persistence) ----
if command -v tmux &>/dev/null; then
  echo "✓ tmux $(tmux -V)"
else
  echo "→ Installing tmux..."
  case "$OS" in
    Darwin) brew install tmux ;;
    Linux)  sudo apt update && sudo apt install tmux -y ;;
    *)      echo "→ Install tmux manually" ;;
  esac
  echo "✓ tmux installed"
fi

# ---- 2. Bun ----
if command -v bun &>/dev/null; then
  echo "✓ bun $(bun --version)"
else
  echo "→ Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo "✓ bun $(bun --version)"
fi

# ---- 3. GitHub CLI ----
if command -v gh &>/dev/null; then
  echo "✓ gh $(gh --version | head -1)"
else
  echo "→ Installing GitHub CLI..."
  case "$OS" in
    Darwin)
      if command -v brew &>/dev/null; then
        brew install gh
      else
        echo "→ Homebrew not found, installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        brew install gh
      fi
      ;;
    Linux)
      (type -p curl >/dev/null || (sudo apt update && sudo apt install curl -y))
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
      sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
      sudo apt update && sudo apt install gh -y
      ;;
    *)
      echo "✗ Unsupported OS: $OS — install gh manually: https://cli.github.com"
      exit 1
      ;;
  esac
  echo "✓ gh installed"
fi

# ---- 4. GitHub auth + git identity ----
if gh auth status &>/dev/null 2>&1; then
  echo "✓ gh authenticated"
else
  echo "→ Authenticating with GitHub..."
  gh auth login
fi

if ! git config --global user.name &>/dev/null; then
  GH_NAME=$(gh api user --jq '.name // .login')
  git config --global user.name "$GH_NAME"
  echo "✓ git user.name = $GH_NAME (from GitHub)"
else
  echo "✓ git user.name = $(git config --global user.name)"
fi

if ! git config --global user.email &>/dev/null; then
  GH_EMAIL=$(gh api user/emails --jq '[.[] | select(.primary)][0].email // empty' 2>/dev/null || true)
  if [[ -n "${GH_EMAIL:-}" ]]; then
    git config --global user.email "$GH_EMAIL"
    echo "✓ git user.email = $GH_EMAIL (from GitHub)"
  else
    echo "✗ Could not fetch email — set manually: git config --global user.email you@example.com"
  fi
else
  echo "✓ git user.email = $(git config --global user.email)"
fi

gh auth setup-git
echo "✓ git credential helper configured"

# ---- 5. Claude CLI ----
if command -v claude &>/dev/null; then
  echo "✓ claude CLI found"
else
  echo "→ Installing Claude CLI..."
  bun install -g @anthropic-ai/claude-code
  echo "✓ claude CLI installed"
fi

# ---- 6. Initialize database ----
echo "→ Initializing database..."
bun src/db.ts
echo "✓ database ready"

# ---- 6.5. Credential store directory ----
echo "→ Setting up credential store directory..."
mkdir -p "$HOME/.aibtc"
echo "✓ ~/.aibtc/ directory ready (credential store location)"

# Inform the operator about ARC_CREDS_PASSWORD without auto-generating it.
if grep -q "^ARC_CREDS_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
  echo "✓ ARC_CREDS_PASSWORD is set in .env (credential store enabled)"
else
  echo "→ ARC_CREDS_PASSWORD not set — add the following to .env to enable the credential store:"
  echo "  ARC_CREDS_PASSWORD=your-secure-password"
  echo "  (arc creds set/get/list commands require this to be set)"
fi

# ---- 7. Symlink arc CLI ----
echo "→ Installing arc CLI..."
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

# Symlink from project bin/arc so updates are automatic
ln -sf "$REPO_DIR/bin/arc" "$LOCAL_BIN/arc"
echo "✓ arc symlinked: $LOCAL_BIN/arc -> $REPO_DIR/bin/arc"

# Ensure ~/.local/bin is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$LOCAL_BIN"; then
  SHELL_RC="$HOME/.bashrc"
  [[ -f "$HOME/.zshrc" ]] && SHELL_RC="$HOME/.zshrc"
  echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_RC"
  export PATH="$LOCAL_BIN:$PATH"
  echo "✓ added $LOCAL_BIN to PATH in $(basename "$SHELL_RC")"
else
  echo "✓ $LOCAL_BIN already on PATH"
fi

# ---- 8. Set timezone to MST (America/Denver) ----
if [[ "$OS" == "Linux" ]] && command -v timedatectl &>/dev/null; then
  CURRENT_TZ=$(timedatectl show --property=Timezone --value 2>/dev/null || echo "unknown")
  if [[ "$CURRENT_TZ" == "America/Denver" ]]; then
    echo "✓ timezone already set to America/Denver (MST)"
  else
    sudo timedatectl set-timezone America/Denver 2>/dev/null && echo "✓ timezone set to America/Denver (MST)" || echo "→ could not set timezone — run: sudo timedatectl set-timezone America/Denver"
  fi
fi

# ---- 9. Enable session persistence ----
if [[ "$OS" == "Linux" ]]; then
  if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$(whoami)" 2>/dev/null && echo "✓ loginctl linger enabled (services survive logout + start at boot)" || echo "→ loginctl enable-linger requires sudo — run: sudo loginctl enable-linger $(whoami)"
  fi
fi

# ---- 10. Autonomous mode (DANGEROUS=true) ----
if $AUTONOMOUS; then
  echo "DANGEROUS=true" > "$ENV_FILE"
  echo "✓ autonomous mode enabled (.env created with DANGEROUS=true)"
  echo ""
  echo "  ┌─────────────────────────────────────────────────────────────┐"
  echo "  │  DANGEROUS=true grants Claude Code full filesystem and     │"
  echo "  │  command access during dispatch. The agent can read, write, │"
  echo "  │  and execute anything your user account can.               │"
  echo "  │                                                            │"
  echo "  │  This is required for autonomous operation.                │"
  echo "  │  To disable: delete .env or remove DANGEROUS=true          │"
  echo "  └─────────────────────────────────────────────────────────────┘"
else
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "# Uncomment to enable autonomous dispatch (grants full permissions to Claude Code)" > "$ENV_FILE"
    echo "# DANGEROUS=true" >> "$ENV_FILE"
    echo "→ autonomous mode not enabled (run with --autonomous to enable)"
    echo "  To enable later: uncomment DANGEROUS=true in .env"
  else
    echo "✓ .env exists (not modified)"
  fi
fi

# ---- 11. SOUL.md ----
if [[ ! -f "$REPO_DIR/SOUL.md" ]]; then
  cp "$REPO_DIR/SOUL.template.md" "$REPO_DIR/SOUL.md"
  echo "✓ created SOUL.md from template (edit this to define your agent's identity)"
else
  echo "✓ SOUL.md exists"
fi

# ---- 12. Verify ----
echo ""
echo "==> Verification"
bun src/cli.ts status

echo ""
echo "==> Prerequisites installed"
echo ""
echo "Next steps:"
echo "  1. Run 'claude' once to authenticate (if first time)"
echo "  2. Edit SOUL.md to define your agent's identity"
echo "  3. arc services install    # enable timers (systemd or launchd)"
