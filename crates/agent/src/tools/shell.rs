use super::{get_int, get_str, get_str_or, resolve_path, Args};
use crate::ToolContext;
use anyhow::{bail, Result};
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// How often a running command is checked for having finished.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

pub fn run(args: &Args, ctx: &ToolContext) -> Result<String> {
    let command = get_str(args, "command");
    if command.is_empty() {
        bail!("command is required");
    }
    let timeout_sec = get_int(args, "timeout", 30).min(300).max(1) as u64;
    let work_dir = resolve_path(ctx, get_str_or(args, "working_directory", &ctx.cwd));

    if !std::path::Path::new(&work_dir).is_dir() {
        bail!("working_directory {work_dir:?} does not exist");
    }

    let mut child = Command::new("sh")
        .args(["-c", command])
        .current_dir(&work_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn: {e}"))?;

    let timeout = Duration::from_secs(timeout_sec);
    let start = Instant::now();

    // Poll for the exit and kill the child ourselves when the time is up. `Child::kill` needs no unsafe code
    // and, unlike signalling a saved pid from another thread, cannot hit an unrelated process that was given
    // the same pid after this one exited.
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                bail!("command timed out after {timeout_sec}s and was killed");
            }
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(e) => break Err(e),
        }
    };

    match status {
        Ok(s) => {
            let mut result = String::new();
            if let Some(mut stdout) = child.stdout.take() {
                let mut buf = String::new();
                let _ = stdout.read_to_string(&mut buf);
                result.push_str(&buf);
            }
            if let Some(mut stderr) = child.stderr.take() {
                let mut buf = String::new();
                let _ = stderr.read_to_string(&mut buf);
                if !buf.is_empty() {
                    result.push_str(&buf);
                }
            }
            if !s.success() {
                if let Some(code) = s.code() {
                    result.push_str(&format!("\nexit code: {code}"));
                }
            }
            if result.is_empty() {
                result = "(command produced no output)".into();
            }
            if result.len() > 100_000 {
                result.truncate(100_000);
                result.push_str("\n...(truncated)");
            }
            Ok(result)
        }
        Err(e) => bail!("failed to wait on process: {e}"),
    }
}
