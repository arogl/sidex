//! Remote MCP transports.
//!
//! * [`HttpTransport`] is "Streamable HTTP" (`type: "http"` in `mcp.json`): every JSON-RPC message is a POST to one
//!   URL, and the reply is either a JSON body or an event stream that carries it.
//! * [`SseTransport`] is the older HTTP+SSE transport (`type: "sse"`): a GET opens an event stream whose first
//!   `endpoint` event names the URL to POST messages to, and replies come back on the stream.
//!
//! Both return the raw JSON-RPC message for a request id; `mcp.rs` turns it into a response.

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use reqwest::{Client, Response, Url};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

const SESSION_HEADER: &str = "mcp-session-id";
const PROTOCOL_VERSION_HEADER: &str = "mcp-protocol-version";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Closing is best effort and must never hold up a disconnect.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);
/// Characters of an error response body kept in a message.
const BODY_SNIPPET_CHARS: usize = 200;
const MAX_REDIRECTS: usize = 5;

// ─── Server-sent events ──────────────────────────────────────────────────────

/// One dispatched server-sent event.
#[derive(Debug, PartialEq, Eq)]
pub struct SseEvent {
    pub event: String,
    pub data: String,
}

/// Incremental parser for a `text/event-stream` body. Chunks can end anywhere, including inside a line or a
/// multi-byte character, so bytes are kept until a whole line is available.
#[derive(Default)]
pub struct SseParser {
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some((line, rest)) = take_line(&self.buffer) {
            let line = String::from_utf8_lossy(&line).into_owned();
            self.buffer.drain(..rest);
            if let Some(event) = self.line(&line) {
                events.push(event);
            }
        }
        events
    }

    fn line(&mut self, line: &str) -> Option<SseEvent> {
        if line.is_empty() {
            let event = self.event.take();
            if self.data.is_empty() {
                return None;
            }
            let data = self.data.join("\n");
            self.data.clear();
            return Some(SseEvent {
                event: event.unwrap_or_else(|| "message".to_string()),
                data,
            });
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = Some(value.to_string()),
            "data" => self.data.push(value.to_string()),
            _ => {}
        }
        None
    }
}

/// The first complete line in `buffer` and how many bytes it used. A line ends at `\n`, `\r\n` or a lone `\r`; a
/// `\r` at the very end waits for the next chunk, since it may be the first half of `\r\n`.
fn take_line(buffer: &[u8]) -> Option<(Vec<u8>, usize)> {
    let end = buffer.iter().position(|&b| b == b'\n' || b == b'\r')?;
    let terminator = if buffer[end] == b'\r' {
        match buffer.get(end + 1) {
            None => return None,
            Some(b'\n') => 2,
            Some(_) => 1,
        }
    } else {
        1
    };
    Some((buffer[..end].to_vec(), end + terminator))
}

/// The response to request `id` in a JSON-RPC body, which is one message or a batch of them. Notifications and
/// requests from the server have no matching id and are skipped.
pub fn find_response(body: &Value, id: u64) -> Option<Value> {
    let is_response = |message: &Value| {
        message.get("id").and_then(Value::as_u64) == Some(id)
            && (message.get("result").is_some() || message.get("error").is_some())
    };
    match body {
        Value::Array(messages) => messages.iter().find(|m| is_response(m)).cloned(),
        message if is_response(message) => Some(message.clone()),
        _ => None,
    }
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

fn parse_url(name: &str, url: &str) -> Result<Url, String> {
    let parsed =
        Url::parse(url).map_err(|e| format!("MCP server '{name}' has an invalid url: {e}"))?;
    if parsed.scheme() == "http" || parsed.scheme() == "https" {
        Ok(parsed)
    } else {
        Err(format!(
            "MCP server '{name}' needs an http or https url, not '{}'",
            parsed.scheme()
        ))
    }
}

fn parse_headers(name: &str, headers: &HashMap<String, String>) -> Result<HeaderMap, String> {
    let mut map = HeaderMap::new();
    for (key, value) in headers {
        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|_| format!("MCP server '{name}' has an invalid header name '{key}'"))?;
        let mut header_value = HeaderValue::from_str(value)
            .map_err(|_| format!("MCP server '{name}' has an invalid value for header '{key}'"))?;
        // Values are often credentials; keep them out of debug output.
        header_value.set_sensitive(true);
        map.insert(header_name, header_value);
    }
    Ok(map)
}

