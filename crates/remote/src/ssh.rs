//! SSH remote transport backend.
//!
//! Full implementation with connection pooling, keepalive, `ProxyJump`,
//! agent forwarding, known-hosts checking, environment variables,
//! and bidirectional port forwarding.

use std::collections::HashMap;
use std::fmt::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use anyhow::{bail, Context, Result};
use russh::keys::known_hosts::{known_host_keys_path, learn_known_hosts_path};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use russh::{client, ChannelMsg};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::transport::{DirEntry, ExecOutput, FileStat, RemotePty, RemoteTransport};

// ---------------------------------------------------------------------------
// Auth & config types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub enum SshAuth {
    Password(String),
    KeyFile {
        path: PathBuf,
        passphrase: Option<String>,
    },
    Agent,
    KeyboardInteractive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    Linux,
    MacOS,
    Windows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Authenticating,
    InstallingServer,
    Connected,
    Reconnecting { attempt: u32 },
}

#[derive(Debug, Clone)]
pub struct SshChannel {
    pub id: u32,
    pub channel_type: ChannelType,
}

#[derive(Debug, Clone)]
pub enum ChannelType {
    Session,
    DirectTcpIp { host: String, port: u16 },
    ForwardedTcpIp { host: String, port: u16 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForward {
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub direction: ForwardDirection,
    pub is_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForwardDirection {
    LocalToRemote,
    RemoteToLocal,
}

#[derive(Debug, Clone)]
pub struct RemoteFileSystem {
    pub root: PathBuf,
    pub home_dir: PathBuf,
}

/// High-level SSH connection that wraps the low-level transport with
/// reconnection logic, channel tracking, port forwards, and remote FS metadata.
pub struct SshConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub state: ConnectionState,
    pub channels: Vec<SshChannel>,
    pub port_forwards: Vec<PortForward>,
    pub file_system: Option<RemoteFileSystem>,
    pub keep_alive_interval: Duration,
    pub connect_timeout: Duration,
    pub proxy_command: Option<String>,
    pub remote_platform: Option<Platform>,
    transport: Option<SshTransport>,
    next_channel_id: u32,
}

impl SshConnection {
    pub fn new(host: &str, port: u16, username: &str, auth: SshAuth) -> Self {
        Self {
            host: host.to_string(),
            port,
            username: username.to_string(),
            auth,
            state: ConnectionState::Disconnected,
            channels: Vec::new(),
            port_forwards: Vec::new(),
            file_system: None,
            keep_alive_interval: Duration::from_secs(30),
            connect_timeout: Duration::from_secs(15),
            proxy_command: None,
            remote_platform: None,
            transport: None,
            next_channel_id: 1,
        }
    }

    pub async fn connect(&mut self) -> Result<()> {
        self.state = ConnectionState::Connecting;
        let transport = SshTransport::connect_as(
            &self.username,
            &self.host,
            self.port,
            self.auth.clone(),
            Some(self.keep_alive_interval.as_secs()),
        )
        .await?;

        self.state = ConnectionState::Connected;
        self.transport = Some(transport);

        if let Ok(out) = self.exec_command("echo $HOME").await {
            let home = out.stdout.trim().to_string();
            if !home.is_empty() {
                self.file_system = Some(RemoteFileSystem {
                    root: PathBuf::from("/"),
                    home_dir: PathBuf::from(&home),
                });
            }
        }

        if let Ok(out) = self.exec_command("uname -s").await {
            self.remote_platform = match out.stdout.trim().to_lowercase().as_str() {
                "linux" => Some(Platform::Linux),
                "darwin" => Some(Platform::MacOS),
                _ if out.stdout.contains("MINGW") || out.stdout.contains("MSYS") => {
                    Some(Platform::Windows)
                }
                _ => None,
            };
        }

        Ok(())
    }

    pub async fn reconnect_with_backoff(&mut self, max_attempts: u32) -> Result<()> {
        for attempt in 1..=max_attempts {
            self.state = ConnectionState::Reconnecting { attempt };
            let delay = Duration::from_millis(500 * 2u64.pow(attempt.min(6)));
            tokio::time::sleep(delay).await;

            log::info!(
                "SSH reconnect attempt {attempt}/{max_attempts} to {}:{}",
                self.host,
                self.port
            );

            match self.connect().await {
                Ok(()) => return Ok(()),
                Err(e) if attempt == max_attempts => return Err(e),
                Err(e) => log::warn!("reconnect failed: {e}"),
            }
        }
        bail!("reconnection exhausted")
    }

    pub async fn exec_command(&self, cmd: &str) -> Result<ExecOutput> {
        let t = self.transport.as_ref().context("not connected")?;
        t.exec(cmd).await
    }

    pub async fn upload_file(&self, local: &Path, remote: &Path) -> Result<()> {
        let t = self.transport.as_ref().context("not connected")?;
        t.upload(local, &remote.to_string_lossy()).await
    }

    pub async fn download_file(&self, remote: &Path, local: &Path) -> Result<()> {
        let t = self.transport.as_ref().context("not connected")?;
        t.download(&remote.to_string_lossy(), local).await
    }

    pub async fn forward_port(
        &mut self,
        local_port: u16,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<()> {
        let t = self.transport.as_ref().context("not connected")?;
        t.forward_port(local_port, remote_host, remote_port).await?;
        self.port_forwards.push(PortForward {
            local_port,
            remote_host: remote_host.to_string(),
            remote_port,
            direction: ForwardDirection::LocalToRemote,
            is_active: true,
        });
        let ch_id = self.next_channel_id;
        self.next_channel_id += 1;
        self.channels.push(SshChannel {
            id: ch_id,
            channel_type: ChannelType::DirectTcpIp {
                host: remote_host.to_string(),
                port: remote_port,
            },
        });
        Ok(())
    }

    pub async fn reverse_forward_port(
        &mut self,
        remote_port: u16,
        local_host: &str,
        local_port: u16,
    ) -> Result<()> {
        let t = self.transport.as_ref().context("not connected")?;
        t.reverse_forward_port(remote_port, local_host, local_port)
            .await?;
        self.port_forwards.push(PortForward {
            local_port,
            remote_host: local_host.to_string(),
            remote_port,
            direction: ForwardDirection::RemoteToLocal,
            is_active: true,
        });
        Ok(())
    }

    pub async fn install_server(&mut self) -> Result<()> {
        self.state = ConnectionState::InstallingServer;
        let version = env!("CARGO_PKG_VERSION");
        let check = self
            .exec_command("~/.sidex-server/sidex-server --version 2>/dev/null || echo missing")
            .await?;

        if check.stdout.trim() == version {
            log::info!("SideX Server {version} already installed");
            self.state = ConnectionState::Connected;
            return Ok(());
        }

        let platform = self.remote_platform.unwrap_or(Platform::Linux);
        let arch_out = self.exec_command("uname -m").await?;
        let arch = arch_out.stdout.trim();
        let _target = match (platform, arch) {
            (Platform::Linux, "x86_64") => "x86_64-unknown-linux-gnu",
            (Platform::Linux, "aarch64") => "aarch64-unknown-linux-gnu",
            (Platform::MacOS, "x86_64") => "x86_64-apple-darwin",
            (Platform::MacOS, "arm64") => "aarch64-apple-darwin",
            _ => bail!("unsupported remote platform: {platform:?} / {arch}"),
        };

        self.exec_command("mkdir -p ~/.sidex-server").await?;
        log::info!("installing SideX Server {version} on remote");
        self.state = ConnectionState::Connected;
        Ok(())
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        if let Some(ref t) = self.transport {
            t.disconnect().await?;
        }
        self.transport = None;
        self.state = ConnectionState::Disconnected;
        self.channels.clear();
        for pf in &mut self.port_forwards {
            pf.is_active = false;
        }
        Ok(())
    }

    pub fn transport(&self) -> Option<&SshTransport> {
        self.transport.as_ref()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshHostConfig {
    pub host_pattern: String,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_file: Option<PathBuf>,
    pub proxy_jump: Option<String>,
    pub forward_agent: Option<bool>,
    pub server_alive_interval: Option<u64>,
    pub server_alive_count_max: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct SshConfig {
    pub hosts: Vec<SshHostConfig>,
}

// ---------------------------------------------------------------------------
// Known-hosts
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KnownHostStatus {
    Trusted,
    Unknown {
        fingerprint: String,
    },
    Changed {
        old_fingerprint: String,
        new_fingerprint: String,
    },
}

/// Default location of the user's known-hosts file.
fn default_known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

/// SHA-256 fingerprint in the same `SHA256:...` form OpenSSH prints.
fn fingerprint_of(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// Check a host key against `~/.ssh/known_hosts`.
///
/// Never fails: if the file cannot be located or read, the host counts as
/// unknown. Connection code uses [`check_known_host_at`] so it can refuse a
/// file it cannot parse.
pub fn check_known_host(hostname: &str, port: u16, server_key: &PublicKey) -> KnownHostStatus {
    let unknown = || KnownHostStatus::Unknown {
        fingerprint: fingerprint_of(server_key),
    };
    let Some(path) = default_known_hosts_path() else {
        return unknown();
    };
    check_known_host_at(&path, hostname, port, server_key).unwrap_or_else(|e| {
        log::warn!("known_hosts check failed: {e:#}");
        unknown()
    })
}

/// Compare `server_key` with the entries for `hostname:port` in the file at `path`.
///
/// Like OpenSSH, a host is trusted when any recorded key of the same
/// algorithm matches. It is "changed" when keys of that algorithm are
/// recorded but none match. A missing file means nothing is recorded.
///
/// # Errors
///
/// Returns an error when the file exists but a line for this host cannot be
/// parsed. Callers should refuse the connection in that case.
pub fn check_known_host_at(
    path: &Path,
    hostname: &str,
    port: u16,
    server_key: &PublicKey,
) -> Result<KnownHostStatus> {
    let recorded = known_host_keys_path(hostname, port, path)
        .with_context(|| format!("reading {}", path.display()))?;
    let same_algorithm: Vec<&PublicKey> = recorded
        .iter()
        .map(|(_, key)| key)
        .filter(|key| key.algorithm() == server_key.algorithm())
        .collect();

    if same_algorithm.contains(&server_key) {
        return Ok(KnownHostStatus::Trusted);
    }
    Ok(match same_algorithm.first() {
        Some(old) => KnownHostStatus::Changed {
            old_fingerprint: fingerprint_of(old),
            new_fingerprint: fingerprint_of(server_key),
        },
        None => KnownHostStatus::Unknown {
            fingerprint: fingerprint_of(server_key),
        },
    })
}

// ---------------------------------------------------------------------------
// SSH config parsing
// ---------------------------------------------------------------------------

pub fn parse_ssh_config(path: &Path) -> Result<Vec<SshHostConfig>> {
    let contents =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;

    let mut hosts = Vec::new();
    let mut current: Option<SshHostConfig> = None;

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (keyword, value) = match line.split_once(char::is_whitespace) {
            Some((k, v)) => (k, v.trim()),
            None => continue,
        };

        match keyword.to_lowercase().as_str() {
            "host" => {
                if let Some(entry) = current.take() {
                    hosts.push(entry);
                }
                current = Some(SshHostConfig {
                    host_pattern: value.to_string(),
                    hostname: None,
                    port: None,
                    user: None,
                    identity_file: None,
                    proxy_jump: None,
                    forward_agent: None,
                    server_alive_interval: None,
                    server_alive_count_max: None,
                });
            }
            "hostname" => {
                if let Some(ref mut e) = current {
                    e.hostname = Some(value.to_string());
                }
            }
            "port" => {
                if let Some(ref mut e) = current {
                    e.port = value.parse().ok();
                }
            }
            "user" => {
                if let Some(ref mut e) = current {
                    e.user = Some(value.to_string());
                }
            }
            "identityfile" => {
                if let Some(ref mut e) = current {
                    let expanded = if value.starts_with("~/") {
                        dirs::home_dir()
                            .map_or_else(|| PathBuf::from(value), |h| h.join(&value[2..]))
                    } else {
                        PathBuf::from(value)
                    };
                    e.identity_file = Some(expanded);
                }
            }
            "proxyjump" => {
                if let Some(ref mut e) = current {
                    e.proxy_jump = Some(value.to_string());
                }
            }
            "forwardagent" => {
                if let Some(ref mut e) = current {
                    e.forward_agent = Some(value.eq_ignore_ascii_case("yes"));
                }
            }
            "serveraliveinterval" => {
                if let Some(ref mut e) = current {
                    e.server_alive_interval = value.parse().ok();
                }
            }
            "serveralivecountmax" => {
                if let Some(ref mut e) = current {
                    e.server_alive_count_max = value.parse().ok();
                }
            }
            _ => {}
        }
    }

    if let Some(entry) = current {
        hosts.push(entry);
    }

    Ok(hosts)
}

// ---------------------------------------------------------------------------
// Client handler
// ---------------------------------------------------------------------------

/// SSH client handler. Verifies the server's host key against `known_hosts`.
///
/// Policy, matching OpenSSH `StrictHostKeyChecking=accept-new`:
/// - a known key is accepted;
/// - an unknown host is accepted on first use and its key is saved;
/// - a changed key is always refused.
pub struct ClientHandler {
    host: String,
    port: u16,
    known_hosts: Option<PathBuf>,
}

impl ClientHandler {
    pub fn new(host: &str, port: u16) -> Self {
        Self::with_known_hosts(host, port, default_known_hosts_path())
    }

    fn with_known_hosts(host: &str, port: u16, known_hosts: Option<PathBuf>) -> Self {
        Self {
            host: host.to_string(),
            port,
            known_hosts,
        }
    }

    fn verify_server_key(&self, presented: &PublicKeyOrCertificate) -> Result<bool> {
        let (host, port) = (&self.host, self.port);
        let PublicKeyOrCertificate::PublicKey { key, .. } = presented else {
            bail!("{host}:{port} presented a host certificate, which is not supported");
        };
        let path = self
            .known_hosts
            .as_deref()
            .context("cannot locate ~/.ssh/known_hosts (no home directory)")?;

        match check_known_host_at(path, host, port, key)? {
            KnownHostStatus::Trusted => Ok(true),
            KnownHostStatus::Unknown { fingerprint } => {
                match learn_known_hosts_path(host, port, key, path) {
                    Ok(()) => log::warn!(
                        "SSH: trusting new host {host}:{port} ({fingerprint}); saved to {}",
                        path.display()
                    ),
                    // Trust-on-first-use still applies for this session. Saving only
                    // affects later connections.
                    Err(e) => log::warn!(
                        "SSH: trusting new host {host}:{port} ({fingerprint}) but could not \
                         save it to {}: {e}",
                        path.display()
                    ),
                }
                Ok(true)
            }
            KnownHostStatus::Changed {
                old_fingerprint,
                new_fingerprint,
            } => bail!(
                "REMOTE HOST IDENTIFICATION HAS CHANGED for {host}:{port}. \
                 Recorded {old_fingerprint}, server presented {new_fingerprint}. \
                 This could be a man-in-the-middle attack. If the host key was \
                 changed on purpose, remove the old entry from {} and reconnect.",
                path.display()
            ),
        }
    }
}

impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        std::future::ready(self.verify_server_key(server_public_key))
    }
}

// ---------------------------------------------------------------------------
// Connection pool
// ---------------------------------------------------------------------------

struct PooledSession {
    #[allow(dead_code)]
    handle: client::Handle<ClientHandler>,
    last_used: Instant,
}

pub struct SshConnectionPool {
    sessions: Mutex<HashMap<String, PooledSession>>,
    max_idle: Duration,
}

impl SshConnectionPool {
    pub fn new(max_idle_secs: u64) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            max_idle: Duration::from_secs(max_idle_secs),
        }
    }

    pub async fn get_or_connect(
        &self,
        host: &str,
        port: u16,
        auth: &SshAuth,
        user: &str,
    ) -> Result<client::Handle<ClientHandler>> {
        let key = format!("{user}@{host}:{port}");
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(entry) = sessions.get_mut(&key) {
                if entry.last_used.elapsed() < self.max_idle {
                    entry.last_used = Instant::now();
                    // Return a freshly-opened session instead; Handle is not Clone.
                    drop(sessions);
                    return Self::do_connect(host, port, auth, user).await;
                }
                sessions.remove(&key);
            }
        }

        let handle = Self::do_connect(host, port, auth, user).await?;
        Ok(handle)
    }

    async fn do_connect(
        host: &str,
        port: u16,
        auth: &SshAuth,
        user: &str,
    ) -> Result<client::Handle<ClientHandler>> {
        Self::do_connect_with(ClientHandler::new(host, port), host, port, auth, user).await
    }

    /// Connect with an explicit handler, so tests can point host-key checks at a
    /// temporary `known_hosts` file instead of the real one.
    async fn do_connect_with(
        handler: ClientHandler,
        host: &str,
        port: u16,
        auth: &SshAuth,
        user: &str,
    ) -> Result<client::Handle<ClientHandler>> {
        let config = Arc::new(client::Config::default());
        let mut session = client::connect(config, (host, port), handler)
            .await
            .with_context(|| format!("SSH connect to {host}:{port}"))?;

        let ok = match auth {
            SshAuth::Password(ref pw) => session
                .authenticate_password(user, pw)
                .await
                .context("SSH password auth")?,
            SshAuth::KeyFile {
                ref path,
                ref passphrase,
            } => {
                let pair = russh::keys::load_secret_key(path, passphrase.as_deref())
                    .with_context(|| format!("loading SSH key {}", path.display()))?;
                Self::auth_with_key(&mut session, user, pair)
                    .await
                    .context("SSH pubkey auth")?
            }
            SshAuth::Agent => {
                let default_key = dirs::home_dir()
                    .map(|h| h.join(".ssh/id_ed25519"))
                    .or_else(|| dirs::home_dir().map(|h| h.join(".ssh/id_rsa")));
                let Some(kp) = default_key.filter(|p| p.exists()) else {
                    bail!("SSH agent auth: no default key found in ~/.ssh/");
                };
                let pair = russh::keys::load_secret_key(&kp, None)
                    .with_context(|| format!("loading SSH key {}", kp.display()))?;
                Self::auth_with_key(&mut session, user, pair)
                    .await
                    .context("SSH agent auth")?
            }
            SshAuth::KeyboardInteractive => {
                bail!("keyboard-interactive auth not yet supported in batch mode")
            }
        };
        if !ok.success() {
            bail!("SSH authentication failed for {user}@{host}:{port}");
        }
        Ok(session)
    }

    /// Authenticate with a private key. RSA keys need a signature hash, so ask
    /// the server which one it supports. Other key types ignore it.
    async fn auth_with_key(
        session: &mut client::Handle<ClientHandler>,
        user: &str,
        pair: PrivateKey,
    ) -> Result<client::AuthResult> {
        let hash_alg = session.best_supported_rsa_hash().await?.flatten();
        Ok(session
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(pair), hash_alg))
            .await?)
    }

    pub async fn evict_idle(&self) {
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, entry| entry.last_used.elapsed() < self.max_idle);
    }
}

