use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use super::mcp_remote::{HttpTransport, SseTransport};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
/// `initialize` and `tools/list` wait on the server starting up, which includes a first-run package download
/// for servers launched with `npx` or `uvx`.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
/// A tool call can legitimately run for a while (a build, a query, a page load).
const TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// Lines of a server's stderr kept to explain a failed start.
const STDERR_LINES: usize = 20;
/// A stderr line longer than this is cut, so a noisy server cannot fill an error message.
const STDERR_LINE_CHARS: usize = 300;

/// Adds a stderr line to the tail, dropping the oldest once the tail is full.
fn push_stderr_line(tail: &mut VecDeque<String>, line: &str) {
    let line = line.trim_end();
    if line.is_empty() {
        return;
    }
    if tail.len() == STDERR_LINES {
        tail.pop_front();
    }
    tail.push_back(line.chars().take(STDERR_LINE_CHARS).collect());
}

/// The error with whatever the server printed to stderr appended, so a timeout or an early exit says why.
fn with_server_output(error: String, tail: &VecDeque<String>) -> String {
    if tail.is_empty() {
        return error;
    }
    let lines: Vec<&str> = tail.iter().map(String::as_str).collect();
    format!("{error}{OUTPUT_MARKER}{}", lines.join("\n"))
}

const OUTPUT_MARKER: &str = "\nServer output:\n";

/// The server output that `with_server_output` put at the end of an error, so a server that failed to start
/// can still show it after the connection (and its stderr buffer) is gone.
fn output_in_error(error: &str) -> Vec<String> {
    error
        .split_once(OUTPUT_MARKER)
        .map(|(_, output)| output.lines().map(String::from).collect())
        .unwrap_or_default()
}

/// A failed request with the server's output appended when that output likely explains it: the process has
/// exited, or the request timed out or the pipe closed. An error the server answered with on purpose is left as it is.
fn failure_context(error: String, alive: bool, tail: &VecDeque<String>) -> String {
    let silent_failure = error.contains("Timeout") || error.contains("closed connection");
    if alive && !silent_failure {
        return error;
    }
    with_server_output(error, tail)
}

/// How long to wait for the response to a request, by method.
fn response_timeout(method: &str) -> Duration {
    match method {
        "initialize" | "tools/list" => STARTUP_TIMEOUT,
        "tools/call" => TOOL_CALL_TIMEOUT,
        _ => DEFAULT_TIMEOUT,
    }
}
const CONFIG_FILENAME: &str = "mcp-servers.json";

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub name: String,
    /// stdio servers only.
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// `stdio`, `http` (Streamable HTTP) or `sse` (the older HTTP+SSE transport).
    #[serde(default = "default_transport")]
    pub transport: String,
    /// http and sse servers only.
    pub url: Option<String>,
    /// Sent with every request to an http or sse server, for credentials such as `Authorization`.
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

fn default_transport() -> String {
    "stdio".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub server: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpContent {
    pub r#type: String,
    pub text: Option<String>,
    pub data: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub name: String,
    pub transport: String,
    pub connected: bool,
    pub tool_count: usize,
}

// ─── JSON-RPC Types ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct JsonRpcRequest {
    jsonrpc: &'static str,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse {
    #[allow(dead_code)]
    jsonrpc: String,
    #[allow(dead_code)]
    id: Option<u64>,
    result: Option<serde_json::Value>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
    #[allow(dead_code)]
    data: Option<serde_json::Value>,
}

// ─── Connection ──────────────────────────────────────────────────────────────

/// The pipes of a server process the client started itself.
struct StdioIo {
    child: Child,
    stdin: tokio::process::ChildStdin,
    reader: Arc<Mutex<BufReader<tokio::process::ChildStdout>>>,
    stderr_tail: Arc<std::sync::Mutex<VecDeque<String>>>,
}

enum Transport {
    Stdio(StdioIo),
    Http(HttpTransport),
    Sse(SseTransport),
}

/// What `initialize` offers. Servers answer with the newest version they support up to this, so servers that
/// only know the older HTTP+SSE protocol still agree on one.
fn protocol_version(transport: &str) -> &'static str {
    if transport == "http" {
        "2025-06-18"
    } else {
        "2024-11-05"
    }
}

struct McpConnection {
    transport: Transport,
    next_id: u64,
    tools: Vec<McpTool>,
    config: McpServerConfig,
}

