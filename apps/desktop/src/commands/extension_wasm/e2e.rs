//! End-to-end tests for the WASM extension runtime.
//!
//! These tests load real WASM components into a real `WasmExtensionRuntime`
//! and call them through the generated bindings. They do not use the Tauri
//! mock app: it pulls Tauri's windowing code into the test executable, and on
//! Windows that executable then needs a Common Controls v6 manifest to start.
//!
//! The components are generated at test time from `wit/world.wit`, the world
//! the runtime binds with `bindgen!`. `wit-component` produces a core module
//! that exports every function of the world, and `default_bodies` rewrites
//! each body so the function returns an empty default (empty list, `none`,
//! `ok("")`, `false`, zero). A name list marks exports that trap instead. This
//! needs no wasm target and no committed binary, and it breaks loudly if the
//! WIT world and the runtime drift apart.

use super::*;
use crate::commands::extension_platform::ExtensionKind;
use std::path::PathBuf;
use wasm_encoder::{
    CodeSection, Function, Instruction, MemorySection, MemoryType, Module, RawSection,
};
use wasmparser::{CompositeInnerType, ExternalKind, Parser, Payload, TypeRef};
use wit_component::{dummy_module, embed_component_metadata, ComponentEncoder, StringEncoding};
use wit_parser::{ManglingAndAbi, Resolve};

// ---------------------------------------------------------------------------
// Fixture generation
// ---------------------------------------------------------------------------

/// Scratch address returned by the fake `cabi_realloc`. Strings and lists the
/// host passes in are copied here, so a call may overwrite the previous one.
const SCRATCH_ADDR: i32 = 4096;

/// Build a component for the `sidex-extension` world.
///
/// Every export returns an empty default, except exports whose name ends with
/// one of `trapping` (for example `"|provide-hover"`), which execute
/// `unreachable` and so trap when called.
fn build_component(trapping: &[&str]) -> Vec<u8> {
    let wit = Path::new(env!("CARGO_MANIFEST_DIR")).join("wit/world.wit");
    let mut resolve = Resolve::default();
    let (package, _) = resolve.push_path(&wit).expect("parse world.wit");
    let world = resolve
        .select_world(&[package], Some("sidex-extension"))
        .expect("select the sidex-extension world");

    let dummy = dummy_module(&resolve, world, ManglingAndAbi::Standard32);
    let mut core = default_bodies(&dummy, trapping);
    embed_component_metadata(&mut core, &resolve, world, StringEncoding::UTF8, false)
        .expect("embed component metadata");
    ComponentEncoder::default()
        .module(&core)
        .expect("load core module")
        .validate(true)
        .encode()
        .expect("encode component")
}

