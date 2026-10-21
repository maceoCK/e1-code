#!/bin/bash
# Install the prebuilt E1 Code.app from this private repository's releases.
#
# One command on another Apple silicon Mac (needs the GitHub CLI, logged in):
#   gh api repos/maceoCK/e1-code/contents/scripts/install-prebuilt.sh -H 'Accept: application/vnd.github.raw' | bash
#
# Options (after `bash -s --` when piped):
#   --tag <release>   install a specific app release (default: the newest app-* release)
#   --dir <folder>    install somewhere other than ~/Applications
#   --no-open         don't launch the app afterwards
# The previous copy, if any, is kept next to the new one. The app is never quit for you.
set -euo pipefail
repo="maceoCK/e1-code"; tag=""; dir="$HOME/Applications"; open_app=1
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) tag="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --no-open) open_app=0; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
fail() { echo "E1 install: $*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail "needs an Apple silicon Mac."
command -v gh >/dev/null || fail "install the GitHub CLI first (brew install gh), then run: gh auth login"
gh auth status >/dev/null 2>&1 || fail "log in to GitHub first: gh auth login"
if [ -z "$tag" ]; then
  tag="$(gh release list --repo "$repo" --limit 50 --json tagName,createdAt --jq '[.[] | select(.tagName | startswith("app-"))] | sort_by(.createdAt) | last | .tagName // empty')"
  [ -n "$tag" ] || fail "no prebuilt app release found in $repo."
fi
app="$dir/E1 Code.app"
if [ -d "$app" ] && pgrep -f "^$app/Contents/MacOS/E1 Code" >/dev/null; then fail "quit E1 Code first (it is running from $app)."; fi

work="$(mktemp -d "${TMPDIR:-/tmp}/e1-install.XXXXXX")"; trap 'rm -rf "$work"' EXIT
echo "Downloading E1 Code ($tag) from $repo…"
gh release download "$tag" --repo "$repo" --pattern 'E1-Code-*-darwin-arm64.zip' --pattern 'E1-Code-*-darwin-arm64.zip.sha256' --dir "$work"
zip="$(ls "$work"/E1-Code-*-darwin-arm64.zip)"
expected="$(awk '{print $1}' "$zip.sha256")"
actual="$(shasum -a 256 "$zip" | awk '{print $1}')"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $(basename "$zip")."
echo "Checksum verified. Unpacking…"
mkdir "$work/unpacked"
ditto -x -k "$zip" "$work/unpacked"
new="$work/unpacked/E1 Code.app"
[ -d "$new" ] || fail "the release archive does not contain E1 Code.app."
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$new/Contents/Info.plist")" = local.aster.desktop ] || fail "unexpected app in the release."
codesign --verify --deep --strict "$new" || fail "the app's code signature does not verify."
xattr -dr com.apple.quarantine "$new" 2>/dev/null || true

mkdir -p "$dir"
if [ -d "$app" ]; then
  previous="$dir/E1 Code (previous $(date +%Y%m%d-%H%M%S)).app"
  mv "$app" "$previous"
  echo "Kept your previous copy as: $previous"
fi
mv "$new" "$app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
echo "Installed E1 Code (Claude Desktop $version base, release $tag) at: $app"
cat <<'NEXT'
First launch downloads its Claude Code engine (~200 MB) and may ask once to allow
"E1 Code Safe Storage" in the Keychain; choose Always Allow.
Sign in under Settings → Accounts and add API keys under Models & connections.
Claude subscription sign-in uses the `claude` CLI and Codex sign-in uses the ChatGPT
app's bundled `codex`; install those on this Mac if you use them.
NEXT
if [ "$open_app" = 1 ]; then open "$app"; fi