impl StdioIo {
    async fn spawn(config: &McpServerConfig) -> Result<Self, String> {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args)
            .envs(&config.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn MCP server '{}' (command: '{}'): {}",
                config.name, config.command, e
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("Failed to capture stdin for '{}'", config.name))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("Failed to capture stdout for '{}'", config.name))?;

        let reader = Arc::new(Mutex::new(BufReader::new(stdout)));

        // Keep the end of stderr: it is where servers say why they cannot start (a missing package, a bad path).
        let stderr_tail = Arc::new(std::sync::Mutex::new(VecDeque::new()));
        if let Some(stderr) = child.stderr.take() {
            let tail = Arc::clone(&stderr_tail);
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Ok(mut guard) = tail.lock() {
                        push_stderr_line(&mut guard, &line);
                    }
                }
            });
        }

        Ok(Self {
            child,
            stdin,
            reader,
            stderr_tail,
        })
    }

    async fn write_line(&mut self, name: &str, what: &str, line: &str) -> Result<(), String> {
        let mut msg = String::from(line);
        msg.push('\n');

        timeout(DEFAULT_TIMEOUT, self.stdin.write_all(msg.as_bytes()))
            .await
            .map_err(|_| format!("Timeout writing {what} to MCP server '{name}'"))?
            .map_err(|e| format!("Failed to write {what} to MCP server '{name}': {e}"))?;

        timeout(DEFAULT_TIMEOUT, self.stdin.flush())
            .await
            .map_err(|_| format!("Timeout flushing {what} to MCP server '{name}'"))?
            .map_err(|e| format!("Failed to flush {what} to MCP server '{name}': {e}"))
    }

    async fn read_response(
        &mut self,
        name: &str,
        expected_id: u64,
        wait: Duration,
    ) -> Result<JsonRpcResponse, String> {
        let reader = Arc::clone(&self.reader);
        let server_name = name.to_string();

        let result = timeout(wait, async {
            let mut reader_guard = reader.lock().await;
            let mut line = String::new();

            loop {
                line.clear();
                let bytes_read = reader_guard
                    .read_line(&mut line)
                    .await
                    .map_err(|e| format!("Failed to read from MCP server '{server_name}': {e}"))?;

                if bytes_read == 0 {
                    return Err(format!(
                        "MCP server '{server_name}' closed connection unexpectedly"
                    ));
                }

                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let parsed: JsonRpcResponse = match serde_json::from_str(trimmed) {
                    Ok(r) => r,
                    Err(_) => continue, // Skip notifications and malformed lines
                };

                if parsed.id == Some(expected_id) {
                    return Ok(parsed);
                }
            }
        })
        .await
        .map_err(|_| format!("Timeout waiting for response from MCP server '{server_name}'"))?;

        result
    }

    fn stderr_snapshot(&self) -> VecDeque<String> {
        self.stderr_tail
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }
}

impl McpConnection {
    async fn spawn(config: &McpServerConfig) -> Result<Self, String> {
        match config.transport.as_str() {
            "stdio" => Self::spawn_stdio(config).await,
            "http" => Self::spawn_http(config).await,
            "sse" => Self::spawn_sse(config).await,
            other => Err(format!(
                "Transport '{other}' is not supported; use 'stdio', 'http' or 'sse'"
            )),
        }
    }

    fn with_transport(config: &McpServerConfig, transport: Transport) -> Self {
        Self {
            transport,
            next_id: 1,
            tools: Vec::new(),
            config: config.clone(),
        }
    }

    fn remote_url(config: &McpServerConfig) -> Result<&str, String> {
        config
            .url
            .as_deref()
            .filter(|url| !url.trim().is_empty())
            .ok_or_else(|| format!("MCP server '{}' has no url", config.name))
    }

    async fn spawn_stdio(config: &McpServerConfig) -> Result<Self, String> {
        let io = StdioIo::spawn(config).await?;
        let mut conn = Self::with_transport(config, Transport::Stdio(io));

        if let Err(error) = conn.start().await {
            // Give the server a moment to print its reason before the tail is read.
            tokio::time::sleep(Duration::from_millis(200)).await;
            let tail = match &conn.transport {
                Transport::Stdio(io) => io.stderr_snapshot(),
                _ => VecDeque::new(),
            };
            return Err(with_server_output(error, &tail));
        }

        Ok(conn)
    }

    async fn spawn_http(config: &McpServerConfig) -> Result<Self, String> {
        let transport =
            HttpTransport::new(&config.name, Self::remote_url(config)?, &config.headers)?;
        let mut conn = Self::with_transport(config, Transport::Http(transport));
        let Err(error) = conn.start().await else {
            return Ok(conn);
        };
        // A server that only speaks the older protocol turns the first POST away; try that one before giving up.
        let rejected = matches!(
            &conn.transport,
            Transport::Http(h) if matches!(h.rejected_status, Some(400 | 404 | 405))
        );
        if rejected {
            if let Ok(legacy) = Self::spawn_sse(config).await {
                return Ok(legacy);
            }
        }
        Err(error)
    }

    async fn spawn_sse(config: &McpServerConfig) -> Result<Self, String> {
        let transport = SseTransport::connect(
            &config.name,
            Self::remote_url(config)?,
            &config.headers,
            STARTUP_TIMEOUT,
        )
        .await?;
        let mut conn = Self::with_transport(config, Transport::Sse(transport));
        conn.start().await?;
        Ok(conn)
    }

    async fn start(&mut self) -> Result<(), String> {
        self.initialize().await?;
        self.discover_tools().await
    }

    async fn initialize(&mut self) -> Result<(), String> {
        let params = serde_json::json!({
            "protocolVersion": protocol_version(&self.config.transport),
            "capabilities": {
                "roots": { "listChanged": true },
                "sampling": {}
            },
            "clientInfo": {
                "name": "sidex",
                "version": env!("CARGO_PKG_VERSION")
            }
        });

        let response = self.send_request("initialize", Some(params)).await?;

        let Some(result) = response else {
            return Err(format!(
                "MCP server '{}' returned empty initialize response",
                self.config.name
            ));
        };

        // From here on, an http server expects to be told which protocol version was agreed.
        if let (Transport::Http(http), Some(version)) = (
            &mut self.transport,
            result.get("protocolVersion").and_then(|v| v.as_str()),
        ) {
            http.set_protocol_version(version);
        }

        self.send_notification("notifications/initialized", None)
            .await?;

        Ok(())
    }

