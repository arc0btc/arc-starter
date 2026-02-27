# Setup Observations

*Notes captured during fresh VM bootstrap of arc-starter v2. These become issues for the upstream repo.*

---

## SOUL.md had merge conflicts on clone

**Severity:** Medium — manual fix needed on first boot
**Branch:** v2
**Details:** SOUL.md contained `<<<<<<<` / `>>>>>>>` markers. Caused by pushing a personalized SOUL.md over the template version. Resolved manually during setup — kept identity content, moved operational details to MEMORY.md.

**Recommendation:** The starter should ship `SOUL.template.md` as the default. Agents should be encouraged to write a meaningful, permanent SOUL.md early — identity matters. A setup step or first-boot task could prompt for this.

---

## Bun not pre-installed on VM

**Severity:** Expected — but worth noting for setup docs
**Details:** Fresh Ubuntu VM has no Bun. The README should document this as step 1 or the install script should handle it.

## Bun installer fails: `unzip` not installed

**Severity:** High — blocks entire setup
**Details:** `curl -fsSL https://bun.sh/install | bash` requires `unzip` which isn't present on a minimal Ubuntu VM. The install script should `sudo apt install unzip -y` before attempting Bun install. tmux was already present (pre-installed or part of base image).

**Recommendation:** Add `unzip` to the Bun install block:
```bash
# Before Bun install on Linux
sudo apt install unzip -y
```

## Install script runs twice on failure

**Severity:** Low — cosmetic but confusing
**Details:** When the Bun install fails, the script output appears duplicated (the header prints twice). This is likely `set -e` causing the script to exit and get re-sourced, or the Bun installer's error output includes a retry. Worth investigating.

## git user.email set to a JSON error string

**Severity:** High — git commits will have a broken email
**Details:** The gh API call to fetch the user's primary email returned a 404:
```
{"message":"Not Found","documentation_url":"...","status":"404"}
```
The script stored this JSON blob as `git user.email` instead of failing gracefully. This happens when the GitHub account has no public email or the token lacks the `user:email` scope.

**Recommendation:** The script already has a fallback (`// empty` + `|| true`), but it doesn't validate that the result looks like an email before setting it. Add a check:
```bash
if [[ "$GH_EMAIL" == *"@"* ]]; then
  git config --global user.email "$GH_EMAIL"
else
  echo "→ Could not fetch email — set manually"
fi
```

## Passwordless sudo works on this VM

**Severity:** N/A — operational note
**Details:** `sudo -n` works without a password prompt. Important for the install script and service management. Worth documenting as an expectation for agent VMs.

## gh auth stores credentials in plain text

**Severity:** Low — expected for server/VM use
**Details:** `gh auth login` warns "Authentication credentials saved in plain text." This is standard for non-interactive server environments but worth noting. The credential store (`arc creds`) uses encryption; gh does not.

## gh auth default scopes missing SSH key management

**Severity:** Medium — blocks SSH key setup
**Details:** Default `gh auth login` doesn't include `admin:public_key` or `admin:ssh_signing_key` scopes. Adding SSH keys via `gh ssh-key add` fails with 404 until you run `gh auth refresh` with the needed scopes. The install script should either request these scopes upfront or document the manual step.

**Recommendation:** Add to the gh auth step:
```bash
gh auth login -s admin:public_key,admin:ssh_signing_key
```

## Install script should configure SSH key + commit signing

**Severity:** Medium — important for verified commits
**Details:** The script sets up gh auth (HTTPS credential helper) but doesn't generate an SSH key, add it to GitHub, or configure commit signing. For an autonomous agent that commits its own work, signed commits should be part of the foundation.

**Recommendation:** Add a step after gh auth that:
1. Generates ed25519 key if none exists
2. Adds to GitHub for auth + signing (requires expanded scopes)
3. Configures `gpg.format=ssh`, `commit.gpgsign=true`, `tag.gpgsign=true`
4. Switches remote to SSH URL

## Install script should switch remote to SSH after key setup

**Severity:** Low — functional improvement
**Details:** The repo clones via HTTPS. After SSH key is set up, the remote should be switched to `git@github.com:...` to use the SSH key for push/pull instead of the gh credential helper.

## bin/arc symlink resolution broken

**Severity:** High — `arc` CLI doesn't work when invoked via symlink
**Details:** The wrapper script used `BASH_SOURCE[0]` to find the repo root, but when invoked via symlink (`~/.local/bin/arc` → `/home/dev/arc-starter/bin/arc`), `BASH_SOURCE[0]` resolves to the symlink location (`~/.local/bin/`), not the target. This made `REPO_DIR` resolve to `~/.local/` instead of the repo.

**Fix applied:** Added a `readlink` loop to follow symlinks before resolving `SCRIPT_DIR`:
```bash
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
```
This is a standard bash pattern for portable symlink resolution.

---

## arc CLI not linked on fresh clone

**Severity:** Low — expected for fresh setup
**Details:** `bin/arc` exists but `~/.local/bin/arc` symlink hasn't been created. The install script or README should cover this. `arc services install` may handle it, but can't run without Bun first.

---

## .env not created from .env.example

**Severity:** Low — expected for fresh setup
**Details:** No `.env` file exists. Bun auto-loads `.env` so credentials won't work until this is created with `ARC_CREDS_PASSWORD` set.

---
