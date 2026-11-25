# Chat and MCP feature list

Goal: Copilot Chat and MCP work in SideX the way they do in VS Code. SideX-native actors drive the existing
`sidexChat` view for now; a faithful port of VS Code's chat layer can replace them later.

Each feature gets its own branch and pull request. A feature is crossed off only after the maintainer has tried
it in the app and confirmed it.

Legend:

- `[ ]` not started
- `[~]` merged, not yet confirmed in the app
- `[x]` confirmed in the app

## Copilot participant

- [x] Real extension host runs Copilot Chat, with real `file:` storage folders
- [x] Agent mode picks Copilot's agent participant (`chat.agent.enabled` setting registered)
- [x] A message sent before Copilot has registered waits for it
- [x] Copilot's customization queries (agents, instructions, skills, hooks, plugins) answer with empty lists
- [ ] Prompt file provider registration (`$registerPromptFileProvider` still rejects)
- [ ] Copilot CLI and cloud-agent sessions (the CLI native addon is missing)
- [x] The "Unable to reach model" banner for a missing local server appears only when a message cannot be answered (Copilot answers without it)

## Tools

- [x] Allow/Deny confirmation before a tool runs
- [x] "Don't ask again in this session" for a tool (approvals last for one session only)
- [x] `run_in_terminal`
- [x] `run_in_terminal` runs in the default terminal profile's shell (Git Bash, PowerShell, cmd) and tells the model which one
- [x] The default terminal profile setting lists the detected shells (Git Bash, PowerShell, Command Prompt), so one can be chosen
- [x] `manage_todo_list` is offered and called (the model often only reads the list)
- [x] The model writes a todo list instead of only reading it (an empty read says how to create one; confirmed in one four-step run, model behaviour can vary)
- [x] Remember approvals across sessions (the tool prompt has an "Always allow" button next to Allow, kept for the same scope as the session box: the tool, or a shell program and subcommand such as `git log`; stored at application level; `SideX: Reset Remembered Tool Approvals` forgets them all; there is no list to review or remove single entries yet)
- [x] Tool picker (`SideX: Configure Tools`, or the tools button in the chat input, turns tools off by source; the set that is off is stored at application level so new tools are on; Agent mode only; no per-workspace selection or tool sets)
- [x] Terminal output and kill tools (`run_in_terminal` `mode: "async"`, `get_terminal_output`, `kill_terminal`)
- [ ] Task tools
- [ ] Subagent tool
- [ ] Other missing VS Code built-in tools

## What the chat shows

