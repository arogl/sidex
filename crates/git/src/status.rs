//! Git status — parse `git status --porcelain=v2`.

use std::path::Path;

use serde::Serialize;

use crate::cmd::run_git;
use crate::error::GitResult;

/// High-level status of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Ignored,
    Conflicted,
    Copied,
}

/// One entry from `git status`.
#[derive(Debug, Clone, Serialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: FileStatus,
    pub staged: bool,
    /// Two-letter porcelain XY code for unmerged entries (`UU`, `AA`, `DU`, ...).
    /// `None` for everything else.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict: Option<String>,
}

/// Run `git status --porcelain=v2` and parse the output.
pub fn get_status(repo_root: &Path) -> GitResult<Vec<StatusEntry>> {
    let output = run_git(repo_root, &["status", "--porcelain=v2", "-uall"])?;
    let mut entries = Vec::new();

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }

        match line.as_bytes().first() {
            // Ordinary changed entries: "1 XY ..."
            Some(b'1') => {
                if let Some(entry) = parse_ordinary_entry(line) {
                    entries.push(entry);
                }
            }
            // Renamed/copied entries: "2 XY ..."
            Some(b'2') => {
                if let Some(entry) = parse_rename_entry(line) {
                    entries.push(entry);
                }
            }
            // Unmerged entries: "u XY ..."
            Some(b'u') => {
                if let Some(entry) = parse_unmerged_entry(line) {
                    entries.push(entry);
                }
            }
            // Untracked: "? path"
            Some(b'?') => {
                let path = line.get(2..).unwrap_or("").to_string();
                entries.push(StatusEntry {
                    path,
                    status: FileStatus::Untracked,
                    staged: false,
                    conflict: None,
                });
            }
            // Ignored: "! path"
            Some(b'!') => {
                let path = line.get(2..).unwrap_or("").to_string();
                entries.push(StatusEntry {
                    path,
                    status: FileStatus::Ignored,
                    staged: false,
                    conflict: None,
                });
            }
            _ => {}
        }
    }

    Ok(entries)
}

/// Parse a "1 XY sub mH mI mW hH hI path" line.
fn parse_ordinary_entry(line: &str) -> Option<StatusEntry> {
    let parts: Vec<&str> = line.splitn(9, ' ').collect();
    if parts.len() < 9 {
        return None;
    }
    let xy = parts[1];
    let path = parts[8].to_string();

    let x = xy.as_bytes().first().copied().unwrap_or(b'.');
    let y = xy.as_bytes().get(1).copied().unwrap_or(b'.');

    let (status, staged) = if x == b'.' {
        (char_to_status(y), false)
    } else {
        (char_to_status(x), true)
    };

    Some(StatusEntry {
        path,
        status,
        staged,
        conflict: None,
    })
}

/// Parse a "2 XY sub mH mI mW hH hI X### origPath\tpath" line.
fn parse_rename_entry(line: &str) -> Option<StatusEntry> {
    let parts: Vec<&str> = line.splitn(10, ' ').collect();
    if parts.len() < 10 {
        return None;
    }
    let xy = parts[1];
    let paths_part = parts[9];

    let path = paths_part
        .split('\t')
        .next_back()
        .unwrap_or(paths_part)
        .to_string();

    let x = xy.as_bytes().first().copied().unwrap_or(b'.');
    let staged = x != b'.';

    Some(StatusEntry {
        path,
        status: FileStatus::Renamed,
        staged,
        conflict: None,
    })
}

/// Parse a "u XY sub m1 m2 m3 mW h1 h2 h3 path" line (porcelain v2).
fn parse_unmerged_entry(line: &str) -> Option<StatusEntry> {
    let parts: Vec<&str> = line.splitn(11, ' ').collect();
    if parts.len() < 11 {
        return None;
    }
    Some(StatusEntry {
        path: parts[10].to_string(),
        status: FileStatus::Conflicted,
        staged: false,
        conflict: Some(parts[1].to_string()),
    })
}

