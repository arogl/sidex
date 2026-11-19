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
- [ ] Remember approvals across sessions
- [ ] Tool picker (choose which tools the model is offered)
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
- [ ] Inline references open the file when clicked
- [x] Live todo checklist that stays visible while the agent works
- [~] `progressMessage` status lines ("Searching...") show as one muted line at the end of the running message and clear when the turn ends
- [x] `usage` drives the context ring in the chat input from the prompt size (token and quota text, credits and the per-category breakdown are not shown)
- [ ] `beginToolInvocation` / `updateToolInvocation` (live "running" state for a tool)
- [ ] `confirmation` prompts and `command` buttons
- [ ] `treeData`, `multiDiffData`, `codeCitation`, `task` and `warning` styling
- [ ] `notebookEdit` and `externalEdits`
- [x] File deletes in an agent's patch are performed and reported (permanent: see trash below)
- [ ] Trash or recycle bin support for the desktop file provider, so agent deletes are recoverable
- [~] The error banner is titled "Something went wrong" unless the error is about reaching the model
- [~] Keep and Undo for the files an agent turn changed (each file is copied before the turn first edits it; a row after the turn lists the files with Keep and Undo, per file and for all; a file the user changed since is left alone; kept in memory only, so it is gone after a restart)
- [~] Diff view for the files an agent turn changed (a Diff button on each file in that row opens the saved original beside the file; the file can be edited and single changes reverted in the diff editor; the original is kept in memory, so a diff tab restored after a restart cannot load it)

## Chat input and history

- [ ] Attachments and `#file`, `#selection`, `#codebase` context variables
- [ ] Slash-command and participant completion in the input
- [ ] Follow-up suggestions
- [ ] Vote, copy and retry actions on replies
- [ ] Chat history across restarts
- [ ] Edit and resend an earlier message

## MCP

- [x] stdio servers from the user and workspace `mcp.json`, offered as chat tools with approval
- [x] Desktop MCP client waits long enough for a first `npx` download and for slow tool calls
- [ ] `http` and `sse` servers
- [ ] MCP servers provided by extensions
- [ ] `inputs` variables and OAuth in `mcp.json`
- [ ] Server stderr shown (it is discarded today)
- [ ] Paginated `tools/list`; non-text tool results (images, resources)
- [ ] MCP management view (the Settings > Plugins list passes `name` where the desktop commands expect `serverName`)
- [ ] Workspace servers are not left behind in `mcp-servers.json` after the workspace closes

## Build and platform

- [ ] Ship the ripgrep binaries in the release build
- [x] Copilot models on WSL: sign-in opens the Windows browser (needs `wslu` installed in the distro), the model list fills in and Auto can be chosen
- [ ] URL scheme for the vscode.dev redirect page
- [x] External URI openers (`MainThreadUriOpeners` now gets its service and links still open in the browser; an opener must claim a link as Default or Preferred, there is no picker; an extension that claims a link has not been tried)
- [x] Comments (`MainThreadComments` now gets a headless `commentService` and its console errors are gone: controllers register, threads and ranges are accepted and dropped, there is no comments UI)
- [x] Browsers (`MainThreadBrowsers` now gets a `browserViewCDPService` and its console errors are gone: tabs list is empty and CDP sessions are refused with an error, there is no integrated browser)
- [x] Link presentation providers (`MainThreadDataChannels` has `$registerLinkPresentationProvider` and the watcher calls, ported from VS Code 1.144, and the console error is gone; only the real extension host uses them, the other host fails loudly if asked for a watcher; whether Copilot's rich links render has not been checked)
- [~] Markdown preview reopening at start (it came back after the tab was closed by hand, because only the toggle command removed the file from the saved list; closing the tab now does too, and a shutdown still keeps it)
- [~] Webviews rendering blank (Markdown preview, extension details): the served `webview-pre` files were from an older VS Code than the webview host, so the service worker reported version 4 against the expected 6 and the handshake lacked `keyEventToken` and `mountId`; synced to 1.144, keeping the SideX CSP, sandbox, protocol and Tauri-origin changes
- [~] Recently Opened remembering files as well as folders (File > Open File went through the Tauri dialog without recording the file; it now does, and the menu already listed files)
- [ ] Clippy errors in the native crate tests
