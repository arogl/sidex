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
- [x] `manage_todo_list` is offered and called (the model often only reads the list)
- [ ] Remember approvals across sessions
- [ ] Tool picker (choose which tools the model is offered)
- [ ] Terminal output and kill tools
- [ ] Task tools
- [ ] Subagent tool
- [ ] Other missing VS Code built-in tools

## What the chat shows

- [x] Tool calls appear as rows with readable labels (command, file, search, todo)
- [x] Streamed reply text updates in place and starts a new paragraph after a tool call
- [x] `inlineReference` shown as the file or symbol name in code style
- [x] `thinking` content shown in the thinking block
- [x] `autoModeResolution` (which model Auto picked) no longer raises a notice
- [x] File edits from Copilot's edit tools are applied and saved (including new files)
- [ ] Inline references open the file when clicked
- [ ] Live todo checklist that stays visible while the agent works
- [ ] `progressMessage` status lines ("Searching...")
- [ ] `usage` (token and quota display)
- [ ] `beginToolInvocation` / `updateToolInvocation` (live "running" state for a tool)
- [ ] `confirmation` prompts and `command` buttons
- [ ] `treeData`, `multiDiffData`, `codeCitation`, `task` and `warning` styling
- [ ] `notebookEdit` and `externalEdits`
- [~] File deletes in an agent's patch are performed and reported (permanent: see trash below)
- [ ] Trash or recycle bin support for the desktop file provider, so agent deletes are recoverable
- [~] The error banner is titled "Something went wrong" unless the error is about reaching the model
- [ ] Diff view and accept/reject for agent edits, with checkpoints and undo

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
- [ ] Copilot models on WSL (storage fix merged; needs a WSL test and sign-in)
- [ ] URL scheme for the vscode.dev redirect page
- [ ] Remaining dependency-injection failures (UriOpeners, Comments, Browsers)
- [ ] Clippy errors in the native crate tests