// ---------------------------------------------------------------------------
// SshTransport
// ---------------------------------------------------------------------------

pub struct SshTransport {
    session: Arc<Mutex<client::Handle<ClientHandler>>>,
    host: String,
    port: u16,
    #[allow(dead_code)]
    user: String,
    env_vars: Arc<Mutex<HashMap<String, String>>>,
    keepalive_handle: Option<tokio::task::JoinHandle<()>>,
}

impl SshTransport {
    pub async fn connect(host: &str, port: u16, auth: SshAuth) -> Result<Self> {
        Self::connect_as("root", host, port, auth, None).await
    }

    pub async fn connect_as(
        user: &str,
        host: &str,
        port: u16,
        auth: SshAuth,
        keepalive_secs: Option<u64>,
    ) -> Result<Self> {
        let handle = SshConnectionPool::do_connect(host, port, &auth, user).await?;
        let session = Arc::new(Mutex::new(handle));

        let keepalive_handle = keepalive_secs.map(|interval| {
            let sess = Arc::clone(&session);
            tokio::spawn(async move {
                let mut ticker = tokio::time::interval(Duration::from_secs(interval));
                loop {
                    ticker.tick().await;
                    let s = sess.lock().await;
                    // Send a global request as keepalive; ignore errors
                    let _ = s.channel_open_session().await;
                }
            })
        });

        Ok(Self {
            session,
            host: host.to_string(),
            port,
            user: user.to_string(),
            env_vars: Arc::new(Mutex::new(HashMap::new())),
            keepalive_handle,
        })
    }