/// Rewrite the generated core module so exports return defaults instead of
/// trapping, and give it one page of memory so results can be read back.
fn default_bodies(bytes: &[u8], trapping: &[&str]) -> Vec<u8> {
    // Pass 1: signatures, which function index has which export name.
    let mut result_counts: Vec<usize> = Vec::new();
    let mut func_types: Vec<u32> = Vec::new();
    let mut imported_funcs = 0_u32;
    let mut export_names: HashMap<u32, String> = HashMap::new();
    for payload in Parser::new(0).parse_all(bytes) {
        match payload.expect("parse core module") {
            Payload::TypeSection(types) => {
                for group in types {
                    for ty in group.expect("type group").types() {
                        if let CompositeInnerType::Func(f) = &ty.composite_type.inner {
                            result_counts.push(f.results().len());
                        }
                    }
                }
            }
            Payload::ImportSection(imports) => {
                for import in imports.into_imports() {
                    if matches!(import.expect("import").ty, TypeRef::Func(_)) {
                        imported_funcs += 1;
                    }
                }
            }
            Payload::FunctionSection(funcs) => {
                for ty in funcs {
                    func_types.push(ty.expect("function type"));
                }
            }
            Payload::ExportSection(exports) => {
                for export in exports {
                    let export = export.expect("export");
                    if export.kind == ExternalKind::Func {
                        export_names.insert(export.index, export.name.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    // Pass 2: copy every section, replacing memory and code.
    let mut module = Module::new();
    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.expect("parse core module");
        match &payload {
            Payload::MemorySection(_) => {
                let mut memory = MemorySection::new();
                memory.memory(MemoryType {
                    minimum: 1,
                    maximum: None,
                    memory64: false,
                    shared: false,
                    page_size_log2: None,
                });
                module.section(&memory);
            }
            Payload::CodeSectionStart { .. } => {
                let mut code = CodeSection::new();
                for (i, ty) in func_types.iter().enumerate() {
                    let index = imported_funcs + u32::try_from(i).expect("function index");
                    let name = export_names.get(&index).map_or("", String::as_str);
                    let mut body = Function::new([]);
                    if trapping.iter().any(|t| name.ends_with(t)) {
                        body.instruction(&Instruction::Unreachable);
                    } else if name == "cm32p2_realloc" {
                        body.instruction(&Instruction::I32Const(SCRATCH_ADDR));
                    } else if result_counts[*ty as usize] == 1 {
                        // A pointer to zeroed memory reads back as an empty
                        // result, and zero is a valid scalar.
                        body.instruction(&Instruction::I32Const(0));
                    }
                    body.instruction(&Instruction::End);
                    code.function(&body);
                }
                module.section(&code);
            }
            Payload::CodeSectionEntry(_) => {}
            other => {
                if let Some((id, range)) = other.as_section() {
                    let data = &bytes[usize::try_from(range.start).expect("offset")
                        ..usize::try_from(range.end).expect("offset")];
                    module.section(&RawSection { id, data });
                }
            }
        }
    }
    module.finish()
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn scratch_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("sidex-wasm-e2e-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create scratch dir");
    dir
}

/// Write `bytes` to `<dir>/<name>` and return the path.
fn write_file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("write fixture");
    path
}

fn manifest(id: &str, wasm: Option<&Path>) -> ExtensionManifest {
    ExtensionManifest {
        id: id.into(),
        publisher: String::new(),
        name: id.into(),
        display_name: id.into(),
        version: "0.0.0".into(),
        path: wasm
            .and_then(Path::parent)
            .map_or_else(|| ".".into(), |p| p.to_string_lossy().into_owned()),
        kind: ExtensionKind::Wasm,
        main: None,
        browser: None,
        wasm_binary: wasm
            .and_then(Path::file_name)
            .map(|f| f.to_string_lossy().into_owned()),
        source: "user".into(),
        builtin: false,
        activation_events: Vec::new(),
        contributes_keys: Vec::new(),
    }
}

fn load(rt: &WasmExtensionRuntime, id: &str, wasm: &Path) -> Result<(), String> {
    rt.load_extension(&manifest(id, Some(wasm)))
}

fn loaded(rt: &WasmExtensionRuntime) -> Vec<String> {
    let mut ids = rt.loaded_extension_ids();
    ids.sort();
    ids
}

/// Call `execute-command` on one loaded extension. The outer error is a trap.
fn execute(rt: &WasmExtensionRuntime, id: &str) -> wasmtime::Result<Result<String, String>> {
    let mut guard = rt.lock_state();
    let ext = guard.extensions.get_mut(id).expect("extension is loaded");
    ext.bindings
        .sidex_extension_extension_api()
        .call_execute_command(&mut ext.store, "acme.run", "{}")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn an_empty_extension_loads_answers_and_unloads() {
    let dir = scratch_dir("lifecycle");
    let wasm = write_file(&dir, "ext.wasm", &build_component(&[]));
    let rt = WasmExtensionRuntime::new().expect("create runtime");

    load(&rt, "acme.empty", &wasm).expect("load");
    assert_eq!(loaded(&rt), ["acme.empty"]);

    {
        let mut guard = rt.lock_state();
        let ext = guard.extensions.get_mut("acme.empty").expect("loaded");
        let name = ext
            .bindings
            .sidex_extension_extension_api()
            .call_get_name(&mut ext.store)
            .expect("get-name");
        assert_eq!(name, "");
    }
    assert_eq!(
        execute(&rt, "acme.empty").expect("no trap"),
        Ok(String::new())
    );

    rt.unload_extension("acme.empty");
    assert_eq!(loaded(&rt), Vec::<String>::new());
    // Unloading something that is not loaded is harmless.
    rt.unload_extension("acme.empty");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_trap_in_activate_is_reported_and_the_runtime_stays_usable() {
    let dir = scratch_dir("activate-trap");
    let bad = write_file(&dir, "bad.wasm", &build_component(&["|activate"]));
    let good = write_file(&dir, "good.wasm", &build_component(&[]));
    let rt = WasmExtensionRuntime::new().expect("create runtime");

    let err = load(&rt, "acme.bad", &bad).expect_err("activate traps");
    assert!(err.contains("activate failed for acme.bad"), "{err}");
    assert!(loaded(&rt).is_empty(), "a failed load must not register");
    assert!(!rt.inner.is_poisoned());

    load(&rt, "acme.good", &good).expect("load after trap");
    assert_eq!(loaded(&rt), ["acme.good"]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn load_failures_are_errors_not_panics() {
    let dir = scratch_dir("load-failures");
    let rt = WasmExtensionRuntime::new().expect("create runtime");

    let err = load(&rt, "acme.missing", &dir.join("missing.wasm")).expect_err("no file");
    assert!(err.contains("failed to load wasm component"), "{err}");

    let garbage = write_file(&dir, "garbage.wasm", b"this is not wasm");
    let err = load(&rt, "acme.garbage", &garbage).expect_err("bad bytes");
    assert!(err.contains("failed to load wasm component"), "{err}");

    assert_eq!(loaded(&rt), Vec::<String>::new());
    assert!(!rt.inner.is_poisoned());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_manifest_without_a_wasm_binary_is_rejected() {
    let rt = WasmExtensionRuntime::new().expect("create runtime");
    let err = rt
        .load_extension(&manifest("acme.nobinary", None))
        .expect_err("no binary");
    assert!(err.contains("no wasm_binary"), "{err}");
}

#[test]
fn a_trapping_call_does_not_affect_other_extensions_or_the_lock() {
    let dir = scratch_dir("isolation");
    let healthy = write_file(&dir, "healthy.wasm", &build_component(&[]));
    let flaky = write_file(&dir, "flaky.wasm", &build_component(&["|execute-command"]));
    let rt = WasmExtensionRuntime::new().expect("create runtime");
    load(&rt, "acme.healthy", &healthy).expect("load healthy");
    load(&rt, "acme.flaky", &flaky).expect("load flaky");
    assert_eq!(loaded(&rt), ["acme.flaky", "acme.healthy"]);

    assert!(execute(&rt, "acme.flaky").is_err(), "flaky extension traps");
    assert_eq!(
        execute(&rt, "acme.healthy").expect("no trap"),
        Ok(String::new())
    );

    // The trap does not poison the lock, and both extensions stay registered.
    assert!(!rt.inner.is_poisoned());
    assert_eq!(loaded(&rt), ["acme.flaky", "acme.healthy"]);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn a_poisoned_lock_is_recovered_by_the_next_call() {
    let dir = scratch_dir("poison");
    let wasm = write_file(&dir, "ext.wasm", &build_component(&[]));
    let rt = Arc::new(WasmExtensionRuntime::new().expect("create runtime"));
    load(&rt, "acme.empty", &wasm).expect("load");

    let clone = Arc::clone(&rt);
    let panicked = std::thread::spawn(move || {
        let _guard = clone.inner.lock().expect("lock");
        panic!("simulated panic while holding the runtime lock");
    })
    .join();
    assert!(panicked.is_err());
    assert!(rt.inner.is_poisoned());

    // The next call logs a warning, clears the poison, and keeps working.
    assert_eq!(loaded(&rt), ["acme.empty"]);
    assert!(!rt.inner.is_poisoned());
    assert_eq!(
        execute(&rt, "acme.empty").expect("no trap"),
        Ok(String::new())
    );
    let _ = std::fs::remove_dir_all(dir);
}
