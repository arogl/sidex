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

# The real extension host loads each extension's compiled `main` file. VS Code's source tree has
# extensions/*/src but no compiled output, so a folder filled from it looks populated but nothing in it runs.
# Treat git-base (a built-in with code) as the probe: its `main` must exist on disk.
extensions_are_compiled() {
  [[ -f "$EXTENSIONS_DIR/git-base/package.json" ]] || return 1
  node -e '
    const fs = require("fs"), path = require("path");
    const dir = path.join(process.argv[1], "git-base");
    const main = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).main;
    if (!main) process.exit(1);
    const file = path.join(dir, main);
    process.exit(fs.existsSync(file) || fs.existsSync(file + ".js") ? 0 : 1);
  ' "$EXTENSIONS_DIR"
}

if [[ -d "$EXTENSIONS_DIR" && "$(ls -A "$EXTENSIONS_DIR" 2>/dev/null | wc -l)" -gt 10 ]]; then
  if extensions_are_compiled; then
    echo "extensions/ already populated ($(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') entries) — skipping."
    exit 0
  fi
  echo "extensions/ has no compiled output (it was filled from VS Code's source tree); refilling it."
  rm -rf "${EXTENSIONS_DIR:?}"/* "${EXTENSIONS_DIR:?}"/.[!.]* 2>/dev/null || true
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

echo "No local VSCode installation found."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# VS Code's release archive carries the built-in extensions already compiled, which the real extension host
# needs. Extensions are plain JavaScript, so the Linux archive serves every platform. SIDEX_VSCODE_RELEASE_URL
# overrides the location (a mirror, or a local file:// archive for testing).
RELEASE_URL="${SIDEX_VSCODE_RELEASE_URL:-https://update.code.visualstudio.com/${VSCODE_VERSION}/linux-x64/stable}"
echo "Downloading the VS Code ${VSCODE_VERSION} release (compiled built-in extensions)..."
if curl --fail --silent --show-error -L --progress-bar "$RELEASE_URL" -o "$TMP_DIR/vscode-release.tar.gz"; then
  # Run tar from the download folder with a relative file name: GNU tar in Git Bash reads `C:\...` as host:path.
  if (cd "$TMP_DIR" && tar -xzf vscode-release.tar.gz --strip-components=4 -C "$EXTENSIONS_DIR" "VSCode-linux-x64/resources/app/extensions") \
    && extensions_are_compiled; then
    echo "Done — $(ls "$EXTENSIONS_DIR" | wc -l | tr -d ' ') compiled extensions installed from the release."
    exit 0
  fi
  echo "warning: the release archive did not contain compiled extensions." >&2
else
  echo "warning: could not download the VS Code release from $RELEASE_URL" >&2
fi
echo "warning: falling back to VS Code's source tree. Its extensions are NOT compiled, so extensions with code" >&2
echo "         will not activate in the real extension host. Install VS Code ${VSCODE_VERSION} locally and rerun." >&2
rm -rf "${EXTENSIONS_DIR:?}"/* 2>/dev/null || true

echo "Downloading from GitHub..."

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