/// A client that follows redirects only within one origin, so a header meant for one server is never sent to
/// another.
fn build_client(name: &str) -> Result<Client, String> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let same_origin = attempt
                .previous()
                .last()
                .is_some_and(|previous| previous.origin() == attempt.url().origin());
            if same_origin && attempt.previous().len() < MAX_REDIRECTS {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("Could not set up the connection to MCP server '{name}': {e}"))
}

/// Our headers win over any the user set for the same name.
fn request_headers(user: &HeaderMap, accept: &'static str, json_body: bool) -> HeaderMap {
    let mut headers = user.clone();
    headers.insert(ACCEPT, HeaderValue::from_static(accept));
    if json_body {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    headers
}

fn send_error(name: &str, e: reqwest::Error) -> String {
    // The url can carry a token in its query string, so it stays out of the message.
    format!("Could not reach MCP server '{name}': {}", e.without_url())
}

/// A failed response as a message. A rejected login is the likeliest cause people can act on.
async fn status_error(name: &str, response: Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let snippet: String = body.trim().chars().take(BODY_SNIPPET_CHARS).collect();
    let mut message = format!("MCP server '{name}' answered HTTP {status}");
    if status.as_u16() == 401 || status.as_u16() == 403 {
        message.push_str(
            ". It wants credentials: add them under \"headers\" for this server in mcp.json \
             (signing in with OAuth is not supported yet)",
        );
    }
    if !snippet.is_empty() {
        message.push_str(": ");
        message.push_str(&snippet);
    }
    message
}

fn content_type(response: &Response) -> String {
    response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
}

// ─── Streamable HTTP ─────────────────────────────────────────────────────────

pub struct HttpTransport {
    name: String,
    client: Client,
    url: Url,
    headers: HeaderMap,
    session_id: Option<String>,
    protocol_version: Option<String>,
    /// The status of the last rejected request. A server that only speaks the older transport answers the first
    /// POST with 400, 404 or 405, which is the cue to try that one.
    pub rejected_status: Option<u16>,
}

impl HttpTransport {
    pub fn new(name: &str, url: &str, headers: &HashMap<String, String>) -> Result<Self, String> {
        Ok(Self {
            name: name.to_string(),
            client: build_client(name)?,
            url: parse_url(name, url)?,
            headers: parse_headers(name, headers)?,
            session_id: None,
            protocol_version: None,
            rejected_status: None,
        })
    }

    /// Later requests tell the server which protocol version was agreed.
    pub fn set_protocol_version(&mut self, version: &str) {
        self.protocol_version = Some(version.to_string());
    }

    fn post(&self, body: &str) -> reqwest::RequestBuilder {
        let mut headers =
            request_headers(&self.headers, "application/json, text/event-stream", true);
        self.add_session_headers(&mut headers);
        self.client
            .post(self.url.clone())
            .headers(headers)
            .body(body.to_string())
    }

    fn add_session_headers(&self, headers: &mut HeaderMap) {
        if let Some(Ok(value)) = self.session_id.as_deref().map(HeaderValue::from_str) {
            headers.insert(HeaderName::from_static(SESSION_HEADER), value);
        }
        if let Some(Ok(value)) = self.protocol_version.as_deref().map(HeaderValue::from_str) {
            headers.insert(HeaderName::from_static(PROTOCOL_VERSION_HEADER), value);
        }
    }

    fn remember_session(&mut self, response: &Response) {
        if let Some(id) = response
            .headers()
            .get(SESSION_HEADER)
            .and_then(|v| v.to_str().ok())
        {
            self.session_id = Some(id.to_string());
        }
    }

    /// Sends one request and returns the message that answers it.
    pub async fn request(&mut self, id: u64, body: &str, wait: Duration) -> Result<Value, String> {
        let name = self.name.clone();
        timeout(wait, self.exchange(id, body))
            .await
            .map_err(|_| format!("Timeout waiting for response from MCP server '{name}'"))?
    }

    async fn exchange(&mut self, id: u64, body: &str) -> Result<Value, String> {
        let response = self
            .post(body)
            .send()
            .await
            .map_err(|e| send_error(&self.name, e))?;
        self.remember_session(&response);
        if !response.status().is_success() {
            self.rejected_status = Some(response.status().as_u16());
            return Err(status_error(&self.name, response).await);
        }
        if content_type(&response).starts_with("text/event-stream") {
            let mut parser = SseParser::default();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| {
                    format!(
                        "MCP server '{}' dropped the event stream: {}",
                        self.name,
                        e.without_url()
                    )
                })?;
                for event in parser.push(&chunk) {
                    if event.event != "message" {
                        continue;
                    }
                    let found = serde_json::from_str::<Value>(&event.data)
                        .ok()
                        .and_then(|message| find_response(&message, id));
                    if let Some(message) = found {
                        return Ok(message);
                    }
                }
            }
            return Err(format!(
                "MCP server '{}' ended the event stream without answering",
                self.name
            ));
        }
        let text = response.text().await.map_err(|e| {
            format!(
                "Could not read the reply of MCP server '{}': {}",
                self.name,
                e.without_url()
            )
        })?;
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|_| format!("MCP server '{}' sent a reply that is not JSON", self.name))?;
        find_response(&parsed, id)
            .ok_or_else(|| format!("MCP server '{}' did not answer the request", self.name))
    }

    /// Sends a message that has no reply (the server answers 202).
    pub async fn notify(&mut self, body: &str, wait: Duration) -> Result<(), String> {
        let name = self.name.clone();
        let response = timeout(wait, self.post(body).send())
            .await
            .map_err(|_| format!("Timeout sending to MCP server '{name}'"))?
            .map_err(|e| send_error(&name, e))?;
        self.remember_session(&response);
        if response.status().is_success() {
            Ok(())
        } else {
            Err(status_error(&name, response).await)
        }
    }

    /// Ends the session on the server. Servers may refuse (405), and failing to say goodbye is not an error.
    pub async fn close(&mut self) {
        if self.session_id.is_none() {
            return;
        }
        let mut headers = self.headers.clone();
        self.add_session_headers(&mut headers);
        let request = self.client.delete(self.url.clone()).headers(headers).send();
        let _ = timeout(CLOSE_TIMEOUT, request).await;
        self.session_id = None;
    }
}

