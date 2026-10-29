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

# Only places that hold VS Code's own built-in extensions. ~/.vscode/extensions
# is not one: it holds the extensions a user installed from the marketplace, and
# the app deliberately never loads other editors' user extensions (see
# extension_search_paths in apps/desktop/src/commands/extension_platform.rs).
VSCODE_CANDIDATES=(
  "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions"
  "/Applications/Cursor.app/Contents/Resources/app/extensions"
  "/usr/share/code/resources/app/extensions"
  "/usr/lib/code/extensions"
  "/opt/visual-studio-code/resources/app/extensions"
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

# VS Code names the tag of a minor's first release inconsistently: 1.110 has the
# tag "1.110" (there is no "1.110.0"), while 1.115.0 has "1.115.0". Try the exact
# version, then the version without a trailing ".0".
TAGS=("$VSCODE_VERSION")
if [[ "$VSCODE_VERSION" == *.0 ]]; then
  TAGS+=("${VSCODE_VERSION%.0}")
fi

TAG=""
for candidate in "${TAGS[@]}"; do
  echo "Downloading VS Code tag '${candidate}'..."
  # --fail makes an HTTP error (a tag that does not exist) stop the download;
  # without it curl saves the error page and tar later fails with "not in gzip format".
  if curl --fail --silent --show-error -L --progress-bar \
    "https://github.com/microsoft/vscode/archive/refs/tags/${candidate}.tar.gz" \
    -o "$TMP_DIR/vscode.tar.gz" 2>/dev/null; then
    TAG="$candidate"
    break
  fi
  echo "Could not download tag '${candidate}'." >&2
done

if [[ -z "$TAG" ]]; then
  echo "error: could not download VS Code ${VSCODE_VERSION} from github.com/microsoft/vscode (tried tags: ${TAGS[*]})" >&2
  echo "       check .vscode-version, and list real tags with: git ls-remote --tags https://github.com/microsoft/vscode" >&2
  exit 1
fi
echo "Downloaded VS Code tag ${TAG}."

echo "Extracting extensions..."
tar -xzf "$TMP_DIR/vscode.tar.gz" -C "$TMP_DIR" "vscode-${TAG}/extensions"
cp -r "$TMP_DIR/vscode-${TAG}/extensions/." "$EXTENSIONS_DIR/"

echo "Done — $(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') extensions installed."
