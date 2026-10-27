//! SideX Extension SDK
//!
//! Build native SideX extensions in Rust. Extensions compile to WASM
//! components via `cargo build --target wasm32-wasip2` and are loaded
//! directly by the SideX runtime — no Node.js required.
//!
//! # Quick Start
//!
//! ```toml
//! [dependencies]
//! sidex-extension-sdk = "0.1"
//! ```
//!
//! ```rust,ignore
//! use sidex_extension_sdk::prelude::*;
//!
//! struct MyExtension;
//!
//! // `Extension` has a default for every hook except `get_name`.
//! impl Extension for MyExtension {
//!     fn activate() -> Result<(), String> {
//!         host::log_info("Hello from my extension!");
//!         Ok(())
//!     }
//!
//!     fn get_name() -> String {
//!         "My Extension".to_string()
//!     }
//! }
//!
//! export_extension_with_defaults!(MyExtension);
//! ```
//!
//! To control every hook yourself, implement [`SidexExtension`] (the
//! WIT-generated trait, which has no defaults) and use [`export_extension!`].
//!
//! Then in your extension directory, create a `sidex.toml`:
//!
//! ```toml
//! [extension]
//! id = "mypublisher.my-extension"
//! name = "My Extension"
//! version = "0.1.0"
//! wasm = "target/wasm32-wasip2/release/my_extension.wasm"
//!
//! [activation]
//! events = ["onLanguage:rust"]
//! ```

wit_bindgen::generate!({
    world: "sidex-extension",
    path: "wit/world.wit",
    pub_export_macro: true,
});

pub use self::sidex::extension::common_types::*;
pub use self::sidex::extension::host_api as host;

/// Re-export the guest trait that extensions must implement.
pub use self::exports::sidex::extension::extension_api::Guest as SidexExtension;

mod defaults;
pub use defaults::{Extension, ExtensionComponent};

/// Prelude module — import everything you need with `use sidex_extension_sdk::prelude::*;`
pub mod prelude {
    pub use super::exports::sidex::extension::extension_api::Guest as SidexExtension;
    pub use super::sidex::extension::common_types::*;
    pub use super::sidex::extension::host_api as host;
    pub use super::Extension;
}

/// Macro to export your extension implementation. Call this once at the
/// top level of your crate with your struct that implements `SidexExtension`.
#[macro_export]
macro_rules! export_extension {
    ($ty:ident) => {
        ::sidex_extension_sdk::export!($ty with_types_in ::sidex_extension_sdk);
    };
}

/// Like [`export_extension!`], for a type that implements [`Extension`] (the
/// trait with a default for every hook) instead of [`SidexExtension`].
#[macro_export]
macro_rules! export_extension_with_defaults {
    ($ty:ty) => {
        type __SidexExtensionExport = ::sidex_extension_sdk::ExtensionComponent<$ty>;
        ::sidex_extension_sdk::export!(__SidexExtensionExport with_types_in ::sidex_extension_sdk);
    };
}
