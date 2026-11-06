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
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
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

/// Copy bytes both ways until either side closes or `Msg::Stop` arrives.
async fn relay<S: AsyncRead + AsyncWrite + Unpin>(
    stream: S,
    mut rx: mpsc::UnboundedReceiver<Msg>,
    mut on_data: impl FnMut(Vec<u8>),
) {
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        tokio::select! {
            read = reader.read(&mut buf) => match read {
                Ok(0) | Err(_) => break,
                Ok(n) => on_data(buf[..n].to_vec()),
            },
            msg = rx.recv() => match msg {
                Some(Msg::Data(bytes)) => {
                    if writer.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Some(Msg::Stop) | None => break,
            },
        }
    }
}

/// Bind the endpoint, spawn `node host_script`, accept its connection and relay until it ends.
/// `on_data` receives bytes from the host; the returned sender writes bytes to it.
pub async fn start_host(
    node: &str,
    host_script: &PathBuf,
    on_data: impl FnMut(Vec<u8>) + Send + 'static,
    on_close: impl FnOnce() + Send + 'static,
) -> Result<mpsc::UnboundedSender<Msg>, String> {
    let name = endpoint_name(&uuid::Uuid::new_v4().to_string());
    let listener = Listener::bind(&name).map_err(|e| format!("bind {name}: {e}"))?;

    let mut command = Command::new(node);
    command
        .arg(host_script)
        .arg("--type=extensionHost")
        .env("VSCODE_EXTHOST_IPC_HOOK", &name)
        .env("VSCODE_HANDLES_UNCAUGHT_ERRORS", "true")
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|e| format!("spawn {node}: {e}"))?;

    let accepted = tokio::time::timeout(ACCEPT_TIMEOUT, listener.accept()).await;
    let stream = match accepted {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => {
            let _ = child.kill().await;
            return Err(format!("accept: {e}"));
        }
        Err(_) => {
            let _ = child.kill().await;
            return Err("extension host did not connect in time".to_string());
        }
    };

    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        relay(stream, rx, on_data).await;
        let _ = child.kill().await;
        on_close();
    });
    Ok(tx)
}

fn resolve_real_host_script(app: &AppHandle) -> PathBuf {
    if let Ok(p) = app.path().resolve(
        "extension-host/real-host.cjs",
        tauri::path::BaseDirectory::Resource,
    ) {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("extension-host/real-host.cjs")
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

    #[tokio::test]
    async fn relay_copies_bytes_both_ways_and_stops() {
        let (client, server) = tokio::io::duplex(1024);
        let (tx, rx) = mpsc::unbounded_channel();
        let received = std::sync::Arc::new(Mutex::new(Vec::new()));
        let sink = received.clone();
        let task = tokio::spawn(relay(server, rx, move |bytes| {
            sink.lock().unwrap().extend(bytes);
        }));

        let (mut client_read, mut client_write) = tokio::io::split(client);
        client_write.write_all(b"from host").await.unwrap();
        tx.send(Msg::Data(b"to host".to_vec())).unwrap();

        let mut echoed = [0u8; 7];
        client_read.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"to host");

        tx.send(Msg::Stop).unwrap();
        task.await.unwrap();
        assert_eq!(received.lock().unwrap().as_slice(), b"from host");
    }

    #[tokio::test]
    async fn relay_ends_when_peer_closes() {
        let (client, server) = tokio::io::duplex(64);
        let (_tx, rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(relay(server, rx, |_| {}));
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
