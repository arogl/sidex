use sidex_extension_sdk::prelude::*;

struct HelloExtension;

impl SidexExtension for HelloExtension {
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

    fn get_display_name() -> String {
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

    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        None
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

    fn provide_definition(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        vec![]
    }

    fn provide_type_definition(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        vec![]
    }

    fn provide_implementation(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        vec![]
    }

    fn provide_declaration(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        vec![]
    }

    fn provide_references(_ctx: DocumentContext, _pos: Position) -> Vec<Location> {
        vec![]
    }

    fn provide_document_symbols(_ctx: DocumentContext) -> Vec<DocumentSymbol> {
        vec![]
    }

    fn provide_code_actions(
        _ctx: DocumentContext,
        _range: Range,
        _diagnostics: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        vec![]
    }

    fn provide_code_lenses(_ctx: DocumentContext) -> Vec<CodeLens> {
        vec![]
    }

    fn provide_formatting(
        _ctx: DocumentContext,
        _tab_size: u32,
        _insert_spaces: bool,
    ) -> Vec<TextEdit> {
        vec![]
    }

    fn provide_range_formatting(
        _ctx: DocumentContext,
        _range: Range,
        _tab_size: u32,
        _insert_spaces: bool,
    ) -> Vec<TextEdit> {
        vec![]
    }

    fn provide_signature_help(
        _ctx: DocumentContext,
        _pos: Position,
    ) -> Option<SignatureHelpResult> {
        None
    }

    fn provide_document_highlights(
        _ctx: DocumentContext,
        _pos: Position,
    ) -> Vec<DocumentHighlight> {
        vec![]
    }

    fn provide_rename(
        _ctx: DocumentContext,
        _pos: Position,
        _new_name: String,
    ) -> Option<RenameResult> {
        None
    }

    fn prepare_rename(_ctx: DocumentContext, _pos: Position) -> Option<RenameLocation> {
        None
    }

    fn provide_folding_ranges(_ctx: DocumentContext) -> Vec<FoldingRange> {
        vec![]
    }

    fn provide_inlay_hints(_ctx: DocumentContext, _range: Range) -> Vec<InlayHint> {
        vec![]
    }

    fn provide_document_links(_ctx: DocumentContext) -> Vec<DocumentLink> {
        vec![]
    }

    fn provide_selection_ranges(
        _ctx: DocumentContext,
        _positions: Vec<Position>,
    ) -> Vec<SelectionRange> {
        vec![]
    }

    fn provide_semantic_tokens(_ctx: DocumentContext) -> Option<SemanticTokens> {
        None
    }

    fn provide_document_colors(_ctx: DocumentContext) -> Vec<ColorInfo> {
        vec![]
    }

    fn provide_workspace_symbols(_query: String) -> Vec<DocumentSymbol> {
        vec![]
    }

    fn execute_command(command_id: String, _args: String) -> Result<String, String> {
        if command_id == "hello.sayHello" {
            host::show_info_message("Hello from a native Rust extension command!");
            Ok("hello!".to_string())
        } else {
            Err(format!("unknown command: {command_id}"))
        }
    }

    fn on_file_event(_events: Vec<FileEvent>) {}

    fn on_configuration_changed(_section: String) {}

    fn get_tree_children(_view_id: String, _element_id: Option<String>) -> Vec<TreeItem> {
        vec![]
    }

    // The trait has no default methods, so every hook an extension does not
    // use still needs an empty implementation.
    fn get_languages() -> Vec<String> {
        vec![]
    }
    fn get_task_types() -> Vec<TaskDefinition> {
        vec![]
    }
    fn get_debug_types() -> Vec<String> {
        vec![]
    }
    fn get_view_ids() -> Vec<String> {
        vec![]
    }
    fn get_notebook_types() -> Vec<String> {
        vec![]
    }
    fn get_custom_editor_types() -> Vec<String> {
        vec![]
    }
    fn provide_completion_item_resolve(
        _: String,
        _: Option<u32>,
        _: Option<String>,
    ) -> Option<CompletionList> {
        None
    }
    fn provide_workspace_symbol_resolve(_: String, _: Option<String>) -> Option<DocumentSymbol> {
        None
    }
    fn provide_code_action_resolve(
        _: String,
        _: Option<String>,
        _: Option<String>,
    ) -> Option<CodeAction> {
        None
    }
    fn provide_code_lens_resolve(
        _: Range,
        _: Option<String>,
        _: Option<String>,
    ) -> Option<CodeLens> {
        None
    }
    fn provide_on_type_formatting(
        _: DocumentContext,
        _: Position,
        _: String,
        _: u32,
        _: bool,
    ) -> Vec<TextEdit> {
        vec![]
    }
    fn provide_inlay_hint_resolve(_: Position, _: String, _: Option<u32>) -> Option<InlayHint> {
        None
    }
    fn provide_document_link_resolve(_: Range, _: Option<String>) -> Option<DocumentLink> {
        None
    }
    fn provide_semantic_tokens_range(_: DocumentContext, _: Range) -> Option<SemanticTokens> {
        None
    }
    fn provide_semantic_tokens_delta(_: DocumentContext, _: String) -> Option<SemanticTokens> {
        None
    }
    fn provide_color_presentation(_: DocumentContext, _: ColorInfo, _: Range) -> Vec<TextEdit> {
        vec![]
    }
    fn provide_call_hierarchy_incoming(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> {
        vec![]
    }
    fn provide_call_hierarchy_outgoing(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> {
        vec![]
    }
    fn provide_type_hierarchy_subtypes(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> {
        vec![]
    }
    fn provide_type_hierarchy_supertypes(_: DocumentContext, _: Position) -> Vec<DocumentSymbol> {
        vec![]
    }
    fn provide_linked_editing_ranges(_: DocumentContext, _: Position) -> Vec<Range> {
        vec![]
    }
    fn on_document_opened(_: DocumentContext) {}
    fn on_document_closed(_: DocumentContext) {}
    fn on_document_changed(_: DocumentContext, _: Vec<TextEdit>) {}
    fn on_document_saved(_: DocumentContext, _: u32) {}
    fn on_document_will_save(_: DocumentContext, _: u32) -> Vec<TextEdit> {
        vec![]
    }
    fn on_document_language_changed(_: String, _: String, _: String) {}
    fn on_workspace_folders_changed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_created(_: Vec<String>) {}
    fn on_files_renamed(_: Vec<String>, _: Vec<String>) {}
    fn on_files_deleted(_: Vec<String>) {}
    fn on_files_will_create(_: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_rename(
        _: Vec<String>,
        _: Vec<String>,
    ) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_delete(_: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_active_editor_changed(_: Option<String>) {}
    fn on_visible_editors_changed(_: Vec<String>) {}
    fn on_editor_selections_changed(_: String, _: Vec<Range>) {}
    fn on_editor_scroll_changed(_: String, _: Vec<Range>) {}
    fn on_editor_view_column_changed(_: String, _: u32) {}
    fn get_tree_item(_: String, _: String) -> Option<TreeItem> {
        None
    }
    fn on_tree_item_activated(_: String, _: String) {}
    fn on_tree_visibility_changed(_: String, _: bool) {}
    fn provide_tasks(_: Option<String>) -> Vec<TaskExecution> {
        vec![]
    }
    fn resolve_task(_: String, _: String) -> Option<TaskExecution> {
        None
    }
    fn on_task_started(_: TaskExecution) {}
    fn on_task_ended(_: TaskExecution, _: Option<i32>) {}
    fn on_task_process_started(_: TaskExecution, _: u32) {}
    fn on_task_process_ended(_: TaskExecution, _: Option<i32>) {}
    fn create_debug_adapter_descriptor(
        _: String,
        _: String,
        _: Vec<String>,
    ) -> Result<String, String> {
        Err("not supported".into())
    }
    fn on_debug_session_started(_: String, _: String, _: String) {}
    fn on_debug_session_stopped(_: String) {}
    fn on_debug_breakpoints_changed(_: Vec<String>, _: Vec<String>, _: Vec<String>) {}
    fn provide_notebook_serializer_deserialize(
        _: String,
        _: Vec<u8>,
    ) -> Result<Vec<NotebookCell>, String> {
        Err("not supported".into())
    }
    fn provide_notebook_serializer_serialize(
        _: String,
        _: Vec<NotebookCell>,
    ) -> Result<Vec<u8>, String> {
        Err("not supported".into())
    }
    fn provide_notebook_kernel_execute_all(
        _: String,
        _: Vec<NotebookCell>,
    ) -> Vec<NotebookCellOutput> {
        vec![]
    }
    fn provide_notebook_kernel_execute_cell(
        _: String,
        _: u32,
        _: NotebookCell,
    ) -> NotebookCellOutput {
        NotebookCellOutput { items: vec![] }
    }
    fn provide_notebook_kernel_interrupt(_: String) {}
    fn provide_tests_resolve_children(_: String, _: Option<String>) -> Vec<TestItem> {
        vec![]
    }
    fn provide_tests_run(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_debug(_: String, _: String, _: Vec<String>, _: Vec<String>) {}
    fn provide_tests_cancel_run(_: String, _: String) {}
    fn custom_editor_open(_: String, _: String, _: u32) -> Result<String, String> {
        Err("not supported".into())
    }
    fn custom_editor_update(_: String, _: Vec<TextEdit>) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_save(_: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_save_as(_: String, _: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_revert(_: String) -> Result<(), String> {
        Err("not supported".into())
    }
    fn custom_editor_dispose(_: String) {}
    fn webview_receive_message(_: String, _: String) {}
    fn on_webview_disposed(_: String) {}
    fn on_webview_visibility_changed(_: String, _: bool) {}
}

sidex_extension_sdk::export_extension!(HelloExtension);
