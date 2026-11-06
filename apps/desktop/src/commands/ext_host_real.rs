//! Byte relay between VS Code's real extension host (a Node process built from the 1.144 sources,
//! see `scripts/ext-host/build.mjs`) and the webview.
//!
//! The real host speaks VS Code's `PersistentProtocol` over a local socket (`VSCODE_EXTHOST_IPC_HOOK`).
//! Rust does not parse that protocol: it owns the process and the socket, forwards raw bytes to the
//! webview as `sidex-exthost-real-data` events and writes bytes it receives from the webview back to the
//! socket. The webview runs the protocol and the real `mainThread*` classes.

use crate::commands::extension_platform::resolve_node_runtime;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

const ACCEPT_TIMEOUT: Duration = Duration::from_secs(30);

pub const EVENT_DATA: &str = "sidex-exthost-real-data";
pub const EVENT_CLOSE: &str = "sidex-exthost-real-close";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub enum Msg {
    Data(Vec<u8>),
    Stop,
}

#[derive(Default)]
pub struct RealExtHostState {
    sessions: Mutex<HashMap<String, mpsc::UnboundedSender<Msg>>>,
}

#[derive(Serialize, Clone)]
struct DataEvent {
    id: String,
    /// Base64 of the raw bytes read from the host's socket.
    data: String,
}

#[derive(Serialize, Clone)]
struct CloseEvent {
    id: String,
}

trait Duplex: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Duplex for T {}

/// Name of the local endpoint the host connects to.
fn endpoint_name(id: &str) -> String {
    let short = &id[..8.min(id.len())];
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\sidex-exthost-{}-{short}", std::process::id())
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!("sidex-eh-{}-{short}.sock", std::process::id()))
            .to_string_lossy()
            .into_owned()
    }
}

#[cfg(not(windows))]
struct Listener {
    inner: tokio::net::UnixListener,
    path: String,
}

#[cfg(not(windows))]
impl Listener {
    fn bind(name: &str) -> std::io::Result<Self> {
        let _ = std::fs::remove_file(name);
        Ok(Self {
            inner: tokio::net::UnixListener::bind(name)?,
            path: name.to_string(),
        })
    }

    /// Consumes the listener: once the host is connected the socket file is no longer needed.
    async fn accept(self) -> std::io::Result<Box<dyn Duplex>> {
        let (stream, _) = self.inner.accept().await?;
        Ok(Box::new(stream))
    }
}

#[cfg(not(windows))]
impl Drop for Listener {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(windows)]
struct Listener {
    inner: tokio::net::windows::named_pipe::NamedPipeServer,
}

#[cfg(windows)]
impl Listener {
    fn bind(name: &str) -> std::io::Result<Self> {
        Ok(Self {
            inner: tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(true)
                .create(name)?,
        })
    }

    async fn accept(self) -> std::io::Result<Box<dyn Duplex>> {
        self.inner.connect().await?;
        Ok(Box::new(self.inner))
    }
}

/// How often the relay reports traffic while it is moving.
const PROGRESS_INTERVAL: Duration = Duration::from_secs(10);

/// Bytes moved in each direction over a relay's lifetime.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct RelayStats {
    from_host: u64,
    to_host: u64,
}

/// Copy bytes both ways until either side closes or `Msg::Stop` arrives. Logs the first chunk in each
/// direction and periodic totals, so the terminal shows how far the handshake and RPC traffic got
/// without depending on the webview's log level.
async fn relay<S: AsyncRead + AsyncWrite + Unpin>(
    label: &str,
    stream: S,
    mut rx: mpsc::UnboundedReceiver<Msg>,
    mut on_data: impl FnMut(Vec<u8>),
) -> RelayStats {
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut buf = vec![0u8; 64 * 1024];
    let mut stats = RelayStats::default();
    let mut reported = stats;
    let mut progress = tokio::time::interval(PROGRESS_INTERVAL);
    progress.tick().await;
    loop {
        tokio::select! {
            read = reader.read(&mut buf) => match read {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if stats.from_host == 0 {
                        log::info!("[ext-host-real] {label}: first {n} bytes from the host");
                    }
                    stats.from_host += n as u64;
                    on_data(buf[..n].to_vec());
                }
            },
            msg = rx.recv() => match msg {
                Some(Msg::Data(bytes)) => {
                    if stats.to_host == 0 {
                        log::info!("[ext-host-real] {label}: first {} bytes from the webview", bytes.len());
                    }
                    stats.to_host += bytes.len() as u64;
                    if writer.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Some(Msg::Stop) | None => break,
            },
            _ = progress.tick() => {
                if stats != reported {
                    log::info!(
                        "[ext-host-real] {label}: {} bytes from the host, {} to the host so far",
                        stats.from_host,
                        stats.to_host
                    );
                    reported = stats;
                }
            }
        }
    }
    stats
}

