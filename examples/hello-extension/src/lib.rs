use sidex_extension_sdk::prelude::*;

struct HelloExtension;

// `Extension` has a default for every hook except `get_name`, so this
// implements only what the example uses. Implement `SidexExtension` instead
// if you need to control every hook (see `extensions-wasm/` for that style).
impl Extension for HelloExtension {
    fn activate() -> Result<(), String> {
        host::log_info("Hello extension activated!");
        host::show_info_message("Hello from a native Rust extension!");
        Ok(())
    }

    fn deactivate() {
        host::log_info("Hello extension deactivated.");
    }

    fn get_name() -> String {
        "Hello Extension".to_string()
    }

    fn get_version() -> String {
        "0.1.0".to_string()
    }

    fn get_publisher() -> String {
        "sidex".to_string()
    }

    fn get_activation_events() -> Vec<String> {
        vec!["*".to_string()]
    }

    fn get_commands() -> Vec<CommandDefinition> {
        vec![CommandDefinition {
            id: "hello.sayHello".to_string(),
            title: "Say Hello".to_string(),
        }]
    }

    fn provide_completion(_ctx: DocumentContext, _pos: Position) -> Option<CompletionList> {
        Some(CompletionList {
            items: vec![CompletionItem {
                label: "hello_world".to_string(),
                kind: Some(2),
                detail: Some("A greeting from Rust".to_string()),
                documentation: Some(
                    "This completion item comes from a native WASM extension written in Rust."
                        .to_string(),
                ),
                insert_text: Some("hello_world()".to_string()),
                sort_text: None,
                filter_text: None,
            }],
            is_incomplete: false,
        })
    }

    fn provide_hover(_ctx: DocumentContext, _pos: Position) -> Option<HoverResult> {
        Some(HoverResult {
            contents: vec![
                "**Hello Extension**\n\nThis hover comes from a native Rust WASM extension."
                    .to_string(),
            ],
            range: None,
        })
    }

    fn execute_command(command_id: String, _args: String) -> Result<String, String> {
        if command_id == "hello.sayHello" {
            host::show_info_message("Hello from a native Rust extension command!");
            Ok("hello!".to_string())
        } else {
            Err(format!("unknown command: {command_id}"))
        }
    }
}

sidex_extension_sdk::export_extension_with_defaults!(HelloExtension);