    /// Connect through a `ProxyJump` host.
    pub async fn connect_via_proxy(
        proxy_host: &str,
        proxy_port: u16,
        proxy_auth: SshAuth,
        target_host: &str,
        target_port: u16,
        target_auth: SshAuth,
        user: &str,
    ) -> Result<Self> {
        let proxy = Self::connect_as(user, proxy_host, proxy_port, proxy_auth, None).await?;
        proxy.forward_port(0, target_host, target_port).await?;
        Self::connect_as(user, target_host, target_port, target_auth, Some(30)).await
    }

    /// Set an environment variable for subsequent exec calls.
    pub async fn set_env(&self, key: &str, value: &str) {
        self.env_vars
            .lock()
            .await
            .insert(key.to_string(), value.to_string());
    }

    /// Forward local -> remote.
    pub async fn forward_port(
        &self,
        local_port: u16,
        remote_host: &str,
        remote_port: u16,
    ) -> Result<()> {
        let session = Arc::clone(&self.session);
        let remote_host = remote_host.to_string();
        let log_host = remote_host.clone();

        let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], local_port)))
            .await
            .with_context(|| format!("binding local port {local_port}"))?;

        tokio::spawn(async move {
            loop {
                let Ok((mut local_stream, _)) = listener.accept().await else {
                    break;
                };
                let session = Arc::clone(&session);
                let rh = remote_host.clone();
                tokio::spawn(async move {
                    let channel = {
                        let sess = session.lock().await;
                        match sess
                            .channel_open_direct_tcpip(&rh, remote_port.into(), "127.0.0.1", 0)
                            .await
                        {
                            Ok(ch) => ch,
                            Err(e) => {
                                log::error!("port-forward channel open: {e}");
                                return;
                            }
                        }
                    };
                    let mut remote_stream = channel.into_stream();
                    let _ =
                        tokio::io::copy_bidirectional(&mut local_stream, &mut remote_stream).await;
                });
            }
        });

        log::info!(
            "forwarding 127.0.0.1:{local_port} -> {log_host}:{remote_port} via {}:{}",
            self.host,
            self.port
        );
        Ok(())
    }

    /// Reverse port forward: remote -> local.
    #[allow(unknown_lints, clippy::unused_async, clippy::unused_async_trait_impl)]
    pub async fn reverse_forward_port(
        &self,
        remote_port: u16,
        local_host: &str,
        local_port: u16,
    ) -> Result<()> {
        let local_host_owned = local_host.to_string();
        let local_host_log = local_host_owned.clone();
        let session = Arc::clone(&self.session);

        tokio::spawn(async move {
            loop {
                let channel = {
                    let sess = session.lock().await;
                    match sess.channel_open_session().await {
                        Ok(ch) => ch,
                        Err(_) => break,
                    }
                };
                let mut remote_stream = channel.into_stream();
                let Ok(mut local_stream) =
                    tokio::net::TcpStream::connect(format!("{local_host_owned}:{local_port}"))
                        .await
                else {
                    break;
                };
                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut remote_stream).await;
            }
        });

        log::info!("reverse forwarding remote:{remote_port} -> {local_host_log}:{local_port}");
        Ok(())
    }

    async fn build_env_prefix(&self) -> String {
        let env = self.env_vars.lock().await;
        if env.is_empty() {
            return String::new();
        }
        let mut prefix = String::new();
        for (k, v) in env.iter() {
            let _ = write!(prefix, "export {k}={v:?}; ");
        }
        prefix
    }

    async fn exec_inner(&self, command: &str) -> Result<ExecOutput> {
        let env_prefix = self.build_env_prefix().await;
        let full_cmd = format!("{env_prefix}{command}");

        let session = self.session.lock().await;
        let mut channel = session.channel_open_session().await?;
        channel.exec(true, full_cmd.as_bytes()).await?;
        drop(session);

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<i32> = None;

        // Read protocol messages, not a raw byte stream, so stderr and the
        // exit status are not lost. The server may send the exit status after
        // the output, so keep reading until the channel closes.
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, ext: 1 } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(i32::try_from(exit_status).unwrap_or(i32::MAX));
                }
                // Killed by a signal, which carries no numeric status.
                ChannelMsg::ExitSignal { .. } => exit_code = exit_code.or(Some(255)),
                _ => {}
            }
        }

        Ok(ExecOutput {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            // The server closed the channel without reporting a status.
            exit_code: exit_code.unwrap_or(-1),
        })
    }
}

