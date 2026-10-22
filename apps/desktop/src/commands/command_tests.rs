//! Tests for the Tauri command layer.
//!
//! These call the command functions directly, the way the frontend does through
//! `invoke`, against real temporary directories. They cover argument
//! validation, error text, and the shape of the data the webview receives.

use super::{fs, path, text};
use std::path::{Path, PathBuf};

struct TempDir(PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("sidex-cmd-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    fn join(&self, name: &str) -> String {
        self.0.join(name).to_string_lossy().into_owned()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// ---------------------------------------------------------------------------
// fs
// ---------------------------------------------------------------------------

#[test]
fn write_then_read_round_trips_text_and_bytes() {
    let dir = TempDir::new("fs-roundtrip");
    let file = dir.join("a.txt");

    fs::write_file(file.clone(), "héllo\nworld".into()).expect("write");
    assert_eq!(fs::read_file(file.clone()).expect("read"), "héllo\nworld");

    let bin = dir.join("b.bin");
    fs::write_file_bytes(bin.clone(), vec![0, 1, 2, 255]).expect("write bytes");
    assert_eq!(
        fs::read_file_bytes(bin).expect("read bytes"),
        [0, 1, 2, 255]
    );
}

#[test]
fn reading_a_missing_file_names_the_path_in_the_error() {
    let dir = TempDir::new("fs-missing");
    let file = dir.join("nope.txt");
    let err = fs::read_file(file.clone()).expect_err("missing");
    assert!(err.starts_with(&file), "{err}");
}

#[test]
fn fs_commands_reject_bad_paths_before_touching_the_disk() {
    let traversal = "/tmp/../etc/passwd".to_string();
    for bad in ["", "a\0b", traversal.as_str()] {
        assert!(fs::read_file(bad.into()).is_err(), "read_file {bad:?}");
        assert!(fs::read_file_bytes(bad.into()).is_err());
        assert!(fs::write_file(bad.into(), String::new()).is_err());
        assert!(fs::write_file_bytes(bad.into(), Vec::new()).is_err());
        assert!(fs::read_dir(bad.into()).is_err());
        assert!(fs::stat(bad.into()).is_err());
        assert!(fs::mkdir(bad.into(), true).is_err());
        assert!(fs::remove(bad.into(), true).is_err());
        assert!(fs::exists(bad.into()).is_err());
    }
    let dir = TempDir::new("fs-rename-bad");
    assert!(fs::rename(traversal.clone(), dir.join("x")).is_err());
    assert!(fs::rename(dir.join("x"), traversal).is_err());
}

#[test]
fn mkdir_stat_read_dir_rename_and_remove() {
    let dir = TempDir::new("fs-tree");
    let nested = dir.join("one/two");

    assert!(
        fs::mkdir(nested.clone(), false).is_err(),
        "non-recursive needs the parent"
    );
    fs::mkdir(nested.clone(), true).expect("recursive mkdir");
    assert!(fs::exists(nested.clone()).expect("exists"));

    let s = fs::stat(nested.clone()).expect("stat dir");
    assert!(s.is_dir && !s.is_file);

    let file = format!("{nested}/f.txt");
    fs::write_file(file.clone(), "abc".into()).expect("write");
    let s = fs::stat(file.clone()).expect("stat file");
    assert!(s.is_file && !s.is_dir);
    assert_eq!(s.size, 3);

    let entries = fs::read_dir(nested.clone()).expect("read_dir");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "f.txt");
    assert!(entries[0].is_file);
    assert_eq!(entries[0].size, 3);

    let moved = format!("{nested}/g.txt");
    fs::rename(file.clone(), moved.clone()).expect("rename");
    assert!(!fs::exists(file).expect("old gone"));
    assert!(fs::exists(moved).expect("new there"));

    assert!(
        fs::remove(dir.join("one"), false).is_err(),
        "non-empty dir needs recursive"
    );
    fs::remove(dir.join("one"), true).expect("recursive remove");
    assert!(!fs::exists(nested).expect("gone"));
}

#[test]
fn file_stat_serializes_with_the_field_names_the_frontend_reads() {
    let dir = TempDir::new("fs-serde");
    let file = dir.join("f.txt");
    fs::write_file(file.clone(), "x".into()).expect("write");
    let json = serde_json::to_value(fs::stat(file).expect("stat")).expect("json");
    for key in [
        "size",
        "is_dir",
        "is_file",
        "is_symlink",
        "modified",
        "created",
        "readonly",
    ] {
        assert!(json.get(key).is_some(), "missing {key}");
    }
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

#[test]
fn count_lines_and_summary_describe_a_file() {
    let dir = TempDir::new("text-summary");
    let file = dir.join("t.txt");
    std::fs::write(&file, "one two\r\nthree\r\n").expect("write");

    let summary = text::file_summary(file.clone()).expect("summary");
    assert_eq!(summary.word_count, 3);
    assert!(!summary.has_bom);
    assert_eq!(summary.line_endings, "CRLF");
    assert!(text::count_lines(file).expect("count") >= 2);

    let bom = dir.join("bom.txt");
    std::fs::write(&bom, b"\xEF\xBB\xBFhi").expect("write");
    assert!(text::file_summary(bom).expect("summary").has_bom);
}

#[test]
fn text_commands_report_missing_files() {
    let dir = TempDir::new("text-missing");
    let missing = dir.join("missing");
    assert!(text::file_summary(missing.clone())
        .expect_err("summary")
        .contains("Failed to read file"));
    assert!(text::file_hash(missing.clone()).is_err());
    assert!(text::files_equal(missing.clone(), missing).is_err());
}

#[test]
fn file_hash_and_files_equal_compare_content() {
    let dir = TempDir::new("text-equal");
    let (a, b, c) = (dir.join("a"), dir.join("b"), dir.join("c"));
    std::fs::write(&a, "same").expect("write");
    std::fs::write(&b, "same").expect("write");
    std::fs::write(&c, "diff").expect("write");

    assert_eq!(
        text::file_hash(a.clone()).expect("a"),
        text::file_hash(b.clone()).expect("b")
    );
    assert_ne!(
        text::file_hash(a.clone()).expect("a"),
        text::file_hash(c.clone()).expect("c")
    );
    assert!(text::files_equal(a.clone(), b).expect("a b"));
    assert!(!text::files_equal(a, c).expect("a c"));
}

#[test]
fn whitespace_and_line_ending_commands() {
    assert_eq!(text::to_crlf("a\nb".into()), "a\r\nb");
    assert_eq!(
        text::normalize_line_endings_cmd("a\r\nb\rc".into())
            .matches('\r')
            .count(),
        0
    );
    assert_eq!(text::trim_trailing_whitespace("a  \nb\t".into()), "a\nb");
    assert_eq!(text::ensure_final_newline("a".into()), "a\n");
    assert_eq!(text::ensure_final_newline("a\n".into()), "a\n");
}

// ---------------------------------------------------------------------------
// path
// ---------------------------------------------------------------------------

#[test]
fn path_commands_parse_join_and_match() {
    let info = path::parse_path("/a/b/file.tar.gz".into()).expect("parse");
    assert_eq!(info.base, "file.tar.gz");
    assert_eq!(info.ext, "gz");

    let joined = path::join_paths("/a".into(), vec!["b".into(), "c.txt".into()]);
    assert!(
        Path::new(&joined).ends_with(Path::new("b").join("c.txt")),
        "{joined}"
    );

    assert!(path::glob_match("*.rs".into(), "main.rs".into()));
    assert!(!path::glob_match("*.rs".into(), "main.ts".into()));
}

#[test]
fn is_binary_file_tells_text_from_binary() {
    let dir = TempDir::new("path-binary");
    let (t, b) = (dir.join("t.txt"), dir.join("b.bin"));
    std::fs::write(&t, "plain text\n").expect("write");
    std::fs::write(&b, [0_u8, 159, 146, 150, 0, 1, 2]).expect("write");
    assert!(!path::is_binary_file(t).expect("text"));
    assert!(path::is_binary_file(b).expect("binary"));
    assert!(path::is_binary_file(dir.join("missing")).is_err());
}
