//! Commands that keep running after the agent starts them.
//!
//! `exec` waits for a command to finish, which is no use for a dev server or a watcher. These commands start a
//! process, collect what it prints, and let the caller read that output later and stop the process. There is no
//! terminal: the process gets no input (stdin is closed) and its stdout and stderr go into one buffer in the
//! order they arrive.

use serde::Serialize;
use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};
use tauri::State;

use super::process::kill_process_tree;

/// How much output is kept per job. The oldest bytes are dropped past this.
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

/// How many commands can run at once, so a runaway agent cannot start processes without end.
const MAX_RUNNING: usize = 16;

/// How often a read that is waiting for output looks again.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The longest a read may wait for output.
const MAX_WAIT_MS: u64 = 30_000;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// What a command has printed, with a read position so each read returns only what is new.
#[derive(Default)]
struct Output {
    bytes: Vec<u8>,
    cursor: usize,
    dropped: usize,
}

impl Output {
    fn push(&mut self, chunk: &[u8]) {
        self.bytes.extend_from_slice(chunk);
        if self.bytes.len() > MAX_OUTPUT_BYTES {
            let excess = self.bytes.len() - MAX_OUTPUT_BYTES;
            self.bytes.drain(..excess);
            self.cursor = self.cursor.saturating_sub(excess);
            self.dropped += excess;
        }
    }

    /// The text printed since the last call and the number of bytes lost to the size limit in that time.
    /// While the command is still running, a character cut in half at the end waits for the rest of its bytes.
    fn take_new(&mut self, finished: bool) -> (String, usize) {
        let pending = &self.bytes[self.cursor..];
        let take = if finished {
            pending.len()
        } else {
            match std::str::from_utf8(pending) {
                Err(e) if e.error_len().is_none() => e.valid_up_to(),
                _ => pending.len(),
            }
        };
        let text = String::from_utf8_lossy(&pending[..take]).into_owned();
        self.cursor += take;
        (text, std::mem::take(&mut self.dropped))
    }

    fn has_new(&self) -> bool {
        self.cursor < self.bytes.len()
    }
}

/// How a process ended. `code` is empty when it was stopped by a signal.
#[derive(Clone, Copy)]
struct Finished {
    code: Option<i32>,
}

struct Job {
    child: Mutex<Child>,
    output: Arc<Mutex<Output>>,
    /// Set once the process has exited.
    exit: Mutex<Option<Finished>>,
}

impl Job {
    /// The exit state, checking the process if it has not been seen to finish yet.
    fn exit_state(&self) -> Option<Finished> {
        let mut exit = lock(&self.exit);
        if exit.is_none() {
            if let Ok(Some(status)) = lock(&self.child).try_wait() {
                *exit = Some(Finished {
                    code: status.code(),
                });
            }
        }
        *exit
    }
}

/// The commands started in the background, by id.
pub struct BackgroundStore {
    jobs: Mutex<HashMap<u32, Arc<Job>>>,
    next_id: AtomicU32,
}

impl BackgroundStore {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
        }
    }

    fn job(&self, id: u32) -> Result<Arc<Job>, String> {
        lock(&self.jobs).get(&id).cloned().ok_or_else(|| {
            format!("No background command with id {id}. It may have finished and been read already, or been stopped.")
        })
    }

    /// Stop every running command. Called when the app exits so they do not outlive it.
    pub fn kill_all(&self) {
        let jobs: Vec<Arc<Job>> = lock(&self.jobs).drain().map(|(_, job)| job).collect();
        for job in jobs {
            stop(&job);
        }
    }
}

/// Stops the process and everything it started, and waits for it.
fn stop(job: &Job) {
    let mut child = lock(&job.child);
    if matches!(child.try_wait(), Ok(None)) {
        let _ = kill_process_tree(child.id());
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn read_into(mut stream: impl Read + Send + 'static, output: Arc<Mutex<Output>>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            lock(&output).push(&buf[..n]);
        }
    });
}

/// What a read of a background command returns.
#[derive(Debug, Serialize)]
pub struct BackgroundOutput {
    /// Output printed since the previous read.
    pub output: String,
    /// Bytes of older output that were dropped because the buffer is limited.
    pub dropped_bytes: usize,
    pub running: bool,
    /// The exit code once the command has finished, when it has one.
    pub exit_code: Option<i32>,
}