/// Cap on the host's stderr kept for error messages.
const STDERR_TAIL_BYTES: usize = 8 * 1024;

/// Log the host's stderr line by line and keep the most recent lines for error messages.
fn forward_stderr(stderr: tokio::process::ChildStderr) -> Arc<Mutex<String>> {
    let tail = Arc::new(Mutex::new(String::new()));
    let sink = tail.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log::warn!("[ext-host-real] {line}");
            if let Ok(mut kept) = sink.lock() {
                kept.push_str(&line);
                kept.push('\n');
                while kept.len() > STDERR_TAIL_BYTES {
                    match kept.find('\n') {
                        Some(end) => {
                            kept.drain(..=end);
                        }
                        None => kept.clear(),
                    }
                }
            }
        }
    });
    tail
}

/// Append what the host wrote to stderr (after a moment for the reader to catch up) to `reason`.
async fn with_stderr(reason: String, tail: &Mutex<String>) -> String {
    tokio::time::sleep(Duration::from_millis(200)).await;
    let kept = tail.lock().map(|t| t.clone()).unwrap_or_default();
    if kept.trim().is_empty() {
        reason
    } else {
        format!("{reason}\n{}", kept.trim_end())
    }
}

/// Bind the endpoint, spawn `node host_script`, accept its connection and relay until it ends.
/// `on_data` receives bytes from the host; the returned sender writes bytes to it. If the host exits
/// or does not connect, the error carries its exit status and what it wrote to stderr.
pub async fn start_host(
    node: &str,
    host_script: &PathBuf,
    on_data: impl FnMut(Vec<u8>) + Send + 'static,
    on_close: impl FnOnce() + Send + 'static,
) -> Result<mpsc::UnboundedSender<Msg>, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let label = id[..8].to_string();
    let name = endpoint_name(&id);
    let listener = Listener::bind(&name).map_err(|e| format!("bind {name}: {e}"))?;

    let mut command = Command::new(node);
    command
        .arg(host_script)
        .arg("--type=extensionHost")
        .env("VSCODE_EXTHOST_IPC_HOOK", &name)
        .env("VSCODE_HANDLES_UNCAUGHT_ERRORS", "true")
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn {node} {}: {e}", host_script.display()))?;
    let stderr_tail = child.stderr.take().map(forward_stderr);

    let outcome = tokio::select! {
        accepted = tokio::time::timeout(ACCEPT_TIMEOUT, listener.accept()) => match accepted {
            Ok(Ok(stream)) => Ok(stream),
            Ok(Err(e)) => Err(format!("accept: {e}")),
            Err(_) => Err("extension host did not connect in time".to_string()),
        },
        status = child.wait() => Err(match status {
            Ok(status) => format!("extension host exited before connecting ({status})"),
            Err(e) => format!("waiting for the extension host failed: {e}"),
        }),
    };
    let stream = match outcome {
        Ok(stream) => stream,
        Err(reason) => {
            let _ = child.kill().await;
            return Err(match &stderr_tail {
                Some(tail) => with_stderr(reason, tail).await,
                None => reason,
            });
        }
    };

    let (tx, rx) = mpsc::unbounded_channel();
    log::info!("[ext-host-real] {label}: host connected");
    tokio::spawn(async move {
        let stats = relay(&label, stream, rx, on_data).await;
        log::info!(
            "[ext-host-real] {label}: closed after {} bytes from the host and {} to it",
            stats.from_host,
            stats.to_host
        );
        let _ = child.kill().await;
        on_close();
    });
    Ok(tx)
}

/// Node's CJS resolver fails on a `\\?\E:\...` main script (`EISDIR ... lstat 'E:'`), and Tauri's
/// resource lookup returns that form on Windows, so hand Node the plain drive-letter path.
fn node_script_path(path: &Path) -> PathBuf {
    dunce::simplified(path).to_path_buf()
}

fn resolve_real_host_script(app: &AppHandle) -> PathBuf {
    if let Ok(p) = app.path().resolve(
        "extension-host/real-host.cjs",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return node_script_path(&p);
        }
    }
    node_script_path(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("extension-host/real-host.cjs"),
    )
}

/// Start the real extension host. Returns a session id; bytes flow through
/// `sidex-exthost-real-data` / `sidex-exthost-real-close` events and `ext_host_real_send`.
#[tauri::command]
pub async fn ext_host_real_start(
    app: AppHandle,
    state: State<'_, RealExtHostState>,
) -> Result<String, String> {
    let script = resolve_real_host_script(&app);
    if !script.exists() {
        return Err(format!(
            "real extension host bundle not found at {} (run `bun run build:ext-host`)",
            script.display()
        ));
    }
    let node = resolve_node_runtime(&app)?;
    let id = uuid::Uuid::new_v4().to_string();

    let data_app = app.clone();
    let data_id = id.clone();
    let close_app = app.clone();
    let close_id = id.clone();
    let tx = start_host(
        &node.path,
        &script,
        move |bytes| {
            let _ = data_app.emit(
                EVENT_DATA,
                DataEvent {
                    id: data_id.clone(),
                    data: STANDARD.encode(bytes),
                },
            );
        },
        move || {
            if let Some(state) = close_app.try_state::<RealExtHostState>() {
                if let Ok(mut sessions) = state.sessions.lock() {
                    sessions.remove(&close_id);
                }
            }
            let _ = close_app.emit(EVENT_CLOSE, CloseEvent { id: close_id });
        },
    )
    .await?;

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), tx);
    Ok(id)
}