- [x] Tool calls appear as rows with readable labels (command, file, search, todo)
- [x] Tool calls made after the first appear in the chat while the turn is still streaming, not only the ones that existed when the message was first drawn
- [x] A todo list the model writes shows as a checklist (done, in progress, not started) with a done/total count
- [x] Streamed reply text updates in place and starts a new paragraph after a tool call
- [x] `inlineReference` shown as the file or symbol name in code style
- [x] `thinking` content shown in the thinking block
- [x] `autoModeResolution` (which model Auto picked) no longer raises a notice
- [x] File edits from Copilot's edit tools are applied and saved (including new files)
- [~] Inline references open the file when clicked (structured references and `[label](file link)` links in a reply open the file at the line; Copilot's own replies write plain text, so plain file names are not linked)
- [x] Live todo checklist that stays visible while the agent works
- [~] `progressMessage` status lines ("Searching...") show as one muted line at the end of the running message and clear when the turn ends
- [x] `usage` drives the context ring in the chat input from the prompt size (token and quota text, credits and the per-category breakdown are not shown)
- [ ] `beginToolInvocation` / `updateToolInvocation` (live "running" state for a tool)
- [ ] `confirmation` prompts and `command` buttons
- [ ] `treeData`, `multiDiffData`, `codeCitation`, `task` and `warning` styling
- [ ] `notebookEdit` and `externalEdits`
- [x] File deletes in an agent's patch are performed and reported (permanent: see trash below)
- [~] Trash or recycle bin support for the desktop file provider, so agent deletes are recoverable (the provider declares the Trash capability and a `move_to_trash` command uses the OS trash; Explorer "Move to Trash", workspace edits and the extension API `useTrash` go through it; `files.enableTrash` turns it off; if the trash cannot take a file the Explorer offers Delete Permanently; shell `rm` run by an agent is not covered)
- [~] The error banner is titled "Something went wrong" unless the error is about reaching the model
- [~] Keep and Undo for the files an agent turn changed (each file is copied before the turn first edits it; a row after the turn lists the files with Keep and Undo, per file and for all; a file the user changed since is left alone; kept in memory only, so it is gone after a restart)
- [~] Diff view for the files an agent turn changed (a Diff button on each file in that row opens the saved original beside the file; the file can be edited and single changes reverted in the diff editor; the original is kept in memory, so a diff tab restored after a restart cannot load it)

## Chat input and history

- [x] Attachments and `#file`, `#selection`, `#codebase` context variables (typing `#` lists them; files and selections reach Copilot as request variables and `#codebase` as the `codebase` tool reference, the built-in agent gets the text; the `@` popup now finds files too; folders are only offered through `@`)
- [x] Slash-command completion in the input (`/` lists the answering participant's commands and `/orchestrate`; `@name /` lists that participant's; a bare `/explain` is routed to the default participant when it answers; `@name:` is accepted)
- [x] Participant (`@name`) completion in the input (`@` at the start of a message lists the chat participants with descriptions, the default one as `copilot`; picking one inserts the name and opens its `/` commands; later `@` still lists files only)
- [ ] Follow-up suggestions
- [x] Copy, retry and vote actions on replies (a bar on hover; retry is for the newest reply and rolls back its file changes; votes show as a filled thumb and are kept for the session only, nothing is sent)
- [x] Chat history across restarts (chats are saved to the local database per workspace; after a restart the chat starts fresh and earlier chats are in the history search, in full)
- [x] Edit and resend an earlier message (a pencil under a user message turns it into a text box; Resend drops it and what followed, rolls back the file changes since, and sends the new text; attached files and selections are sent again with it)

## MCP

- [x] stdio servers from the user and workspace `mcp.json`, offered as chat tools with approval
- [x] Desktop MCP client waits long enough for a first `npx` download and for slow tool calls
- [~] `http` and `sse` servers (`type: "http"` is Streamable HTTP, `type: "sse"` the older HTTP+SSE transport; a server with only a `url` is `http`, and one that rejects the first POST falls back to `sse`; `headers` are sent on every request; credentials go in `headers` since OAuth is not done; `${input:...}` entries are skipped with a message)
- [ ] MCP servers provided by extensions
- [ ] `inputs` variables and OAuth in `mcp.json`
- [x] Server stderr shown (an output button on stdio servers in Settings > Plugins; a server that failed to start keeps what it printed; failed tool calls include it)
- [x] Paginated `tools/list` (follows `nextCursor`, at most 100 pages)
- [x] Embedded resources and resource links in MCP tool results reach the model
- [x] Images in MCP tool results reach the model and show in the tool call's row, in the order the tool gave them (png, jpeg, gif and webp, up to four of at most 5 MB; SVG, audio and other binary parts show a placeholder)
- [x] MCP management view (Settings > Plugins: add, connect, disconnect and remove servers; a failed add is reported in the form, not on the server that has the name)
- [x] Workspace servers are removed from `mcp-servers.json` once the workspace no longer asks for them, also after a restart (servers added in the view or in the user `mcp.json` are kept)

## Build and platform

- [~] Ship the ripgrep binaries in the release build (`release.yml` builds `real-host.cjs` and stages `@vscode/ripgrep-universal` for the target platform; not yet confirmed from an installed release)
- [~] Ship the built-in agent server in the release build (`release.yml` builds `sidex-server` with Go on each runner and Tauri bundles it under `server/`; no Windows arm64 build; not yet confirmed from an installed release)
- [~] Go lint, format and tests for `sidexai/sidex-server` run in CI (`lint-go.yml`; not yet a required check)
- [~] Ship a Node runtime with the app (`release.yml` stages the Node release in `scripts/ext-host/node-version.txt`, sha256-checked, and Tauri bundles it under `node/`; `resolve_node_runtime` prefers it over `PATH`; `bun run build:node` confirmed on Windows, an installed release not yet). The host's optional native packages (`@vscode/windows-process-tree`, `@vscode/sqlite3`, `node-pty`, `@parcel/watcher`, `@vscode/spdlog`) are not installed in a dev checkout either, and the host runs without them, so they are not shipped
- [x] Copilot models on WSL: sign-in opens the Windows browser (needs `wslu` installed in the distro), the model list fills in and Auto can be chosen
- [ ] URL scheme for the vscode.dev redirect page
- [x] External URI openers (`MainThreadUriOpeners` now gets its service and links still open in the browser; an opener must claim a link as Default or Preferred, there is no picker; an extension that claims a link has not been tried)
- [x] Comments (`MainThreadComments` now gets a headless `commentService` and its console errors are gone: controllers register, threads and ranges are accepted and dropped, there is no comments UI)
- [x] Browsers (`MainThreadBrowsers` now gets a `browserViewCDPService` and its console errors are gone: tabs list is empty and CDP sessions are refused with an error, there is no integrated browser)
- [x] Link presentation providers (`MainThreadDataChannels` has `$registerLinkPresentationProvider` and the watcher calls, ported from VS Code 1.144, and the console error is gone; only the real extension host uses them, the other host fails loudly if asked for a watcher; whether Copilot's rich links render has not been checked)
- [x] Markdown preview reopening at start (it came back after the tab was closed by hand, because only the toggle command removed the file from the saved list; closing the tab now does too, and a shutdown still keeps it)
- [x] Webviews rendering blank (Markdown preview, extension details): the served `webview-pre` files were from an older VS Code than the webview host, so the service worker reported version 4 against the expected 6 and the handshake lacked `keyEventToken` and `mountId`; synced to 1.144, keeping the SideX CSP, sandbox, protocol and Tauri-origin changes
- [x] Recently Opened remembering files as well as folders (File > Open File went through the Tauri dialog without recording the file; it now does, and the menu already listed files)
- [~] Clippy errors in the native crate tests (fixed in 27 files under `crates/`; CI still lints test targets for the `sidex` crate only)
