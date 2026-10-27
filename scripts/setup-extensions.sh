#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The VS Code version SideX targets lives in one place, .vscode-version.
VSCODE_VERSION="$(tr -d '[:space:]' < "$REPO_ROOT/.vscode-version")"
if [[ ! "$VSCODE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: .vscode-version must contain one version like 1.110.0, got '$VSCODE_VERSION'" >&2
  exit 1
fi
EXTENSIONS_DIR="$REPO_ROOT/extensions"

if [[ -d "$EXTENSIONS_DIR" && "$(ls -A "$EXTENSIONS_DIR" 2>/dev/null | wc -l)" -gt 10 ]]; then
  echo "extensions/ already populated ($(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') entries) — skipping."
  exit 0
fi

mkdir -p "$EXTENSIONS_DIR"

VSCODE_CANDIDATES=(
  "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions"
  "/Applications/Cursor.app/Contents/Resources/app/extensions"
  "/usr/share/code/resources/app/extensions"
  "/usr/lib/code/extensions"
  "/opt/visual-studio-code/resources/app/extensions"
  "$HOME/.vscode/extensions"
)

for candidate in "${VSCODE_CANDIDATES[@]}"; do
  if [[ -d "$candidate" && "$(ls -A "$candidate" 2>/dev/null | wc -l)" -gt 10 ]]; then
    echo "Found VSCode extensions at: $candidate"
    echo "Copying built-in extensions..."
    cp -r "$candidate"/. "$EXTENSIONS_DIR/"
    echo "Copied $(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') extensions."
    exit 0
  fi
done

echo "No local VSCode installation found. Downloading from GitHub..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARCHIVE_URL="https://github.com/microsoft/vscode/archive/refs/tags/${VSCODE_VERSION}.tar.gz"
# --fail makes an HTTP error (for example a tag that does not exist) stop here;
# without it curl saves the error page and tar later fails with "not in gzip format".
if ! curl --fail -L --progress-bar "$ARCHIVE_URL" -o "$TMP_DIR/vscode.tar.gz"; then
  echo "error: could not download $ARCHIVE_URL" >&2
  echo "       check that .vscode-version ($VSCODE_VERSION) is a tag that exists in microsoft/vscode" >&2
  exit 1
fi

echo "Extracting extensions..."
tar -xzf "$TMP_DIR/vscode.tar.gz" -C "$TMP_DIR" "vscode-${VSCODE_VERSION}/extensions"
cp -r "$TMP_DIR/vscode-${VSCODE_VERSION}/extensions/." "$EXTENSIONS_DIR/"

echo "Done — $(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') extensions installed."
