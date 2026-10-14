#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod agent;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod auth;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod browser;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod chat_sessions;
pub mod compress;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod context_format;
pub mod crypto;
pub mod db_state;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod debug;
pub mod editor;
pub mod encoding;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod ext_api;
pub mod ext_host;
pub mod extension_diagnostics;
pub mod extension_platform;
pub mod extension_wasm;
pub mod extensions;
pub mod fs;
pub mod git;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod hooks;
pub mod index;
pub mod keymap;
pub mod lsp;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod mcp;
pub mod menu;
pub mod models;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod next_gen_tools;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod orchestrate;
pub mod os;
pub mod path;
pub mod process;
pub mod profiles;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod providers;
pub mod proxy;
pub mod remote;
pub mod search;
pub mod secrets;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod settings;
pub mod storage;
pub mod syntax;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod tasks;
pub mod terminal;
pub mod text;
pub mod theme;
pub mod updater;
pub mod validation;
#[allow(
    clippy::pedantic,
    clippy::style,
    clippy::complexity,
    clippy::perf,
    clippy::suspicious,
    unused_imports
)] // TODO(ratchet)
pub mod watch;
pub mod window;

pub use chat_sessions::*;
pub use compress::*;
pub use crypto::*;
pub use debug::*;
pub use editor::*;
pub use ext_api::*;
pub use extension_diagnostics::*;
pub use extension_platform::*;
pub use extension_wasm::*;
pub use extensions::*;
pub use fs::*;
pub use git::*;
pub use hooks::*;
pub use index::*;
pub use keymap::*;
pub use lsp::*;
pub use menu::*;
pub use orchestrate::*;
pub use os::*;
pub use path::*;
pub use process::*;
pub use profiles::*;
pub use providers::*;
pub use proxy::*;
pub use remote::*;
pub use search::*;
pub use secrets::*;
pub use settings::*;
pub use storage::*;
pub use syntax::*;
pub use tasks::*;
pub use terminal::*;
pub use text::*;
pub use theme::*;
pub use updater::*;
// pub use validation::*; // Internal helpers, not Tauri commands
pub use auth::*;
pub use browser::*;
pub use mcp::*;
pub use watch::*;
pub use window::*;
pub mod logging;
pub mod sidex_terminal;
pub mod textmate;
pub use db_state::*;
pub use logging::*;
pub use sidex_terminal::*;
pub use textmate::*;