/// Start a command in the background and return its id. Starting a process can block, so it is not done on the
/// thread that handles the command.
#[tauri::command]
pub async fn bg_exec_start(
    state: State<'_, Arc<BackgroundStore>>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<u32, String> {
    let store = Arc::clone(&state);
    tokio::task::spawn_blocking(move || {
        start(&store, &command, &args, cwd.as_deref(), env.as_ref())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn start(
    store: &BackgroundStore,
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    env: Option<&HashMap<String, String>>,
) -> Result<u32, String> {
    let running = {
        let jobs: Vec<Arc<Job>> = lock(&store.jobs).values().cloned().collect();
        jobs.iter().filter(|job| job.exit_state().is_none()).count()
    };
    if running >= MAX_RUNNING {
        return Err(format!(
            "{running} background commands are already running. Stop one before starting another."
        ));
    }

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(vars) = env {
        cmd.envs(vars);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start '{program}': {e}"))?;
    let output = Arc::new(Mutex::new(Output::default()));
    if let Some(stdout) = child.stdout.take() {
        read_into(stdout, Arc::clone(&output));
    }
    if let Some(stderr) = child.stderr.take() {
        read_into(stderr, Arc::clone(&output));
    }

    let id = store.next_id.fetch_add(1, Ordering::SeqCst);
    let job = Arc::new(Job {
        child: Mutex::new(child),
        output,
        exit: Mutex::new(None),
    });
    lock(&store.jobs).insert(id, job);
    Ok(id)
}

/// Read what a background command has printed since the last read. With `wait_ms`, wait up to that long for
/// something new, or for the command to finish. A finished command is forgotten once its output has been read.
#[tauri::command]
pub async fn bg_exec_output(
    state: State<'_, Arc<BackgroundStore>>,
    id: u32,
    wait_ms: Option<u64>,
) -> Result<BackgroundOutput, String> {
    let job = state.job(id)?;
    let deadline = Instant::now() + Duration::from_millis(wait_ms.unwrap_or(0).min(MAX_WAIT_MS));
    loop {
        let exit = job.exit_state();
        let ready = exit.is_some() || lock(&job.output).has_new();
        if ready || Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    // The readers can still hold the last bytes just after the process exits, so give them a moment.
    let exit = job.exit_state();
    if exit.is_some() {
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    let (output, dropped_bytes) = lock(&job.output).take_new(exit.is_some());
    if exit.is_some() {
        lock(&state.jobs).remove(&id);
    }
    Ok(BackgroundOutput {
        output,
        dropped_bytes,
        running: exit.is_none(),
        exit_code: exit.and_then(|f| f.code),
    })
}

/// Stop a background command and everything it started, and return what it had printed that was not read yet.
/// Waiting for the process to go can block, so it is not done on the thread that handles the command.
#[tauri::command]
pub async fn bg_exec_kill(
    state: State<'_, Arc<BackgroundStore>>,
    id: u32,
) -> Result<BackgroundOutput, String> {
    let store = Arc::clone(&state);
    tokio::task::spawn_blocking(move || kill(&store, id))
        .await
        .map_err(|e| e.to_string())?
}

fn kill(store: &BackgroundStore, id: u32) -> Result<BackgroundOutput, String> {
    let job = store.job(id)?;
    stop(&job);
    lock(&store.jobs).remove(&id);
    let exit = job.exit_state();
    let (output, dropped_bytes) = lock(&job.output).take_new(true);
    Ok(BackgroundOutput {
        output,
        dropped_bytes,
        running: false,
        exit_code: exit.and_then(|f| f.code),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_only_what_is_new() {
        let mut out = Output::default();
        out.push(b"one\n");
        assert_eq!(out.take_new(false).0, "one\n");
        assert!(!out.has_new());
        out.push(b"two\n");
        assert_eq!(out.take_new(false).0, "two\n");
    }

    #[test]
    fn a_character_cut_in_half_waits_for_the_rest() {
        let mut out = Output::default();
        let euro = "€".as_bytes(); // three bytes
        out.push(b"a");
        out.push(&euro[..2]);
        assert_eq!(out.take_new(false).0, "a");
        out.push(&euro[2..]);
        assert_eq!(out.take_new(false).0, "€");
    }

    #[test]
    fn a_finished_command_returns_everything_even_if_cut() {
        let mut out = Output::default();
        out.push(&"€".as_bytes()[..2]);
        assert_eq!(out.take_new(false).0, "");
        assert_eq!(out.take_new(true).0, "\u{FFFD}");
    }

    #[test]
    fn the_oldest_output_is_dropped_past_the_limit_and_counted_once() {
        let mut out = Output::default();
        out.push(&vec![b'x'; MAX_OUTPUT_BYTES]);
        out.push(b"yyyy");
        assert_eq!(out.bytes.len(), MAX_OUTPUT_BYTES);
        let (text, dropped) = out.take_new(false);
        assert_eq!(dropped, 4);
        assert!(text.ends_with("yyyy"));
        assert_eq!(out.take_new(false).1, 0);
    }

    #[cfg(unix)]
    fn start(store: &BackgroundStore, script: &str) -> Arc<Job> {
        let mut child = Command::new("/bin/sh")
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let output = Arc::new(Mutex::new(Output::default()));
        read_into(child.stdout.take().unwrap(), Arc::clone(&output));
        read_into(child.stderr.take().unwrap(), Arc::clone(&output));
        let job = Arc::new(Job {
            child: Mutex::new(child),
            output,
            exit: Mutex::new(None),
        });
        lock(&store.jobs).insert(1, Arc::clone(&job));
        job
    }

    #[cfg(unix)]
    #[test]
    fn collects_output_and_the_exit_code_of_a_command_that_finishes() {
        let store = BackgroundStore::new();
        let job = start(&store, "echo out; echo err 1>&2; exit 3");
        let started = Instant::now();
        while job.exit_state().is_none() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "did not finish"
            );
            std::thread::sleep(POLL_INTERVAL);
        }
        std::thread::sleep(Duration::from_millis(200));
        let text = lock(&job.output).take_new(true).0;
        assert!(text.contains("out") && text.contains("err"), "{text}");
        assert_eq!(job.exit_state().and_then(|f| f.code), Some(3));
    }

    #[cfg(unix)]
    #[test]
    fn kill_all_stops_a_command_that_would_not_finish() {
        let store = BackgroundStore::new();
        let job = start(&store, "sleep 60");
        assert!(job.exit_state().is_none());
        store.kill_all();
        assert!(job.exit_state().is_some());
        assert!(lock(&store.jobs).is_empty());
    }

    #[test]
    fn an_unknown_id_is_an_error() {
        let store = BackgroundStore::new();
        assert!(store
            .job(99)
            .err()
            .unwrap()
            .contains("No background command with id 99"));
    }
}
