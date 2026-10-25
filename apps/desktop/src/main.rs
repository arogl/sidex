// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(any(target_os = "macos", test))]
const PATH_MARKER: &str = "_SIDEX_PATH_=";

/// Pulls the `PATH` out of a login shell's output. Shell start-up files may
/// print banners, so only the text after the last marker counts.
#[cfg(any(target_os = "macos", test))]
fn parse_shell_path(output: &str) -> Option<String> {
    let path = output.rsplit(PATH_MARKER).next()?.trim();
    (!path.is_empty() && output.contains(PATH_MARKER)).then(|| path.to_string())
}

/// A Finder-launched app gets launchd's minimal `PATH`, so tools installed via
/// Homebrew, nvm and the like are not found. Ask the user's login shell for
/// the `PATH` it would give a terminal and adopt it.
#[cfg(target_os = "macos")]
fn fix_path_env() {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let Ok(output) = std::process::Command::new(shell)
        .arg("-ilc")
        .arg(format!("printf '{PATH_MARKER}%s' \"$PATH\""))
        .stdin(std::process::Stdio::null())
        .output()
    else {
        return;
    };
    if let Some(path) = parse_shell_path(&String::from_utf8_lossy(&output.stdout)) {
        std::env::set_var("PATH", path);
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    fix_path_env();

    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    sidex_lib::run();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_path_after_the_marker() {
        assert_eq!(
            parse_shell_path("_SIDEX_PATH_=/opt/homebrew/bin:/usr/bin"),
            Some("/opt/homebrew/bin:/usr/bin".to_string())
        );
    }

    #[test]
    fn ignores_banner_output_before_the_marker() {
        assert_eq!(
            parse_shell_path("Welcome!\nlast login...\n_SIDEX_PATH_=/usr/bin:/bin\n"),
            Some("/usr/bin:/bin".to_string())
        );
    }

    #[test]
    fn rejects_missing_or_empty_paths() {
        assert_eq!(parse_shell_path(""), None);
        assert_eq!(parse_shell_path("no marker here"), None);
        assert_eq!(parse_shell_path("_SIDEX_PATH_="), None);
    }
}