// ─── HTTP + SSE (older transport) ────────────────────────────────────────────

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

pub struct SseTransport {
    name: String,
    client: Client,
    endpoint: Url,
    headers: HeaderMap,
    pending: Pending,
    closed: Arc<AtomicBool>,
    reader: JoinHandle<()>,
}

impl SseTransport {
    /// Opens the event stream and waits for the server to name the URL it takes messages at.
    pub async fn connect(
        name: &str,
        url: &str,
        headers: &HashMap<String, String>,
        wait: Duration,
    ) -> Result<Self, String> {
        let url = parse_url(name, url)?;
        let headers = parse_headers(name, headers)?;
        let client = build_client(name)?;

        let opened = client
            .get(url.clone())
            .headers(request_headers(&headers, "text/event-stream", false))
            .send()
            .await
            .map_err(|e| send_error(name, e))?;
        if !opened.status().is_success() {
            return Err(status_error(name, opened).await);
        }

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let (endpoint_tx, endpoint_rx) = oneshot::channel::<String>();
        let reader = tokio::spawn(read_stream(
            opened,
            Arc::clone(&pending),
            Arc::clone(&closed),
            endpoint_tx,
        ));

        let endpoint = match timeout(wait, endpoint_rx).await {
            Ok(Ok(path)) => path,
            Ok(Err(_)) => {
                return Err(format!(
                    "MCP server '{name}' closed the event stream before naming its message endpoint"
                ))
            }
            Err(_) => {
                reader.abort();
                return Err(format!(
                    "MCP server '{name}' did not name its message endpoint in time"
                ));
            }
        };
        let endpoint = url
            .join(&endpoint)
            .map_err(|_| format!("MCP server '{name}' named an invalid message endpoint"))?;
        if endpoint.origin() != url.origin() {
            reader.abort();
            return Err(format!(
                "MCP server '{name}' named a message endpoint on another host, which is not allowed"
            ));
        }

        Ok(Self {
            name: name.to_string(),
            client,
            endpoint,
            headers,
            pending,
            closed,
            reader,
        })
    }