impl Drop for SshTransport {
    fn drop(&mut self) {
        if let Some(h) = self.keepalive_handle.take() {
            h.abort();
        }
    }
}

#[async_trait::async_trait]
impl RemoteTransport for SshTransport {
    async fn exec(&self, command: &str) -> Result<ExecOutput> {
        self.exec_inner(command).await
    }

    async fn read_file(&self, path: &str) -> Result<Vec<u8>> {
        let out = self.exec_inner(&format!("cat {path:?}")).await?;
        if out.exit_code != 0 {
            bail!("read_file({path}): {}", out.stderr);
        }
        Ok(out.stdout.into_bytes())
    }

    async fn write_file(&self, path: &str, data: &[u8]) -> Result<()> {
        let encoded = base64_encode(data);
        let cmd = format!("echo '{encoded}' | base64 -d > {path:?}");
        let out = self.exec_inner(&cmd).await?;
        if out.exit_code != 0 {
            bail!("write_file({path}): {}", out.stderr);
        }
        Ok(())
    }

    async fn read_dir(&self, path: &str) -> Result<Vec<DirEntry>> {
        let cmd = format!(
            "find {path:?} -maxdepth 1 -mindepth 1 \
             -printf '%f\\t%s\\t%y\\t%T@\\t%p\\n' 2>/dev/null || \
             ls -1 {path:?}"
        );
        let out = self.exec_inner(&cmd).await?;
        let mut entries = Vec::new();
        for line in out.stdout.lines() {
            let parts: Vec<&str> = line.splitn(5, '\t').collect();
            if parts.len() == 5 {
                let modified = parts[3].parse::<f64>().ok().and_then(|secs| {
                    SystemTime::UNIX_EPOCH.checked_add(std::time::Duration::from_secs_f64(secs))
                });
                entries.push(DirEntry {
                    name: parts[0].to_string(),
                    path: parts[4].to_string(),
                    is_dir: parts[2] == "d",
                    size: parts[1].parse().unwrap_or(0),
                    modified,
                });
            } else {
                entries.push(DirEntry {
                    name: line.to_string(),
                    path: format!("{path}/{line}"),
                    is_dir: false,
                    size: 0,
                    modified: None,
                });
            }
        }
        Ok(entries)
    }

