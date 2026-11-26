//! Scheduled clean-up of old chats and of the files attached to them.
//!
//! Chats that were last used before the cutoff are deleted, except pinned ones. Attached files live in
//! `<projects dir>/<workspace>/assets/`, copied there under random names; one older than the cutoff is deleted
//! unless a remaining chat still mentions it.

use std::path::Path;
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use rusqlite::params;
use serde::Serialize;

use crate::db::Database;

/// What a sweep removed.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RetentionReport {
    pub sessions_deleted: usize,
    pub files_deleted: usize,
}

/// Delete the unpinned sessions not updated since `cutoff` (unix seconds), with their messages.
pub fn delete_sessions_older_than(db: &Database, cutoff: i64) -> Result<usize> {
    let ids: Vec<String> = {
        let mut stmt = db
            .conn()
            .prepare("SELECT id FROM chat_sessions WHERE updated_at < ?1 AND pinned = 0")
            .context("prepare old sessions")?;
        let rows = stmt
            .query_map(params![cutoff], |row| row.get::<_, String>(0))
            .context("query old sessions")?;
        rows.collect::<std::result::Result<_, _>>()
            .context("read old sessions")?
    };
    for id in &ids {
        crate::chat_sessions::delete_session(db, id)?;
    }
    Ok(ids.len())
}

fn message_mentions(db: &Database, needle: &str) -> Result<bool> {
    // `instr` is a plain substring test, so file names with `%` or `_` need no escaping.
    let found: i64 = db
        .conn()
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE instr(content, ?1) > 0)",
            params![needle],
            |row| row.get(0),
        )
        .context("look for a file in messages")?;
    Ok(found != 0)
}

/// Delete the files in each `<projects_dir>/*/assets/` last modified before `cutoff` that no remaining message
/// mentions. Returns how many were deleted; a file that cannot be removed is left and not counted.
pub fn delete_old_assets(db: &Database, projects_dir: &Path, cutoff: SystemTime) -> Result<usize> {
    let Ok(projects) = std::fs::read_dir(projects_dir) else {
        return Ok(0);
    };
    let mut deleted = 0;
    for project in projects.flatten() {
        let assets = project.path().join("assets");
        let Ok(files) = std::fs::read_dir(&assets) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let Ok(meta) = file.metadata() else { continue };
            if !meta.is_file() || meta.modified().map_or(true, |m| m >= cutoff) {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if message_mentions(db, name)? {
                continue;
            }
            if std::fs::remove_file(&path).is_ok() {
                deleted += 1;
            }
        }
    }
    Ok(deleted)
}

/// Remove chats and attached files older than `days` days. `days == 0` removes nothing.
pub fn sweep(
    db: &Database,
    projects_dir: &Path,
    days: u32,
    now: SystemTime,
) -> Result<RetentionReport> {
    if days == 0 {
        return Ok(RetentionReport::default());
    }
    let age = Duration::from_secs(u64::from(days) * 86_400);
    let cutoff = now.checked_sub(age).unwrap_or(SystemTime::UNIX_EPOCH);
    let cutoff_secs = i64::try_from(
        cutoff
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
    )
    .unwrap_or(0);
    // Chats first, so the files only they mentioned are no longer referenced.
    let sessions_deleted = delete_sessions_older_than(db, cutoff_secs)?;
    let files_deleted = delete_old_assets(db, projects_dir, cutoff)?;
    Ok(RetentionReport {
        sessions_deleted,
        files_deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat_sessions::{
        create_session, load_messages, save_message, ChatMessage, ChatSession,
    };

    const DAY: i64 = 86_400;

    fn test_db(dir: &Path) -> Database {
        Database::open(&dir.join("test.db")).unwrap()
    }

    fn session(id: &str, updated_at: i64, pinned: bool) -> ChatSession {
        ChatSession {
            id: id.into(),
            title: id.into(),
            created_at: updated_at,
            updated_at,
            model: "m".into(),
            mode: "agent".into(),
            workspace: "w".into(),
            message_count: 0,
            pinned,
            archived: false,
        }
    }

    fn message(id: &str, session_id: &str, content: &str) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            session_id: session_id.into(),
            role: "user".into(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            created_at: 0,
        }
    }

    fn at(secs: i64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(u64::try_from(secs).unwrap())
    }

    #[test]
    fn deletes_old_unpinned_sessions_and_their_messages() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = test_db(tmp.path());
        let now = 100 * DAY;
        create_session(&db, &session("old", now - 40 * DAY, false)).unwrap();
        create_session(&db, &session("old-pinned", now - 40 * DAY, true)).unwrap();
        create_session(&db, &session("recent", now - 5 * DAY, false)).unwrap();
        save_message(&db, &message("m1", "old", "hello")).unwrap();

        let report = sweep(&db, &tmp.path().join("projects"), 30, at(now)).unwrap();

        assert_eq!(report.sessions_deleted, 1);
        assert!(load_messages(&db, "old").unwrap().is_empty());
        let left = crate::chat_sessions::list_sessions(&db, "w", 10).unwrap();
        let mut ids: Vec<_> = left.iter().map(|s| s.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, ["old-pinned", "recent"]);
    }

    #[test]
    fn zero_days_deletes_nothing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = test_db(tmp.path());
        create_session(&db, &session("old", 1, false)).unwrap();
        let report = sweep(&db, tmp.path(), 0, at(100 * DAY)).unwrap();
        assert_eq!(report, RetentionReport::default());
        assert_eq!(
            crate::chat_sessions::list_sessions(&db, "w", 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn deletes_old_files_but_keeps_new_ones_and_ones_a_chat_still_mentions() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = test_db(tmp.path());
        let assets = tmp.path().join("projects").join("proj").join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        for name in ["old-unused.py", "old-used.py", "new.py"] {
            std::fs::write(assets.join(name), "x").unwrap();
        }
        // Make the first two look old.
        let old = SystemTime::now() - Duration::from_hours(40 * 24);
        for name in ["old-unused.py", "old-used.py"] {
            let f = std::fs::File::options()
                .write(true)
                .open(assets.join(name))
                .unwrap();
            f.set_modified(old).unwrap();
        }
        let now_secs = i64::try_from(
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        )
        .unwrap();
        create_session(&db, &session("keep", now_secs, true)).unwrap();
        save_message(
            &db,
            &message("m1", "keep", "Attached file: `x/old-used.py`"),
        )
        .unwrap();

        let report = sweep(&db, &tmp.path().join("projects"), 30, SystemTime::now()).unwrap();

        assert_eq!(report.files_deleted, 1);
        assert!(!assets.join("old-unused.py").exists());
        assert!(assets.join("old-used.py").exists());
        assert!(assets.join("new.py").exists());
    }

    #[test]
    fn a_missing_projects_folder_is_not_an_error() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = test_db(tmp.path());
        assert_eq!(
            delete_old_assets(&db, &tmp.path().join("nope"), at(DAY)).unwrap(),
            0
        );
    }
}