    async fn discover_tools(&mut self) -> Result<(), String> {
        let response = self
            .send_request("tools/list", None)
            .await?
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

        let tools_array = response
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        self.tools = tools_array
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();
                let description = t
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or("")
                    .to_string();
                let input_schema = t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

                Some(McpTool {
                    server: self.config.name.clone(),
                    name,
                    description,
                    input_schema,
                })
            })
            .collect();

        Ok(())
    }

    /// The last lines the server printed to stderr. Only servers started as processes have any.
    fn server_output(&self) -> Vec<String> {
        match &self.transport {
            Transport::Stdio(io) => io.stderr_snapshot().into_iter().collect(),
            _ => Vec::new(),
        }
    }

    async fn call_tool(
        &mut self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolResult, String> {
        let params = serde_json::json!({
            "name": tool_name,
            "arguments": arguments,
        });

        let response = match self.send_request("tools/call", Some(params)).await {
            Ok(response) => response,
            Err(error) => {
                let alive = self.is_alive();
                let tail = match &self.transport {
                    Transport::Stdio(io) => io.stderr_snapshot(),
                    _ => VecDeque::new(),
                };
                return Err(failure_context(error, alive, &tail));
            }
        };

        let response = response.ok_or_else(|| {
            format!(
                "MCP server '{}' returned empty response for tool '{}'",
                self.config.name, tool_name
            )
        })?;

        let is_error = response
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let content_array = response
            .get("content")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();

        let content = content_array
            .into_iter()
            .map(|c| McpContent {
                r#type: c
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("text")
                    .to_string(),
                text: c.get("text").and_then(|t| t.as_str()).map(String::from),
                data: c.get("data").and_then(|d| d.as_str()).map(String::from),
                mime_type: c.get("mimeType").and_then(|m| m.as_str()).map(String::from),
            })
            .collect();

        Ok(McpToolResult { content, is_error })
    }

    async fn send_request(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<Option<serde_json::Value>, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method: method.to_string(),
            params,
        };

        let msg = serde_json::to_string(&request).map_err(|e| format!("Serialize error: {e}"))?;
        let wait = response_timeout(method);
        let name = self.config.name.clone();

        let response: JsonRpcResponse = match &mut self.transport {
            Transport::Stdio(io) => {
                io.write_line(&name, "request", &msg).await?;
                io.read_response(&name, id, wait).await?
            }
            Transport::Http(http) => {
                let message = http.request(id, &msg, wait).await?;
                serde_json::from_value(message)
                    .map_err(|e| format!("MCP server '{name}' sent an invalid reply: {e}"))?
            }
            Transport::Sse(sse) => {
                let message = sse.request(id, &msg, wait).await?;
                serde_json::from_value(message)
                    .map_err(|e| format!("MCP server '{name}' sent an invalid reply: {e}"))?
            }
        };

        if let Some(ref err) = response.error {
            return Err(format!(
                "MCP server '{}' error ({}): {}",
                self.config.name, err.code, err.message
            ));
        }

        Ok(response.result)
    }

    async fn send_notification(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), String> {
        #[derive(Serialize)]
        struct JsonRpcNotification {
            jsonrpc: &'static str,
            method: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            params: Option<serde_json::Value>,
        }

        let notification = JsonRpcNotification {
            jsonrpc: "2.0",
            method: method.to_string(),
            params,
        };

        let msg =
            serde_json::to_string(&notification).map_err(|e| format!("Serialize error: {e}"))?;
        let name = self.config.name.clone();

        match &mut self.transport {
            Transport::Stdio(io) => io.write_line(&name, "notification", &msg).await,
            Transport::Http(http) => http.notify(&msg, DEFAULT_TIMEOUT).await,
            Transport::Sse(sse) => sse.notify(&msg, DEFAULT_TIMEOUT).await,
        }
    }

    fn is_alive(&mut self) -> bool {
        match &mut self.transport {
            Transport::Stdio(io) => io
                .child
                .try_wait()
                .ok()
                .map_or(true, |status| status.is_none()),
            Transport::Http(_) => true,
            Transport::Sse(sse) => sse.is_open(),
        }
    }

    async fn shutdown(&mut self) {
        match &mut self.transport {
            Transport::Stdio(_) => {
                let _ = self
                    .send_notification("notifications/cancelled", None)
                    .await;
                if let Transport::Stdio(io) = &mut self.transport {
                    let _ = io.child.kill().await;
                }
            }
            Transport::Http(http) => http.close().await,
            // Dropping the transport closes the event stream.
            Transport::Sse(_) => {}
        }
    }
}

// ─── State ───────────────────────────────────────────────────────────────────

/// Map entry: the connection itself lives behind its own lock so that I/O on
/// one server never blocks commands touching other servers. The discovered
/// tool list is cached here (updated at connect/reconnect time) so listing
/// commands never need to lock a connection.
struct McpServerEntry {
    conn: Arc<Mutex<McpConnection>>,
    tools: Vec<McpTool>,
}