fn char_to_status(c: u8) -> FileStatus {
    match c {
        b'A' => FileStatus::Added,
        b'D' => FileStatus::Deleted,
        b'R' => FileStatus::Renamed,
        b'C' => FileStatus::Copied,
        _ => FileStatus::Modified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn init_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        std::process::Command::new("git")
            .current_dir(tmp.path())
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        std::process::Command::new("git")
            .current_dir(tmp.path())
            .args(["config", "user.email", "test@test.com"])
            .output()
            .unwrap();
        std::process::Command::new("git")
            .current_dir(tmp.path())
            .args(["config", "user.name", "Test"])
            .output()
            .unwrap();
        tmp
    }

    #[test]
    fn untracked_files_detected() {
        let tmp = init_repo();
        fs::write(tmp.path().join("new.txt"), "hello").unwrap();

        let entries = get_status(tmp.path()).unwrap();
        assert!(!entries.is_empty());
        assert!(entries
            .iter()
            .any(|e| e.path == "new.txt" && e.status == FileStatus::Untracked));
    }

    #[test]
    fn staged_files_detected() {
        let tmp = init_repo();
        fs::write(tmp.path().join("a.txt"), "a").unwrap();
        std::process::Command::new("git")
            .current_dir(tmp.path())
            .args(["add", "a.txt"])
            .output()
            .unwrap();

        let entries = get_status(tmp.path()).unwrap();
        let entry = entries.iter().find(|e| e.path == "a.txt").unwrap();
        assert!(entry.staged);
        assert_eq!(entry.status, FileStatus::Added);
    }

    #[test]
    fn unmerged_entry_parses_path_and_xy_code() {
        let line = "u UU N... 100644 100644 100644 100644 c0d0fb45c382919737f8d0c20aaf57cf89b74af8 b926fcafa60ec8a6a58625fcb46e55df181b6e5d fb26e04e53fdf71eb402a159f8dcd2492670f39b dir/conflict.txt";
        let entry = parse_unmerged_entry(line).unwrap();
        assert_eq!(entry.path, "dir/conflict.txt");
        assert_eq!(entry.status, FileStatus::Conflicted);
        assert!(!entry.staged);
        assert_eq!(entry.conflict.as_deref(), Some("UU"));
    }

    #[test]
    fn unmerged_entry_with_too_few_fields_is_skipped() {
        assert!(parse_unmerged_entry("u UU N... 100644 100644 100644 100644 h1 h2").is_none());
    }

    #[test]
    fn ordinary_entry_has_no_conflict_code() {
        let tmp = init_repo();
        fs::write(tmp.path().join("a.txt"), "a").unwrap();
        let entries = get_status(tmp.path()).unwrap();
        let entry = entries.iter().find(|e| e.path == "a.txt").unwrap();
        assert!(entry.conflict.is_none());
    }

    #[test]
    fn real_merge_conflict_is_reported_with_uu() {
        let tmp = init_repo();
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .current_dir(tmp.path())
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(args)
                .output()
                .unwrap()
        };
        fs::write(tmp.path().join("f.txt"), "line1\nline2\n").unwrap();
        git(&["add", "f.txt"]);
        git(&["commit", "-qm", "base"]);
        git(&["checkout", "-qb", "other"]);
        fs::write(tmp.path().join("f.txt"), "THEIRS\nline2\n").unwrap();
        git(&["commit", "-qam", "theirs"]);
        git(&["checkout", "-q", "main"]);
        fs::write(tmp.path().join("f.txt"), "OURS\nline2\n").unwrap();
        git(&["commit", "-qam", "ours"]);
        git(&["merge", "other"]); // conflicts; exit status ignored

        let entries = get_status(tmp.path()).unwrap();
        let entry = entries
            .iter()
            .find(|e| e.path == "f.txt")
            .expect("f.txt listed by its real path");
        assert_eq!(entry.status, FileStatus::Conflicted);
        assert_eq!(entry.conflict.as_deref(), Some("UU"));
    }
}