    fn post(&self, body: &str) -> reqwest::RequestBuilder {
        self.client
            .post(self.endpoint.clone())
            .headers(request_headers(&self.headers, "application/json", true))
            .body(body.to_string())
    }

    pub async fn request(&mut self, id: u64, body: &str, wait: Duration) -> Result<Value, String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(format!(
                "MCP server '{}' closed its event stream",
                self.name
            ));
        }
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        }
        let outcome = timeout(wait, async {
            let response = self
                .post(body)
                .send()
                .await
                .map_err(|e| send_error(&self.name, e))?;
            if !response.status().is_success() {
                return Err(status_error(&self.name, response).await);
            }
            rx.await
                .map_err(|_| format!("MCP server '{}' closed its event stream", self.name))
        })
        .await;
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&id);
        }
        outcome.map_err(|_| {
            format!(
                "Timeout waiting for response from MCP server '{}'",
                self.name
            )
        })?
    }

    pub async fn notify(&mut self, body: &str, wait: Duration) -> Result<(), String> {
        let response = timeout(wait, self.post(body).send())
            .await
            .map_err(|_| format!("Timeout sending to MCP server '{}'", self.name))?
            .map_err(|e| send_error(&self.name, e))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(status_error(&self.name, response).await)
        }
    }

    pub fn is_open(&self) -> bool {
        !self.closed.load(Ordering::SeqCst)
    }
}