pub struct McpState {
    servers: Mutex<HashMap<String, McpServerEntry>>,
    configs: Mutex<Vec<McpServerConfig>>,
    config_path: Mutex<String>,
    /// What a server printed the last time it failed to start; it has no connection to read it from.
    failed_output: Mutex<HashMap<String, Vec<String>>>,
}

impl McpState {
    pub fn new() -> Self {
        let config_path = crate::app_dirs::app_data_dir()
            .join(CONFIG_FILENAME)
            .to_string_lossy()
            .to_string();

        Self {
            servers: Mutex::new(HashMap::new()),
            configs: Mutex::new(Vec::new()),
            config_path: Mutex::new(config_path),
            failed_output: Mutex::new(HashMap::new()),
        }
    }

    pub async fn load_config(&self) -> Result<(), String> {
        let path = self.config_path.lock().await.clone();
        let path = std::path::Path::new(&path);

        if !path.exists() {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create config directory: {e}"))?;
            }
            std::fs::write(path, "[]").map_err(|e| format!("Failed to create config file: {e}"))?;
        }

        let contents =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read config: {e}"))?;

        let configs: Vec<McpServerConfig> =
            serde_json::from_str(&contents).map_err(|e| format!("Invalid config JSON: {e}"))?;

        *self.configs.lock().await = configs;
        Ok(())
    }

    async fn save_config(&self) -> Result<(), String> {
        let path = self.config_path.lock().await.clone();
        let json = {
            let configs = self.configs.lock().await;
            serde_json::to_string_pretty(&*configs)
                .map_err(|e| format!("Failed to serialize config: {e}"))?
        };

        // Atomic write (tmp + rename) off the async executor: a crash
        // mid-write must not corrupt mcp-servers.json.
        tokio::task::spawn_blocking(move || {
            let tmp = format!("{path}.tmp.{}", std::process::id());
            std::fs::write(&tmp, json).map_err(|e| format!("Failed to write config: {e}"))?;
            std::fs::rename(&tmp, &path).map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                format!("Failed to publish config: {e}")
            })
        })
        .await
        .map_err(|e| format!("config write task failed: {e}"))??;
        Ok(())
    }
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn mcp_list_servers(state: State<'_, McpState>) -> Result<Vec<McpServerStatus>, String> {
    let configs = state.configs.lock().await;
    let servers = state.servers.lock().await;

    let statuses = configs
        .iter()
        .map(|c| {
            let connected = servers.contains_key(&c.name);
            let tool_count = servers
                .get(&c.name)
                .map(|entry| entry.tools.len())
                .unwrap_or(0);

            McpServerStatus {
                name: c.name.clone(),
                transport: c.transport.clone(),
                connected,
                tool_count,
            }
        })
        .collect();

    Ok(statuses)
}

/// What a connected stdio server last printed to stderr (the newest lines, oldest first). Empty for other servers.
#[tauri::command]
pub async fn mcp_server_output(
    state: State<'_, McpState>,
    server_name: String,
) -> Result<Vec<String>, String> {
    let conn_arc = {
        let servers = state.servers.lock().await;
        servers
            .get(&server_name)
            .map(|entry| Arc::clone(&entry.conn))
    };
    match conn_arc {
        Some(conn) => Ok(conn.lock().await.server_output()),
        None => Ok(state
            .failed_output
            .lock()
            .await
            .get(&server_name)
            .cloned()
            .unwrap_or_default()),
    }
}

#[tauri::command]
pub async fn mcp_connect(
    state: State<'_, McpState>,
    server_name: String,
) -> Result<McpServerStatus, String> {
    let config = {
        let configs = state.configs.lock().await;
        configs
            .iter()
            .find(|c| c.name == server_name)
            .cloned()
            .ok_or_else(|| format!("Server '{}' not found in config", server_name))?
    };

    // Disconnect existing connection if any: remove from the map first
    // (brief lock), then shut down under the connection's own lock.
    let existing = state.servers.lock().await.remove(&server_name);
    if let Some(entry) = existing {
        entry.conn.lock().await.shutdown().await;
    }

    let conn = match McpConnection::spawn(&config).await {
        Ok(conn) => conn,
        Err(error) => {
            state
                .failed_output
                .lock()
                .await
                .insert(server_name, output_in_error(&error));
            return Err(error);
        }
    };
    state.failed_output.lock().await.remove(&server_name);
    let tools = conn.tools.clone();
    let tool_count = tools.len();

    state.servers.lock().await.insert(
        server_name.clone(),
        McpServerEntry {
            conn: Arc::new(Mutex::new(conn)),
            tools,
        },
    );

    Ok(McpServerStatus {
        name: server_name,
        transport: config.transport,
        connected: true,
        tool_count,
    })
}