/// Write bytes (base64) to the host's socket.
#[tauri::command]
pub async fn ext_host_real_send(
    state: State<'_, RealExtHostState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let tx = sessions
        .get(&id)
        .ok_or_else(|| format!("unknown extension host session {id}"))?;
    tx.send(Msg::Data(bytes))
        .map_err(|_| "extension host session closed".to_string())
}

/// Stop the host and close its socket.
#[tauri::command]
pub async fn ext_host_real_stop(
    state: State<'_, RealExtHostState>,
    id: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(tx) = sessions.remove(&id) {
        let _ = tx.send(Msg::Stop);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn node_script_path_drops_the_verbatim_prefix() {
        let path = node_script_path(Path::new(r"\\?\E:\editor\sidex\real-host.cjs"));
        assert_eq!(path, PathBuf::from(r"E:\editor\sidex\real-host.cjs"));
    }

    #[test]
    fn node_script_path_leaves_plain_paths_alone() {
        let path = PathBuf::from("extension-host/real-host.cjs");
        assert_eq!(node_script_path(&path), path);
    }

    #[tokio::test]
    async fn a_host_that_exits_early_reports_its_stderr() {
        let script =
            std::env::temp_dir().join(format!("sidex-exthost-fail-{}.js", std::process::id()));
        std::fs::write(&script, "console.error('boom from host'); process.exit(3);").unwrap();
        let result = start_host("node", &script, |_| {}, || {}).await;
        let _ = std::fs::remove_file(&script);
        let err = result.expect_err("host exits before connecting");
        assert!(err.contains("exited before connecting"), "{err}");
        assert!(err.contains("boom from host"), "{err}");
    }

    #[tokio::test]
    async fn relay_copies_bytes_both_ways_and_stops() {
        let (client, server) = tokio::io::duplex(1024);
        let (tx, rx) = mpsc::unbounded_channel();
        let received = std::sync::Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let task = tokio::spawn(relay("test", server, rx, move |bytes| {
            sink.lock().unwrap().extend(bytes);
        }));

        let (mut client_read, mut client_write) = tokio::io::split(client);
        client_write.write_all(b"from host").await.unwrap();
        tx.send(Msg::Data(b"to host".to_vec())).unwrap();

        let mut echoed = [0u8; 7];
        client_read.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"to host");

        tx.send(Msg::Stop).unwrap();
        let stats = task.await.unwrap();
        assert_eq!(received.lock().unwrap().as_slice(), b"from host");
        assert_eq!(
            stats,
            RelayStats {
                from_host: 9,
                to_host: 7
            }
        );
    }

    #[tokio::test]
    async fn relay_ends_when_peer_closes() {
        let (client, server) = tokio::io::duplex(64);
        let (_tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(relay("test", server, rx, |_| {}));
        drop(client);
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .expect("relay should end")
            .unwrap();
    }

    /// Needs the bundle from `bun run build:ext-host` and Node; set `SIDEX_REAL_EXT_HOST_BUNDLE`.
    /// The real host speaks first (a Ready control message), so receiving bytes proves the spawn,
    /// the socket and the relay work together.
    #[tokio::test]
    async fn real_host_connects_and_sends_ready() {
        let Ok(bundle) = std::env::var("SIDEX_REAL_EXT_HOST_BUNDLE") else {
            eprintln!("SIDEX_REAL_EXT_HOST_BUNDLE not set; skipping");
            return;
        };
        let (data_tx, mut data_rx) = mpsc::unbounded_channel();
        let (closed_tx, mut closed_rx) = mpsc::unbounded_channel();
        let tx = start_host(
            "node",
            &PathBuf::from(bundle),
            move |bytes| {
                let _ = data_tx.send(bytes);
            },
            move || {
                let _ = closed_tx.send(());
            },
        )
        .await
        .expect("start host");
        let first = tokio::time::timeout(Duration::from_secs(20), data_rx.recv())
            .await
            .expect("host should send its handshake")
            .expect("channel open");
        assert_ne!(first.len(), 0, "host sent an empty first chunk");
        tx.send(Msg::Stop).unwrap();
        tokio::time::timeout(Duration::from_secs(10), closed_rx.recv())
            .await
            .expect("close callback after stop");
    }
}