impl Drop for SseTransport {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

/// Reads the event stream until it ends: the first `endpoint` event goes to `endpoint_tx`, and each reply is
/// handed to the request waiting on its id.
async fn read_stream(
    response: Response,
    pending: Pending,
    closed: Arc<AtomicBool>,
    endpoint_tx: oneshot::Sender<String>,
) {
    let mut endpoint_tx = Some(endpoint_tx);
    let mut parser = SseParser::default();
    let mut stream = response.bytes_stream();
    while let Some(Ok(chunk)) = stream.next().await {
        for event in parser.push(&chunk) {
            match event.event.as_str() {
                "endpoint" => {
                    if let Some(tx) = endpoint_tx.take() {
                        let _ = tx.send(event.data);
                    }
                }
                "message" => deliver(&pending, &event.data),
                _ => {}
            }
        }
    }
    closed.store(true, Ordering::SeqCst);
    // Dropping the senders wakes every waiting request with an error.
    if let Ok(mut pending) = pending.lock() {
        pending.clear();
    }
}

fn deliver(pending: &Pending, data: &str) {
    let Ok(message) = serde_json::from_str::<Value>(data) else {
        return;
    };
    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return;
    };
    if message.get("result").is_none() && message.get("error").is_none() {
        return;
    }
    let sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
    if let Some(sender) = sender {
        let _ = sender.send(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn events(chunks: &[&[u8]]) -> Vec<SseEvent> {
        let mut parser = SseParser::default();
        chunks.iter().flat_map(|c| parser.push(c)).collect()
    }

    fn event(kind: &str, data: &str) -> SseEvent {
        SseEvent {
            event: kind.to_string(),
            data: data.to_string(),
        }
    }

    #[test]
    fn a_message_event_is_the_default_kind() {
        assert_eq!(
            events(&[b"data: {\"a\":1}\n\n"]),
            vec![event("message", "{\"a\":1}")]
        );
    }

    #[test]
    fn data_lines_join_and_event_names_apply() {
        assert_eq!(
            events(&[b"event: endpoint\ndata: one\ndata: two\n\n"]),
            vec![event("endpoint", "one\ntwo")]
        );
    }

    #[test]
    fn comments_and_unknown_fields_are_ignored_and_an_empty_event_is_not_dispatched() {
        assert_eq!(
            events(&[b": keep-alive\nid: 7\nretry: 100\n\nevent: x\n\ndata: y\n\n"]),
            vec![event("message", "y")]
        );
    }

    #[test]
    fn crlf_and_lone_cr_end_lines() {
        assert_eq!(
            events(&[b"data: a\r\n\r\ndata: b\r\r:"]),
            vec![event("message", "a"), event("message", "b")]
        );
    }

    #[test]
    fn a_cr_at_the_end_of_a_chunk_waits_for_a_following_lf() {
        assert_eq!(
            events(&[b"data: a\r", b"\n\r", b"\n"]),
            vec![event("message", "a")]
        );
    }

    #[test]
    fn chunks_can_split_lines_and_characters() {
        let whole = "data: caf\u{e9}\n\n".as_bytes();
        let (first, second) = whole.split_at(10); // inside the two-byte character
        assert_eq!(
            events(&[first, second]),
            vec![event("message", "caf\u{e9}")]
        );
    }

    #[test]
    fn an_unfinished_event_is_not_dispatched() {
        assert!(events(&[b"data: partial\n"]).is_empty());
    }

    #[test]
    fn find_response_matches_the_id_in_a_single_message_or_a_batch() {
        let reply = json!({"jsonrpc":"2.0","id":2,"result":{"ok":true}});
        assert_eq!(find_response(&reply, 2), Some(reply.clone()));
        assert_eq!(find_response(&reply, 3), None);
        let batch = json!([{"jsonrpc":"2.0","method":"notifications/progress"}, reply.clone()]);
        assert_eq!(find_response(&batch, 2), Some(reply));
    }

    #[test]
    fn find_response_skips_requests_and_notifications() {
        // A server request that happens to reuse the id has no result or error.
        let request = json!({"jsonrpc":"2.0","id":2,"method":"ping"});
        assert_eq!(find_response(&request, 2), None);
        let error = json!({"jsonrpc":"2.0","id":2,"error":{"code":-1,"message":"no"}});
        assert_eq!(find_response(&error, 2), Some(error));
    }

    #[test]
    fn urls_must_be_http_or_https() {
        assert!(parse_url("s", "https://example.com/mcp").is_ok());
        assert!(parse_url("s", "http://localhost:3000/sse").is_ok());
        assert!(parse_url("s", "file:///etc/passwd")
            .unwrap_err()
            .contains("http or https"));
        assert!(parse_url("s", "not a url")
            .unwrap_err()
            .contains("invalid url"));
    }

    #[test]
    fn headers_must_be_valid_and_our_headers_win() {
        let user = HashMap::from([
            ("Authorization".to_string(), "Bearer t".to_string()),
            ("Accept".to_string(), "text/plain".to_string()),
        ]);
        let parsed = parse_headers("s", &user).unwrap();
        let sent = request_headers(&parsed, "application/json, text/event-stream", true);
        assert_eq!(
            sent.get(ACCEPT).unwrap(),
            "application/json, text/event-stream"
        );
        assert_eq!(sent.get("authorization").unwrap(), "Bearer t");
        assert!(parse_headers(
            "s",
            &HashMap::from([("bad name".to_string(), "v".to_string())])
        )
        .is_err());
        assert!(parse_headers(
            "s",
            &HashMap::from([("X".to_string(), "line\nbreak".to_string())])
        )
        .is_err());
    }
}