#[tauri::command]
pub async fn mcp_disconnect(state: State<'_, McpState>, server_name: String) -> Result<(), String> {
    // Remove from the map first (brief lock), then clean up under the
    // connection's own lock.
    let entry = state.servers.lock().await.remove(&server_name);
    if let Some(entry) = entry {
        entry.conn.lock().await.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, McpState>) -> Result<Vec<McpTool>, String> {
    let servers = state.servers.lock().await;
    let tools: Vec<McpTool> = servers
        .values()
        .flat_map(|entry| entry.tools.clone())
        .collect();
    Ok(tools)
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: State<'_, McpState>,
    server: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<McpToolResult, String> {
    // Hold the map lock only long enough to clone the connection's Arc;
    // all I/O happens under the per-connection lock.
    let conn_arc = {
        let servers = state.servers.lock().await;
        servers
            .get(&server)
            .map(|entry| Arc::clone(&entry.conn))
            .ok_or_else(|| format!("Server '{}' is not connected", server))?
    };

    {
        let mut conn = conn_arc.lock().await;
        if conn.is_alive() {
            return conn.call_tool(&tool_name, arguments).await;
        }
    }

    // Auto-reconnect: spawn a fresh connection without holding any lock,
    // then briefly lock the map to replace the entry (and its tool cache).
    let config = {
        let configs = state.configs.lock().await;
        configs
            .iter()
            .find(|c| c.name == server)
            .cloned()
            .ok_or_else(|| format!("Server '{}' not found in config", server))?
    };

    let new_conn = McpConnection::spawn(&config).await?;
    let tools = new_conn.tools.clone();
    let new_arc = Arc::new(Mutex::new(new_conn));

    {
        let mut servers = state.servers.lock().await;
        servers.insert(
            server.clone(),
            McpServerEntry {
                conn: Arc::clone(&new_arc),
                tools,
            },
        );
    }

    let mut conn = new_arc.lock().await;
    conn.call_tool(&tool_name, arguments).await
}

#[tauri::command]
pub async fn mcp_add_server(
    state: State<'_, McpState>,
    config: McpServerConfig,
) -> Result<(), String> {
    let mut configs = state.configs.lock().await;

    if configs.iter().any(|c| c.name == config.name) {
        return Err(format!("Server '{}' already exists", config.name));
    }

    configs.push(config);
    drop(configs);

    state.save_config().await
}

#[tauri::command]
pub async fn mcp_remove_server(
    state: State<'_, McpState>,
    server_name: String,
) -> Result<(), String> {
    // Disconnect if running: remove from the map first (brief lock), then
    // clean up under the connection's own lock.
    let entry = state.servers.lock().await.remove(&server_name);
    if let Some(entry) = entry {
        entry.conn.lock().await.shutdown().await;
    }

    state.failed_output.lock().await.remove(&server_name);
    let mut configs = state.configs.lock().await;
    configs.retain(|c| c.name != server_name);
    drop(configs);

    state.save_config().await
}

#[tauri::command]
pub async fn mcp_reload_config(state: State<'_, McpState>) -> Result<Vec<McpServerStatus>, String> {
    state.load_config().await?;
    mcp_list_servers(state).await
}

#[cfg(test)]
mod timeout_tests {
    use super::*;

    #[test]
    fn startup_and_tool_calls_wait_longer_than_other_requests() {
        assert_eq!(response_timeout("initialize"), STARTUP_TIMEOUT);
        assert_eq!(response_timeout("tools/list"), STARTUP_TIMEOUT);
        assert_eq!(response_timeout("tools/call"), TOOL_CALL_TIMEOUT);
        assert_eq!(response_timeout("ping"), DEFAULT_TIMEOUT);
        assert!(STARTUP_TIMEOUT > DEFAULT_TIMEOUT && TOOL_CALL_TIMEOUT > STARTUP_TIMEOUT);
    }
}

#[cfg(test)]
mod server_output_tests {
    use super::*;

    #[test]
    fn keeps_only_the_newest_lines_and_skips_blank_ones() {
        let mut tail = VecDeque::new();
        for i in 0..(STDERR_LINES + 5) {
            push_stderr_line(&mut tail, &format!("line {i}\r\n"));
        }
        push_stderr_line(&mut tail, "   ");
        assert_eq!(tail.len(), STDERR_LINES);
        assert_eq!(tail.front().map(String::as_str), Some("line 5"));
        assert_eq!(
            tail.back().map(String::as_str),
            Some(format!("line {}", STDERR_LINES + 4).as_str())
        );
    }

    #[test]
    fn cuts_a_very_long_line() {
        let mut tail = VecDeque::new();
        push_stderr_line(&mut tail, &"x".repeat(STDERR_LINE_CHARS * 3));
        assert_eq!(tail[0].chars().count(), STDERR_LINE_CHARS);
    }

    #[test]
    fn appends_server_output_to_an_error_only_when_there_is_some() {
        let error = "Timeout waiting for response from MCP server 'fs'".to_string();
        assert_eq!(with_server_output(error.clone(), &VecDeque::new()), error);
        let mut tail = VecDeque::new();
        push_stderr_line(&mut tail, "npm ERR! 404 Not Found");
        push_stderr_line(&mut tail, "npm ERR! not in registry");
        assert_eq!(
            with_server_output(error.clone(), &tail),
            format!("{error}\nServer output:\nnpm ERR! 404 Not Found\nnpm ERR! not in registry")
        );
    }
}

#[cfg(test)]
mod remote_tests {
    use super::*;
    use serde_json::{json, Value};
    use std::future::Future;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::io::AsyncReadExt;
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::mpsc;

    struct Req {
        method: String,
        path: String,
        headers: HashMap<String, String>,
        body: String,
    }

    impl Req {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers.get(name).map(String::as_str)
        }

        /// The JSON-RPC id, method and params of the body.
        fn rpc(&self) -> (Option<u64>, String, Value) {
            let message: Value = serde_json::from_str(&self.body).unwrap_or_default();
            (
                message.get("id").and_then(Value::as_u64),
                message["method"].as_str().unwrap_or("").to_string(),
                message["params"].clone(),
            )
        }
    }

    async fn read_request(sock: &mut TcpStream) -> Option<Req> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        let head_end = loop {
            if let Some(at) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break at;
            }
            let n = sock.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            buf.extend_from_slice(&chunk[..n]);
        };
        let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
        let mut lines = head.split("\r\n");
        let mut first = lines.next()?.split(' ');
        let method = first.next()?.to_string();
        let path = first.next()?.to_string();
        let headers: HashMap<String, String> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
            .collect();
        let length: usize = headers
            .get("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let mut body = buf[head_end + 4..].to_vec();
        while body.len() < length {
            let n = sock.read(&mut chunk).await.ok()?;
            if n == 0 {
                return None;
            }
            body.extend_from_slice(&chunk[..n]);
        }
        Some(Req {
            method,
            path,
            headers,
            body: String::from_utf8_lossy(&body).to_string(),
        })
    }

    async fn respond(sock: &mut TcpStream, status: &str, headers: &[(&str, &str)], body: &str) {
        let mut out = format!("HTTP/1.1 {status}\r\nconnection: close\r\n");
        for (key, value) in headers {
            out.push_str(&format!("{key}: {value}\r\n"));
        }
        out.push_str(&format!("content-length: {}\r\n\r\n{body}", body.len()));
        let _ = sock.write_all(out.as_bytes()).await;
        let _ = sock.shutdown().await;
    }

    async fn serve<F, Fut>(handler: F) -> u16
    where
        F: Fn(Req, TcpStream) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handler = Arc::new(handler);
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let handler = Arc::clone(&handler);
                tokio::spawn(async move {
                    if let Some(req) = read_request(&mut sock).await {
                        handler(req, sock).await;
                    }
                });
            }
        });
        port
    }

    fn reply(id: u64, result: Value) -> String {
        json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
    }

    fn init_result() -> Value {
        json!({"protocolVersion": "2025-06-18", "capabilities": {}, "serverInfo": {"name": "t", "version": "1"}})
    }

    fn tool_list() -> Value {
        json!({"tools": [{"name": "echo", "description": "Echoes", "inputSchema": {"type": "object"}}]})
    }

    fn echo_result(params: &Value) -> Value {
        let text = params["arguments"]["text"].as_str().unwrap_or("");
        json!({"content": [{"type": "text", "text": format!("echo: {text}")}], "isError": false})
    }

    fn config(transport: &str, url: Option<String>, headers: &[(&str, &str)]) -> McpServerConfig {
        McpServerConfig {
            name: "remote".to_string(),
            command: String::new(),
            args: Vec::new(),
            env: HashMap::new(),
            transport: transport.to_string(),
            url,
            headers: headers
                .iter()
                .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
                .collect(),
        }
    }

    fn url(port: u16, path: &str) -> Option<String> {
        Some(format!("http://127.0.0.1:{port}{path}"))
    }

    /// A Streamable HTTP server that hands out a session, wants a header and the agreed protocol version on later
    /// requests, answers `tools/list` as an event stream and everything else as JSON.
    async fn streamable_server(ended: Arc<AtomicBool>) -> u16 {
        serve(move |req, mut sock| {
            let ended = Arc::clone(&ended);
            async move {
                if req.header("x-api-key") != Some("secret") {
                    return respond(&mut sock, "401 Unauthorized", &[], "bad key").await;
                }
                if req.method == "DELETE" {
                    ended.store(
                        req.header("mcp-session-id") == Some("s-1"),
                        Ordering::SeqCst,
                    );
                    return respond(&mut sock, "200 OK", &[], "").await;
                }
                let (id, method, params) = req.rpc();
                if method == "initialize" {
                    let body = reply(id.unwrap_or(0), init_result());
                    let headers = [
                        ("content-type", "application/json"),
                        ("mcp-session-id", "s-1"),
                    ];
                    return respond(&mut sock, "200 OK", &headers, &body).await;
                }
                let agreed = req.header("mcp-session-id") == Some("s-1")
                    && req.header("mcp-protocol-version") == Some("2025-06-18");
                if !agreed {
                    return respond(&mut sock, "400 Bad Request", &[], "no session").await;
                }
                match method.as_str() {
                    "notifications/initialized" => {
                        respond(&mut sock, "202 Accepted", &[], "").await
                    }
                    "tools/list" => {
                        let note = json!({"jsonrpc": "2.0", "method": "notifications/message"});
                        let body = format!(
                            "event: message\ndata: {note}\n\nevent: message\ndata: {}\n\n",
                            reply(id.unwrap_or(0), tool_list())
                        );
                        respond(
                            &mut sock,
                            "200 OK",
                            &[("content-type", "text/event-stream")],
                            &body,
                        )
                        .await;
                    }
                    "tools/call" => {
                        let body = reply(id.unwrap_or(0), echo_result(&params));
                        respond(
                            &mut sock,
                            "200 OK",
                            &[("content-type", "application/json")],
                            &body,
                        )
                        .await;
                    }
                    _ => respond(&mut sock, "404 Not Found", &[], "").await,
                }
            }
        })
        .await
    }

    /// The older protocol: `GET /sse` opens a stream that names `/messages`, replies to POSTs come back on it,
    /// and POSTing to `/sse` itself is refused the way such servers do.
    async fn legacy_server(endpoint: &'static str) -> u16 {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        let rx = Arc::new(tokio::sync::Mutex::new(Some(rx)));
        serve(move |req, mut sock| {
            let tx = tx.clone();
            let rx = Arc::clone(&rx);
            async move {
                if req.method == "GET" && req.path == "/sse" {
                    let head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n";
                    let _ = sock.write_all(head.as_bytes()).await;
                    let hello = format!("event: endpoint\ndata: {endpoint}\n\n");
                    let _ = sock.write_all(hello.as_bytes()).await;
                    let taken = rx.lock().await.take();
                    if let Some(mut rx) = taken {
                        while let Some(message) = rx.recv().await {
                            let event = format!("event: message\ndata: {message}\n\n");
                            if sock.write_all(event.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    }
                    return;
                }
                if req.method == "POST" && req.path.starts_with("/messages") {
                    let (id, method, params) = req.rpc();
                    let result = match method.as_str() {
                        "initialize" => Some(init_result()),
                        "tools/list" => Some(tool_list()),
                        "tools/call" => Some(echo_result(&params)),
                        _ => None,
                    };
                    if let (Some(id), Some(result)) = (id, result) {
                        let _ = tx.send(reply(id, result));
                    }
                    return respond(&mut sock, "202 Accepted", &[], "Accepted").await;
                }
                respond(&mut sock, "405 Method Not Allowed", &[], "").await;
            }
        })
        .await
    }

    async fn echo(conn: &mut McpConnection) -> Option<String> {
        let result = conn.call_tool("echo", json!({"text": "hi"})).await.ok()?;
        result.content.first()?.text.clone()
    }

    #[tokio::test]
    async fn streamable_http_keeps_the_session_sends_headers_and_reads_json_and_event_replies() {
        let ended = Arc::new(AtomicBool::new(false));
        let port = streamable_server(Arc::clone(&ended)).await;
        let cfg = config("http", url(port, "/mcp"), &[("X-Api-Key", "secret")]);
        let mut conn = McpConnection::spawn(&cfg).await.unwrap();
        assert_eq!(conn.tools.len(), 1);
        assert_eq!(conn.tools[0].name, "echo");
        assert_eq!(echo(&mut conn).await.as_deref(), Some("echo: hi"));
        assert!(conn.is_alive());
        conn.shutdown().await;
        assert!(ended.load(Ordering::SeqCst), "the session was not ended");
    }

    #[tokio::test]
    async fn a_refused_login_says_where_credentials_go_and_leaves_the_url_out() {
        let port = streamable_server(Arc::new(AtomicBool::new(false))).await;
        let cfg = config(
            "http",
            url(port, "/mcp?token=hunter2"),
            &[("X-Api-Key", "wrong")],
        );
        let error = McpConnection::spawn(&cfg).await.err().unwrap();
        assert!(
            error.contains("401") && error.contains("\"headers\""),
            "{error}"
        );
        assert!(
            !error.contains("hunter2") && !error.contains("wrong"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn the_older_sse_transport_works_when_asked_for() {
        let port = legacy_server("/messages?sessionId=7").await;
        let mut conn = McpConnection::spawn(&config("sse", url(port, "/sse"), &[]))
            .await
            .unwrap();
        assert_eq!(conn.tools.len(), 1);
        assert_eq!(echo(&mut conn).await.as_deref(), Some("echo: hi"));
        assert!(conn.is_alive());
        conn.shutdown().await;
    }

    #[tokio::test]
    async fn an_http_server_that_only_knows_sse_is_reached_through_the_fallback() {
        let port = legacy_server("/messages?sessionId=7").await;
        let mut conn = McpConnection::spawn(&config("http", url(port, "/sse"), &[]))
            .await
            .unwrap();
        assert!(matches!(conn.transport, Transport::Sse(_)));
        assert_eq!(echo(&mut conn).await.as_deref(), Some("echo: hi"));
    }

    #[tokio::test]
    async fn a_message_endpoint_on_another_host_is_refused() {
        let port = legacy_server("http://example.invalid/steal").await;
        let error = McpConnection::spawn(&config("sse", url(port, "/sse"), &[]))
            .await
            .err()
            .unwrap();
        assert!(error.contains("another host"), "{error}");
    }

    #[tokio::test]
    async fn redirects_stay_within_the_origin() {
        let hops = Arc::new(AtomicBool::new(false));
        let seen = Arc::clone(&hops);
        let port = serve(move |req, mut sock| {
            let seen = Arc::clone(&seen);
            async move {
                match req.path.as_str() {
                    "/same" => {
                        respond(
                            &mut sock,
                            "307 Temporary Redirect",
                            &[("location", "/mcp")],
                            "",
                        )
                        .await
                    }
                    "/elsewhere" => {
                        let to = format!("http://localhost:{}/mcp", 1);
                        respond(
                            &mut sock,
                            "307 Temporary Redirect",
                            &[("location", &to)],
                            "",
                        )
                        .await;
                    }
                    _ => {
                        seen.store(true, Ordering::SeqCst);
                        let (id, method, _) = req.rpc();
                        let body = if method == "initialize" {
                            reply(id.unwrap_or(0), init_result())
                        } else {
                            String::new()
                        };
                        let status = if method == "initialize" {
                            "200 OK"
                        } else {
                            "202 Accepted"
                        };
                        respond(
                            &mut sock,
                            status,
                            &[("content-type", "application/json")],
                            &body,
                        )
                        .await;
                    }
                }
            }
        })
        .await;
        let mut http = HttpTransport::new(
            "r",
            &format!("http://127.0.0.1:{port}/same"),
            &HashMap::new(),
        )
        .unwrap();
        let body = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize"}).to_string();
        assert!(http.request(1, &body, Duration::from_secs(5)).await.is_ok());
        assert!(
            hops.load(Ordering::SeqCst),
            "the same-origin redirect was not followed"
        );

        let mut other = HttpTransport::new(
            "r",
            &format!("http://127.0.0.1:{port}/elsewhere"),
            &HashMap::new(),
        )
        .unwrap();
        let error = other
            .request(1, &body, Duration::from_secs(5))
            .await
            .unwrap_err();
        assert!(error.contains("307"), "{error}");
    }

    #[tokio::test]
    async fn bad_remote_settings_are_reported_before_any_connection() {
        for (cfg, expected) in [
            (config("http", None, &[]), "has no url"),
            (config("sse", Some("  ".into()), &[]), "has no url"),
            (
                config("http", Some("file:///etc/passwd".into()), &[]),
                "http or https",
            ),
            (
                config("http", url(1, "/"), &[("bad name", "v")]),
                "invalid header name",
            ),
            (config("carrier-pigeon", None, &[]), "not supported"),
        ] {
            let error = McpConnection::spawn(&cfg).await.err().unwrap();
            assert!(error.contains(expected), "{error}");
        }
    }

    #[test]
    fn saved_stdio_servers_without_the_new_fields_still_load() {
        let cfg: McpServerConfig =
            serde_json::from_str(r#"{"name":"a","command":"node","args":["a.js"]}"#).unwrap();
        assert_eq!(cfg.transport, "stdio");
        assert!(cfg.headers.is_empty() && cfg.url.is_none());
        let remote: McpServerConfig =
            serde_json::from_str(r#"{"name":"b","transport":"http","url":"https://x/mcp"}"#)
                .unwrap();
        assert!(remote.command.is_empty() && remote.args.is_empty());
    }
}

#[cfg(test)]
mod failure_context_tests {
    use super::*;

    fn tail(lines: &[&str]) -> VecDeque<String> {
        lines.iter().map(|l| (*l).to_string()).collect()
    }

    #[test]
    fn a_dead_process_or_a_silent_failure_gets_the_server_output() {
        let output = tail(&["Error: cannot find module"]);
        let dead = failure_context("closed".to_string(), false, &output);
        assert!(
            dead.ends_with("Server output:\nError: cannot find module"),
            "{dead}"
        );
        let hung = failure_context(
            "Timeout waiting for response from MCP server 'a'".into(),
            true,
            &output,
        );
        assert!(hung.contains("Server output:"), "{hung}");
        let closed = failure_context(
            "MCP server 'a' closed connection unexpectedly".into(),
            true,
            &output,
        );
        assert!(closed.contains("Server output:"), "{closed}");
    }

    #[test]
    fn an_answer_the_server_gave_on_purpose_is_left_alone() {
        let output = tail(&["noise"]);
        let error = "MCP server 'a' error (-32602): bad params".to_string();
        assert_eq!(failure_context(error.clone(), true, &output), error);
    }

    #[test]
    fn nothing_is_added_when_the_server_printed_nothing() {
        let error = "Timeout waiting for response from MCP server 'a'".to_string();
        assert_eq!(
            failure_context(error.clone(), false, &VecDeque::new()),
            error
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stderr_of_a_running_server_is_kept_and_readable() {
        let config = McpServerConfig {
            name: "noisy".to_string(),
            command: "sh".to_string(),
            args: vec![
                "-c".to_string(),
                "echo first >&2; echo second >&2; sleep 5".to_string(),
            ],
            env: HashMap::new(),
            transport: "stdio".to_string(),
            url: None,
            headers: HashMap::new(),
        };
        let io = StdioIo::spawn(&config).await.unwrap();
        let conn = McpConnection::with_transport(&config, Transport::Stdio(io));
        let mut lines = Vec::new();
        for _ in 0..50 {
            lines = conn.server_output();
            if lines.len() == 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert_eq!(lines, vec!["first".to_string(), "second".to_string()]);
    }
}

#[cfg(test)]
mod failed_output_tests {
    use super::*;

    #[test]
    fn output_is_read_back_from_the_error_it_was_appended_to() {
        let tail: VecDeque<String> = ["one", "two"].iter().map(|l| l.to_string()).collect();
        let error = with_server_output("closed connection".into(), &tail);
        assert_eq!(output_in_error(&error), vec!["one", "two"]);
    }

    #[test]
    fn an_error_without_output_has_none() {
        assert_eq!(output_in_error("closed connection"), Vec::<String>::new());
    }
}