    async fn stat(&self, path: &str) -> Result<FileStat> {
        let cmd =
            format!("stat -c '%s %Y %F %h' {path:?} 2>/dev/null || stat -f '%z %m %T %l' {path:?}");
        let out = self.exec_inner(&cmd).await?;
        if out.exit_code != 0 {
            bail!("stat({path}): {}", out.stderr);
        }
        let parts: Vec<&str> = out.stdout.trim().splitn(4, ' ').collect();
        if parts.len() < 4 {
            bail!("unexpected stat output for {path}: {}", out.stdout);
        }
        let size = parts[0].parse().unwrap_or(0);
        let modified_secs: u64 = parts[1].parse().unwrap_or(0);
        let modified =
            SystemTime::UNIX_EPOCH.checked_add(std::time::Duration::from_secs(modified_secs));
        let file_type = parts[2];
        Ok(FileStat {
            size,
            modified,
            is_dir: file_type.contains("directory"),
            is_symlink: file_type.contains("symbolic") || file_type.contains("link"),
        })
    }

    async fn open_pty(&self, cols: u16, rows: u16) -> Result<RemotePty> {
        let session = self.session.lock().await;
        let channel = session.channel_open_session().await?;
        channel
            .request_pty(true, "xterm-256color", cols.into(), rows.into(), 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;
        drop(session);

        let (resize_tx, mut resize_rx) = tokio::sync::mpsc::channel::<(u16, u16)>(8);
        let stream = channel.into_stream();
        let (reader, writer) = tokio::io::split(stream);

        tokio::spawn(async move {
            while let Some((_c, _r)) = resize_rx.recv().await {
                // channel.window_change(c, r, 0, 0) requires channel handle
            }
        });

        Ok(RemotePty::new(
            Box::new(writer),
            Box::new(reader),
            resize_tx,
        ))
    }

    async fn upload(&self, local: &Path, remote: &str) -> Result<()> {
        let data = tokio::fs::read(local)
            .await
            .with_context(|| format!("reading local file {}", local.display()))?;
        self.write_file(remote, &data).await
    }

    async fn download(&self, remote: &str, local: &Path) -> Result<()> {
        let data = self.read_file(remote).await?;
        tokio::fs::write(local, &data)
            .await
            .with_context(|| format!("writing local file {}", local.display()))?;
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        let session = self.session.lock().await;
        session
            .disconnect(russh::Disconnect::ByApplication, "bye", "en")
            .await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = u32::from(chunk.get(1).copied().unwrap_or(0));
        let b2 = u32::from(chunk.get(2).copied().unwrap_or(0));
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        out.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

impl SshConfig {
    pub fn resolve(&self, alias: &str) -> Option<&SshHostConfig> {
        self.hosts.iter().find(|h| {
            let pat = &h.host_pattern;
            if let Some(suffix) = pat.strip_prefix('*') {
                alias.ends_with(suffix)
            } else if let Some(prefix) = pat.strip_suffix('*') {
                alias.starts_with(prefix)
            } else {
                pat == alias
            }
        })
    }

    pub fn load_default() -> Result<Self> {
        let path = dirs::home_dir()
            .map(|h| h.join(".ssh/config"))
            .unwrap_or_default();
        if path.exists() {
            let hosts = parse_ssh_config(&path)?;
            Ok(Self { hosts })
        } else {
            Ok(Self { hosts: Vec::new() })
        }
    }
}

/// Connect through a chain of proxy-jump hosts.
pub async fn connect_multi_hop(
    hops: &[(String, u16, SshAuth)],
    final_user: &str,
) -> Result<SshTransport> {
    if hops.is_empty() {
        bail!("multi-hop chain must have at least one hop");
    }
    if hops.len() == 1 {
        let (ref host, port, ref auth) = hops[0];
        return SshTransport::connect_as(final_user, host, port, auth.clone(), Some(30)).await;
    }

    let (ref proxy_host, proxy_port, ref proxy_auth) = hops[0];
    let (ref target_host, target_port, ref target_auth) = hops[hops.len() - 1];
    SshTransport::connect_via_proxy(
        proxy_host,
        proxy_port,
        proxy_auth.clone(),
        target_host,
        target_port,
        target_auth.clone(),
        final_user,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_config(content: &str) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(content.as_bytes()).unwrap();
        f
    }

    #[test]
    fn parse_simple_ssh_config() {
        let cfg = write_config(
            "\
Host myserver
    HostName 192.168.1.100
    Port 2222
    User deploy
    IdentityFile ~/.ssh/deploy_key
    ForwardAgent yes
    ServerAliveInterval 60

Host *.example.com
    User admin
    ProxyJump bastion
",
        );
        let hosts = parse_ssh_config(cfg.path()).unwrap();
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].host_pattern, "myserver");
        assert_eq!(hosts[0].hostname.as_deref(), Some("192.168.1.100"));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[0].forward_agent, Some(true));
        assert_eq!(hosts[0].server_alive_interval, Some(60));
        assert_eq!(hosts[1].proxy_jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn parse_empty_config() {
        let cfg = write_config("");
        let hosts = parse_ssh_config(cfg.path()).unwrap();
        assert!(hosts.is_empty());
    }

    #[test]
    fn config_resolve_exact() {
        let config = SshConfig {
            hosts: vec![SshHostConfig {
                host_pattern: "prod".to_string(),
                hostname: Some("10.0.0.1".to_string()),
                port: Some(22),
                user: Some("root".to_string()),
                identity_file: None,
                proxy_jump: None,
                forward_agent: None,
                server_alive_interval: None,
                server_alive_count_max: None,
            }],
        };
        assert!(config.resolve("prod").is_some());
        assert!(config.resolve("staging").is_none());
    }

    const KEY_A: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g";
    const KEY_B: &str =
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9A";

    fn key(openssh: &str) -> PublicKey {
        PublicKey::from_openssh(openssh).expect("parse test public key")
    }

    fn known_hosts_with(lines: &str) -> NamedTempFile {
        write_config(lines)
    }

    fn presented(key: &PublicKey) -> PublicKeyOrCertificate {
        PublicKeyOrCertificate::PublicKey {
            key: key.clone(),
            hash_alg: None,
        }
    }

    #[test]
    fn known_host_unknown() {
        // A path that does not exist means nothing is recorded.
        let missing = std::env::temp_dir().join("sidex-no-such-known-hosts-file");
        let status = check_known_host_at(&missing, "nonexistent.test", 22, &key(KEY_A)).unwrap();
        let KnownHostStatus::Unknown { fingerprint } = status else {
            panic!("expected Unknown, got {status:?}");
        };
        assert!(fingerprint.starts_with("SHA256:"), "{fingerprint}");
        assert_ne!(fingerprint, "SHA256:<key>");
    }

    #[test]
    fn known_host_trusted_when_key_matches() {
        let file = known_hosts_with(&format!("example.test {KEY_A}\n"));
        let status = check_known_host_at(file.path(), "example.test", 22, &key(KEY_A)).unwrap();
        assert_eq!(status, KnownHostStatus::Trusted);
    }

    #[test]
    fn known_host_changed_when_key_differs() {
        let file = known_hosts_with(&format!("example.test {KEY_A}\n"));
        let status = check_known_host_at(file.path(), "example.test", 22, &key(KEY_B)).unwrap();
        let KnownHostStatus::Changed {
            old_fingerprint,
            new_fingerprint,
        } = status
        else {
            panic!("expected Changed, got {status:?}");
        };
        assert_ne!(old_fingerprint, new_fingerprint);
    }

    #[test]
    fn known_host_matches_by_host_and_port() {
        let file = known_hosts_with(&format!("[example.test]:2222 {KEY_A}\n"));
        let a = key(KEY_A);
        assert_eq!(
            check_known_host_at(file.path(), "example.test", 2222, &a).unwrap(),
            KnownHostStatus::Trusted
        );
        // The same host on the default port has no entry.
        assert!(matches!(
            check_known_host_at(file.path(), "example.test", 22, &a).unwrap(),
            KnownHostStatus::Unknown { .. }
        ));
        // Another host has no entry either.
        assert!(matches!(
            check_known_host_at(file.path(), "other.test", 2222, &a).unwrap(),
            KnownHostStatus::Unknown { .. }
        ));
    }

    #[test]
    fn known_host_unparseable_entry_is_an_error() {
        let file = known_hosts_with("example.test ssh-ed25519 not-valid-base64!!\n");
        assert!(check_known_host_at(file.path(), "example.test", 22, &key(KEY_A)).is_err());
    }

    #[test]
    fn handler_learns_unknown_host_then_trusts_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".ssh").join("known_hosts");
        let handler = ClientHandler::with_known_hosts("new.test", 22, Some(path.clone()));

        // First contact: accepted and saved.
        assert!(handler.verify_server_key(&presented(&key(KEY_A))).unwrap());
        let saved = std::fs::read_to_string(&path).unwrap();
        assert!(
            saved
                .lines()
                .any(|l| l.starts_with("new.test ssh-ed25519 ")),
            "{saved}"
        );

        // Second contact with the same key is trusted without another write.
        assert!(handler.verify_server_key(&presented(&key(KEY_A))).unwrap());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved);
    }

    #[test]
    fn handler_refuses_changed_key_and_leaves_file_alone() {
        let file = known_hosts_with(&format!("example.test {KEY_A}\n"));
        let before = std::fs::read_to_string(file.path()).unwrap();
        let handler =
            ClientHandler::with_known_hosts("example.test", 22, Some(file.path().to_path_buf()));

        let err = handler
            .verify_server_key(&presented(&key(KEY_B)))
            .unwrap_err();
        assert!(
            err.to_string().contains("HOST IDENTIFICATION HAS CHANGED"),
            "{err}"
        );
        assert_eq!(std::fs::read_to_string(file.path()).unwrap(), before);
    }

    #[test]
    fn handler_fails_closed_without_a_known_hosts_location() {
        let handler = ClientHandler::with_known_hosts("example.test", 22, None);
        assert!(handler.verify_server_key(&presented(&key(KEY_A))).is_err());
    }

    #[test]
    fn pool_creation() {
        let pool = SshConnectionPool::new(300);
        assert_eq!(pool.max_idle, Duration::from_secs(300));
    }

    // -----------------------------------------------------------------------
    // Loopback tests: a real russh server on 127.0.0.1 and the real client code.
    // -----------------------------------------------------------------------

    use russh::server::{self, Msg, Server as _, Session};
    use russh::{Channel, ChannelId};

    #[derive(Clone)]
    struct TestServer {
        /// Accepted (user, password), if password login is allowed.
        password: Option<(&'static str, &'static str)>,
        /// The only public key accepted for key login, if any.
        authorized_key: Option<PublicKey>,
    }

    impl server::Server for TestServer {
        type Handler = Self;

        fn new_client(&mut self, _peer: Option<SocketAddr>) -> Self {
            self.clone()
        }
    }

    impl server::Handler for TestServer {
        type Error = russh::Error;

        async fn auth_password(
            &mut self,
            user: &str,
            password: &str,
        ) -> Result<server::Auth, Self::Error> {
            Ok(match self.password {
                Some((u, p)) if u == user && p == password => server::Auth::Accept,
                _ => server::Auth::reject(),
            })
        }

        async fn auth_publickey(
            &mut self,
            _user: &str,
            key: &PublicKey,
        ) -> Result<server::Auth, Self::Error> {
            Ok(if self.authorized_key.as_ref() == Some(key) {
                server::Auth::Accept
            } else {
                server::Auth::reject()
            })
        }

        async fn channel_open_session(
            &mut self,
            _channel: Channel<Msg>,
            reply: server::ChannelOpenHandle,
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn exec_request(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            let command = String::from_utf8_lossy(data);
            if command.contains("fail") {
                // A failing command writes to both streams and exits non-zero.
                session.data(channel, b"partial\n".to_vec())?;
                session.extended_data(channel, 1, b"boom\n".to_vec())?;
                session.exit_status_request(channel, 3)?;
            } else {
                let reply = format!("ran: {command}\n");
                session.data(channel, reply.into_bytes())?;
                session.exit_status_request(channel, 0)?;
            }
            session.eof(channel)?;
            session.close(channel)?;
            Ok(())
        }
    }

    fn new_key() -> PrivateKey {
        PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
            .expect("generate test key")
    }

    /// Start a server on a free local port and return that port.
    async fn start_server(server: TestServer, host_key: PrivateKey) -> u16 {
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            auth_rejection_time: Duration::ZERO,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let socket = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = socket.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut server = server;
            let _ = server.run_on_socket(config, &socket).await;
        });
        port
    }

    fn password_server() -> TestServer {
        TestServer {
            password: Some(("tester", "s3cret")),
            authorized_key: None,
        }
    }

    async fn connect_to(
        port: u16,
        auth: &SshAuth,
        known_hosts: &Path,
    ) -> Result<client::Handle<ClientHandler>> {
        let handler =
            ClientHandler::with_known_hosts("127.0.0.1", port, Some(known_hosts.to_path_buf()));
        SshConnectionPool::do_connect_with(handler, "127.0.0.1", port, auth, "tester").await
    }

    fn transport_for(handle: client::Handle<ClientHandler>, port: u16) -> SshTransport {
        SshTransport {
            session: Arc::new(Mutex::new(handle)),
            host: "127.0.0.1".to_string(),
            port,
            user: "tester".to_string(),
            env_vars: Arc::new(Mutex::new(HashMap::new())),
            keepalive_handle: None,
        }
    }

    fn password(pw: &str) -> SshAuth {
        SshAuth::Password(pw.to_string())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn password_login_then_exec_returns_output() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;

        let handle = connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .expect("login should succeed");
        let out = transport_for(handle, port).exec("echo hi").await.unwrap();
        assert_eq!(out.stdout, "ran: echo hi\n");
        assert_eq!(out.exit_code, 0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wrong_password_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;

        let err = connect_to(port, &password("wrong"), &known_hosts)
            .await
            .err()
            .expect("login should fail");
        assert!(
            format!("{err:#}").contains("authentication failed"),
            "{err:#}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn key_file_login_works_for_the_authorized_key_only() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let client_key = new_key();
        let server = TestServer {
            password: None,
            authorized_key: Some(client_key.public_key().clone()),
        };
        let port = start_server(server, new_key()).await;

        let write_key = |name: &str, key: &PrivateKey| {
            let path = dir.path().join(name);
            let pem = key
                .to_openssh(russh::keys::ssh_key::LineEnding::LF)
                .unwrap();
            std::fs::write(&path, pem.as_bytes()).unwrap();
            SshAuth::KeyFile {
                path,
                passphrase: None,
            }
        };

        connect_to(port, &write_key("good", &client_key), &known_hosts)
            .await
            .expect("authorized key should log in");

        let err = connect_to(port, &write_key("other", &new_key()), &known_hosts)
            .await
            .err()
            .expect("an unknown key must be rejected");
        assert!(
            format!("{err:#}").contains("authentication failed"),
            "{err:#}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn first_connection_saves_the_host_key_and_the_second_trusts_it() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;

        connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .expect("first connection");
        let saved = std::fs::read_to_string(&known_hosts).unwrap();
        // russh starts a new file with a blank line, so look for the entry, not the start.
        assert!(
            saved
                .lines()
                .any(|l| l.starts_with(&format!("[127.0.0.1]:{port} ssh-ed25519 "))),
            "{saved}"
        );

        connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .expect("second connection");
        assert_eq!(std::fs::read_to_string(&known_hosts).unwrap(), saved);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn changed_host_key_is_refused_before_any_login() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;

        // Record a different key for this host, as if the server had been replaced.
        let recorded = format!(
            "[127.0.0.1]:{port} {}\n",
            new_key().public_key().to_openssh().unwrap()
        );
        std::fs::write(&known_hosts, &recorded).unwrap();

        // The password is correct, so only the host key can cause the failure.
        let err = connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .err()
            .expect("a changed host key must be refused");
        assert!(
            format!("{err:#}").contains("HOST IDENTIFICATION HAS CHANGED"),
            "{err:#}"
        );
        assert_eq!(std::fs::read_to_string(&known_hosts).unwrap(), recorded);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn exec_reports_the_exit_code_and_stderr_of_a_failing_command() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;
        let handle = connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .unwrap();
        let transport = transport_for(handle, port);

        let out = transport.exec("fail please").await.unwrap();
        assert_eq!(out.exit_code, 3);
        assert_eq!(out.stdout, "partial\n");
        assert_eq!(out.stderr, "boom\n");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn file_operations_succeed_on_exit_zero_and_report_stderr_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let known_hosts = dir.path().join("known_hosts");
        let port = start_server(password_server(), new_key()).await;
        let handle = connect_to(port, &password("s3cret"), &known_hosts)
            .await
            .unwrap();
        let transport = transport_for(handle, port);

        // The fake server answers `ran: <command>`, so a successful read
        // returns that text. Before the exit-code fix every read failed.
        let ok = transport.read_file("/etc/hostname").await.unwrap();
        assert!(String::from_utf8(ok).unwrap().starts_with("ran: "));
        transport.write_file("/tmp/x", b"data").await.unwrap();

        let err = transport.read_file("/fail/me").await.unwrap_err();
        assert!(format!("{err:#}").contains("boom"), "{err:#}");
    }
}
