//! Default implementations for extension hooks.
//!
//! The WIT-generated [`SidexExtension`] trait (the guest trait) has no default
//! methods, so implementing it directly means writing every hook, about a
//! hundred, even when an extension uses a handful. [`Extension`] has a default
//! for every hook except [`Extension::get_name`], and
//! [`export_extension_with_defaults!`](crate::export_extension_with_defaults)
//! exports a type that implements it.

use crate::exports::sidex::extension::extension_api::Guest as SidexExtension;
use crate::sidex::extension::common_types::*;

/// Implement this instead of [`SidexExtension`] to override only the hooks an
/// extension uses. Export it with
/// [`export_extension_with_defaults!`](crate::export_extension_with_defaults).
///
/// Defaults: `activate` succeeds, `get_display_name` is `get_name`, the
/// version is `0.0.0`, the publisher is `unknown`, no activation events,
/// commands, languages or views are contributed, providers return nothing,
/// and the operations that must be implemented to work (notebooks, custom
/// editors, debug adapters, commands) return an error.
pub trait Extension {
    fn activate() -> Result<(), String> {
        Ok(())
    }
    fn deactivate() {}
    /// The extension's name. Required; everything else has a default.
    fn get_name() -> String;
    fn get_display_name() -> String {
        Self::get_name()
    }
    fn get_version() -> String {
        "0.0.0".to_string()
    }
    fn get_publisher() -> String {
        "unknown".to_string()
    }
    fn get_activation_events() -> Vec<String> {
        Vec::new()
    }
    fn get_commands() -> Vec<CommandDefinition> {
        Vec::new()
    }
    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        None
    }
    fn provide_completion(_a0: DocumentContext, _a1: Position) -> Option<CompletionList> {
        None
    }
    fn provide_hover(_a0: DocumentContext, _a1: Position) -> Option<HoverResult> {
        None
    }
    fn provide_definition(_a0: DocumentContext, _a1: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_type_definition(_a0: DocumentContext, _a1: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_implementation(_a0: DocumentContext, _a1: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_declaration(_a0: DocumentContext, _a1: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_references(_a0: DocumentContext, _a1: Position) -> Vec<Location> {
        Vec::new()
    }
    fn provide_document_symbols(_a0: DocumentContext) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_code_actions(
        _a0: DocumentContext,
        _a1: Range,
        _a2: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        Vec::new()
    }
    fn provide_code_lenses(_a0: DocumentContext) -> Vec<CodeLens> {
        Vec::new()
    }
    fn provide_formatting(_a0: DocumentContext, _a1: u32, _a2: bool) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_range_formatting(
        _a0: DocumentContext,
        _a1: Range,
        _a2: u32,
        _a3: bool,
    ) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_signature_help(_a0: DocumentContext, _a1: Position) -> Option<SignatureHelpResult> {
        None
    }
    fn provide_document_highlights(_a0: DocumentContext, _a1: Position) -> Vec<DocumentHighlight> {
        Vec::new()
    }
    fn provide_rename(_a0: DocumentContext, _a1: Position, _a2: String) -> Option<RenameResult> {
        None
    }
    fn prepare_rename(_a0: DocumentContext, _a1: Position) -> Option<RenameLocation> {
        None
    }
    fn provide_folding_ranges(_a0: DocumentContext) -> Vec<FoldingRange> {
        Vec::new()
    }
    fn provide_inlay_hints(_a0: DocumentContext, _a1: Range) -> Vec<InlayHint> {
        Vec::new()
    }
    fn provide_document_links(_a0: DocumentContext) -> Vec<DocumentLink> {
        Vec::new()
    }
    fn provide_selection_ranges(_a0: DocumentContext, _a1: Vec<Position>) -> Vec<SelectionRange> {
        Vec::new()
    }
    fn provide_semantic_tokens(_a0: DocumentContext) -> Option<SemanticTokens> {
        None
    }
    fn provide_document_colors(_a0: DocumentContext) -> Vec<ColorInfo> {
        Vec::new()
    }
    fn provide_workspace_symbols(_a0: String) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn execute_command(_a0: String, _a1: String) -> Result<String, String> {
        Err("unknown command".to_string())
    }
    fn on_file_event(_a0: Vec<FileEvent>) {}
    fn on_configuration_changed(_a0: String) {}
    fn get_tree_children(_a0: String, _a1: Option<String>) -> Vec<TreeItem> {
        Vec::new()
    }
    fn get_languages() -> Vec<String> {
        Vec::new()
    }
    fn get_task_types() -> Vec<TaskDefinition> {
        Vec::new()
    }
    fn get_debug_types() -> Vec<String> {
        Vec::new()
    }
    fn get_view_ids() -> Vec<String> {
        Vec::new()
    }
    fn get_notebook_types() -> Vec<String> {
        Vec::new()
    }
    fn get_custom_editor_types() -> Vec<String> {
        Vec::new()
    }
    fn provide_completion_item_resolve(
        _a0: String,
        _a1: Option<u32>,
        _a2: Option<String>,
    ) -> Option<CompletionList> {
        None
    }
    fn provide_workspace_symbol_resolve(
        _a0: String,
        _a1: Option<String>,
    ) -> Option<DocumentSymbol> {
        None
    }
    fn provide_code_action_resolve(
        _a0: String,
        _a1: Option<String>,
        _a2: Option<String>,
    ) -> Option<CodeAction> {
        None
    }
    fn provide_code_lens_resolve(
        _a0: Range,
        _a1: Option<String>,
        _a2: Option<String>,
    ) -> Option<CodeLens> {
        None
    }
    fn provide_on_type_formatting(
        _a0: DocumentContext,
        _a1: Position,
        _a2: String,
        _a3: u32,
        _a4: bool,
    ) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_inlay_hint_resolve(
        _a0: Position,
        _a1: String,
        _a2: Option<u32>,
    ) -> Option<InlayHint> {
        None
    }
    fn provide_document_link_resolve(_a0: Range, _a1: Option<String>) -> Option<DocumentLink> {
        None
    }
    fn provide_semantic_tokens_range(_a0: DocumentContext, _a1: Range) -> Option<SemanticTokens> {
        None
    }
    fn provide_semantic_tokens_delta(_a0: DocumentContext, _a1: String) -> Option<SemanticTokens> {
        None
    }
    fn provide_color_presentation(
        _a0: DocumentContext,
        _a1: ColorInfo,
        _a2: Range,
    ) -> Vec<TextEdit> {
        Vec::new()
    }
    fn provide_call_hierarchy_incoming(_a0: DocumentContext, _a1: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_call_hierarchy_outgoing(_a0: DocumentContext, _a1: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_type_hierarchy_subtypes(_a0: DocumentContext, _a1: Position) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_type_hierarchy_supertypes(
        _a0: DocumentContext,
        _a1: Position,
    ) -> Vec<DocumentSymbol> {
        Vec::new()
    }
    fn provide_linked_editing_ranges(_a0: DocumentContext, _a1: Position) -> Vec<Range> {
        Vec::new()
    }
    fn on_document_opened(_a0: DocumentContext) {}
    fn on_document_closed(_a0: DocumentContext) {}
    fn on_document_changed(_a0: DocumentContext, _a1: Vec<TextEdit>) {}
    fn on_document_saved(_a0: DocumentContext, _a1: u32) {}
    fn on_document_will_save(_a0: DocumentContext, _a1: u32) -> Vec<TextEdit> {
        Vec::new()
    }
    fn on_document_language_changed(_a0: String, _a1: String, _a2: String) {}
    fn on_workspace_folders_changed(_a0: Vec<String>, _a1: Vec<String>) {}
    fn on_files_created(_a0: Vec<String>) {}
    fn on_files_renamed(_a0: Vec<String>, _a1: Vec<String>) {}
    fn on_files_deleted(_a0: Vec<String>) {}
    fn on_files_will_create(_a0: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_rename(
        _a0: Vec<String>,
        _a1: Vec<String>,
    ) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_files_will_delete(_a0: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        None
    }
    fn on_active_editor_changed(_a0: Option<String>) {}
    fn on_visible_editors_changed(_a0: Vec<String>) {}
    fn on_editor_selections_changed(_a0: String, _a1: Vec<Range>) {}
    fn on_editor_scroll_changed(_a0: String, _a1: Vec<Range>) {}
    fn on_editor_view_column_changed(_a0: String, _a1: u32) {}
    fn get_tree_item(_a0: String, _a1: String) -> Option<TreeItem> {
        None
    }
    fn on_tree_item_activated(_a0: String, _a1: String) {}
    fn on_tree_visibility_changed(_a0: String, _a1: bool) {}
    fn provide_tasks(_a0: Option<String>) -> Vec<TaskExecution> {
        Vec::new()
    }
    fn resolve_task(_a0: String, _a1: String) -> Option<TaskExecution> {
        None
    }
    fn on_task_started(_a0: TaskExecution) {}
    fn on_task_ended(_a0: TaskExecution, _a1: Option<i32>) {}
    fn on_task_process_started(_a0: TaskExecution, _a1: u32) {}
    fn on_task_process_ended(_a0: TaskExecution, _a1: Option<i32>) {}
    fn create_debug_adapter_descriptor(
        _a0: String,
        _a1: String,
        _a2: Vec<String>,
    ) -> Result<String, String> {
        Err("not supported".to_string())
    }
    fn on_debug_session_started(_a0: String, _a1: String, _a2: String) {}
    fn on_debug_session_stopped(_a0: String) {}
    fn on_debug_breakpoints_changed(_a0: Vec<String>, _a1: Vec<String>, _a2: Vec<String>) {}
    fn provide_notebook_serializer_deserialize(
        _a0: String,
        _a1: Vec<u8>,
    ) -> Result<Vec<NotebookCell>, String> {
        Err("not supported".to_string())
    }
    fn provide_notebook_serializer_serialize(
        _a0: String,
        _a1: Vec<NotebookCell>,
    ) -> Result<Vec<u8>, String> {
        Err("not supported".to_string())
    }
    fn provide_notebook_kernel_execute_all(
        _a0: String,
        _a1: Vec<NotebookCell>,
    ) -> Vec<NotebookCellOutput> {
        Vec::new()
    }
    fn provide_notebook_kernel_execute_cell(
        _a0: String,
        _a1: u32,
        _a2: NotebookCell,
    ) -> NotebookCellOutput {
        NotebookCellOutput { items: Vec::new() }
    }
    fn provide_notebook_kernel_interrupt(_a0: String) {}
    fn provide_tests_resolve_children(_a0: String, _a1: Option<String>) -> Vec<TestItem> {
        Vec::new()
    }
    fn provide_tests_run(_a0: String, _a1: String, _a2: Vec<String>, _a3: Vec<String>) {}
    fn provide_tests_debug(_a0: String, _a1: String, _a2: Vec<String>, _a3: Vec<String>) {}
    fn provide_tests_cancel_run(_a0: String, _a1: String) {}
    fn custom_editor_open(_a0: String, _a1: String, _a2: u32) -> Result<String, String> {
        Err("not supported".to_string())
    }
    fn custom_editor_update(_a0: String, _a1: Vec<TextEdit>) -> Result<(), String> {
        Err("not supported".to_string())
    }
    fn custom_editor_save(_a0: String) -> Result<(), String> {
        Err("not supported".to_string())
    }
    fn custom_editor_save_as(_a0: String, _a1: String) -> Result<(), String> {
        Err("not supported".to_string())
    }
    fn custom_editor_revert(_a0: String) -> Result<(), String> {
        Err("not supported".to_string())
    }
    fn custom_editor_dispose(_a0: String) {}
    fn webview_receive_message(_a0: String, _a1: String) {}
    fn on_webview_disposed(_a0: String) {}
    fn on_webview_visibility_changed(_a0: String, _a1: bool) {}
}

/// Adapter from an [`Extension`] to the WIT guest trait. Use
/// [`export_extension_with_defaults!`](crate::export_extension_with_defaults)
/// rather than naming this directly.
pub struct ExtensionComponent<T>(core::marker::PhantomData<T>);

impl<T: Extension> SidexExtension for ExtensionComponent<T> {
    fn activate() -> Result<(), String> {
        T::activate()
    }

    fn deactivate() {
        T::deactivate()
    }

    fn get_name() -> String {
        T::get_name()
    }

    fn get_display_name() -> String {
        T::get_display_name()
    }

    fn get_version() -> String {
        T::get_version()
    }

    fn get_publisher() -> String {
        T::get_publisher()
    }

    fn get_activation_events() -> Vec<String> {
        T::get_activation_events()
    }

    fn get_commands() -> Vec<CommandDefinition> {
        T::get_commands()
    }

    fn get_semantic_tokens_legend() -> Option<SemanticTokensLegend> {
        T::get_semantic_tokens_legend()
    }

    fn provide_completion(a0: DocumentContext, a1: Position) -> Option<CompletionList> {
        T::provide_completion(a0, a1)
    }

    fn provide_hover(a0: DocumentContext, a1: Position) -> Option<HoverResult> {
        T::provide_hover(a0, a1)
    }

    fn provide_definition(a0: DocumentContext, a1: Position) -> Vec<Location> {
        T::provide_definition(a0, a1)
    }

    fn provide_type_definition(a0: DocumentContext, a1: Position) -> Vec<Location> {
        T::provide_type_definition(a0, a1)
    }

    fn provide_implementation(a0: DocumentContext, a1: Position) -> Vec<Location> {
        T::provide_implementation(a0, a1)
    }

    fn provide_declaration(a0: DocumentContext, a1: Position) -> Vec<Location> {
        T::provide_declaration(a0, a1)
    }

    fn provide_references(a0: DocumentContext, a1: Position) -> Vec<Location> {
        T::provide_references(a0, a1)
    }

    fn provide_document_symbols(a0: DocumentContext) -> Vec<DocumentSymbol> {
        T::provide_document_symbols(a0)
    }

    fn provide_code_actions(
        a0: DocumentContext,
        a1: Range,
        a2: Vec<Diagnostic>,
    ) -> Vec<CodeAction> {
        T::provide_code_actions(a0, a1, a2)
    }

    fn provide_code_lenses(a0: DocumentContext) -> Vec<CodeLens> {
        T::provide_code_lenses(a0)
    }

    fn provide_formatting(a0: DocumentContext, a1: u32, a2: bool) -> Vec<TextEdit> {
        T::provide_formatting(a0, a1, a2)
    }

    fn provide_range_formatting(
        a0: DocumentContext,
        a1: Range,
        a2: u32,
        a3: bool,
    ) -> Vec<TextEdit> {
        T::provide_range_formatting(a0, a1, a2, a3)
    }

    fn provide_signature_help(a0: DocumentContext, a1: Position) -> Option<SignatureHelpResult> {
        T::provide_signature_help(a0, a1)
    }

    fn provide_document_highlights(a0: DocumentContext, a1: Position) -> Vec<DocumentHighlight> {
        T::provide_document_highlights(a0, a1)
    }

    fn provide_rename(a0: DocumentContext, a1: Position, a2: String) -> Option<RenameResult> {
        T::provide_rename(a0, a1, a2)
    }

    fn prepare_rename(a0: DocumentContext, a1: Position) -> Option<RenameLocation> {
        T::prepare_rename(a0, a1)
    }

    fn provide_folding_ranges(a0: DocumentContext) -> Vec<FoldingRange> {
        T::provide_folding_ranges(a0)
    }

    fn provide_inlay_hints(a0: DocumentContext, a1: Range) -> Vec<InlayHint> {
        T::provide_inlay_hints(a0, a1)
    }

    fn provide_document_links(a0: DocumentContext) -> Vec<DocumentLink> {
        T::provide_document_links(a0)
    }

    fn provide_selection_ranges(a0: DocumentContext, a1: Vec<Position>) -> Vec<SelectionRange> {
        T::provide_selection_ranges(a0, a1)
    }

    fn provide_semantic_tokens(a0: DocumentContext) -> Option<SemanticTokens> {
        T::provide_semantic_tokens(a0)
    }

    fn provide_document_colors(a0: DocumentContext) -> Vec<ColorInfo> {
        T::provide_document_colors(a0)
    }

    fn provide_workspace_symbols(a0: String) -> Vec<DocumentSymbol> {
        T::provide_workspace_symbols(a0)
    }

    fn execute_command(a0: String, a1: String) -> Result<String, String> {
        T::execute_command(a0, a1)
    }

    fn on_file_event(a0: Vec<FileEvent>) {
        T::on_file_event(a0)
    }

    fn on_configuration_changed(a0: String) {
        T::on_configuration_changed(a0)
    }

    fn get_tree_children(a0: String, a1: Option<String>) -> Vec<TreeItem> {
        T::get_tree_children(a0, a1)
    }

    fn get_languages() -> Vec<String> {
        T::get_languages()
    }

    fn get_task_types() -> Vec<TaskDefinition> {
        T::get_task_types()
    }

    fn get_debug_types() -> Vec<String> {
        T::get_debug_types()
    }

    fn get_view_ids() -> Vec<String> {
        T::get_view_ids()
    }

    fn get_notebook_types() -> Vec<String> {
        T::get_notebook_types()
    }

    fn get_custom_editor_types() -> Vec<String> {
        T::get_custom_editor_types()
    }

    fn provide_completion_item_resolve(
        a0: String,
        a1: Option<u32>,
        a2: Option<String>,
    ) -> Option<CompletionList> {
        T::provide_completion_item_resolve(a0, a1, a2)
    }

    fn provide_workspace_symbol_resolve(a0: String, a1: Option<String>) -> Option<DocumentSymbol> {
        T::provide_workspace_symbol_resolve(a0, a1)
    }

    fn provide_code_action_resolve(
        a0: String,
        a1: Option<String>,
        a2: Option<String>,
    ) -> Option<CodeAction> {
        T::provide_code_action_resolve(a0, a1, a2)
    }

    fn provide_code_lens_resolve(
        a0: Range,
        a1: Option<String>,
        a2: Option<String>,
    ) -> Option<CodeLens> {
        T::provide_code_lens_resolve(a0, a1, a2)
    }

    fn provide_on_type_formatting(
        a0: DocumentContext,
        a1: Position,
        a2: String,
        a3: u32,
        a4: bool,
    ) -> Vec<TextEdit> {
        T::provide_on_type_formatting(a0, a1, a2, a3, a4)
    }

    fn provide_inlay_hint_resolve(a0: Position, a1: String, a2: Option<u32>) -> Option<InlayHint> {
        T::provide_inlay_hint_resolve(a0, a1, a2)
    }

    fn provide_document_link_resolve(a0: Range, a1: Option<String>) -> Option<DocumentLink> {
        T::provide_document_link_resolve(a0, a1)
    }

    fn provide_semantic_tokens_range(a0: DocumentContext, a1: Range) -> Option<SemanticTokens> {
        T::provide_semantic_tokens_range(a0, a1)
    }

    fn provide_semantic_tokens_delta(a0: DocumentContext, a1: String) -> Option<SemanticTokens> {
        T::provide_semantic_tokens_delta(a0, a1)
    }

    fn provide_color_presentation(a0: DocumentContext, a1: ColorInfo, a2: Range) -> Vec<TextEdit> {
        T::provide_color_presentation(a0, a1, a2)
    }

    fn provide_call_hierarchy_incoming(a0: DocumentContext, a1: Position) -> Vec<DocumentSymbol> {
        T::provide_call_hierarchy_incoming(a0, a1)
    }

    fn provide_call_hierarchy_outgoing(a0: DocumentContext, a1: Position) -> Vec<DocumentSymbol> {
        T::provide_call_hierarchy_outgoing(a0, a1)
    }

    fn provide_type_hierarchy_subtypes(a0: DocumentContext, a1: Position) -> Vec<DocumentSymbol> {
        T::provide_type_hierarchy_subtypes(a0, a1)
    }

    fn provide_type_hierarchy_supertypes(a0: DocumentContext, a1: Position) -> Vec<DocumentSymbol> {
        T::provide_type_hierarchy_supertypes(a0, a1)
    }

    fn provide_linked_editing_ranges(a0: DocumentContext, a1: Position) -> Vec<Range> {
        T::provide_linked_editing_ranges(a0, a1)
    }

    fn on_document_opened(a0: DocumentContext) {
        T::on_document_opened(a0)
    }

    fn on_document_closed(a0: DocumentContext) {
        T::on_document_closed(a0)
    }

    fn on_document_changed(a0: DocumentContext, a1: Vec<TextEdit>) {
        T::on_document_changed(a0, a1)
    }

    fn on_document_saved(a0: DocumentContext, a1: u32) {
        T::on_document_saved(a0, a1)
    }

    fn on_document_will_save(a0: DocumentContext, a1: u32) -> Vec<TextEdit> {
        T::on_document_will_save(a0, a1)
    }

    fn on_document_language_changed(a0: String, a1: String, a2: String) {
        T::on_document_language_changed(a0, a1, a2)
    }

    fn on_workspace_folders_changed(a0: Vec<String>, a1: Vec<String>) {
        T::on_workspace_folders_changed(a0, a1)
    }

    fn on_files_created(a0: Vec<String>) {
        T::on_files_created(a0)
    }

    fn on_files_renamed(a0: Vec<String>, a1: Vec<String>) {
        T::on_files_renamed(a0, a1)
    }

    fn on_files_deleted(a0: Vec<String>) {
        T::on_files_deleted(a0)
    }

    fn on_files_will_create(a0: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_create(a0)
    }

    fn on_files_will_rename(
        a0: Vec<String>,
        a1: Vec<String>,
    ) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_rename(a0, a1)
    }

    fn on_files_will_delete(a0: Vec<String>) -> Option<Vec<(String, Vec<TextEdit>)>> {
        T::on_files_will_delete(a0)
    }

    fn on_active_editor_changed(a0: Option<String>) {
        T::on_active_editor_changed(a0)
    }

    fn on_visible_editors_changed(a0: Vec<String>) {
        T::on_visible_editors_changed(a0)
    }

    fn on_editor_selections_changed(a0: String, a1: Vec<Range>) {
        T::on_editor_selections_changed(a0, a1)
    }

    fn on_editor_scroll_changed(a0: String, a1: Vec<Range>) {
        T::on_editor_scroll_changed(a0, a1)
    }

    fn on_editor_view_column_changed(a0: String, a1: u32) {
        T::on_editor_view_column_changed(a0, a1)
    }

    fn get_tree_item(a0: String, a1: String) -> Option<TreeItem> {
        T::get_tree_item(a0, a1)
    }

    fn on_tree_item_activated(a0: String, a1: String) {
        T::on_tree_item_activated(a0, a1)
    }

    fn on_tree_visibility_changed(a0: String, a1: bool) {
        T::on_tree_visibility_changed(a0, a1)
    }

    fn provide_tasks(a0: Option<String>) -> Vec<TaskExecution> {
        T::provide_tasks(a0)
    }

    fn resolve_task(a0: String, a1: String) -> Option<TaskExecution> {
        T::resolve_task(a0, a1)
    }

    fn on_task_started(a0: TaskExecution) {
        T::on_task_started(a0)
    }

    fn on_task_ended(a0: TaskExecution, a1: Option<i32>) {
        T::on_task_ended(a0, a1)
    }

    fn on_task_process_started(a0: TaskExecution, a1: u32) {
        T::on_task_process_started(a0, a1)
    }

    fn on_task_process_ended(a0: TaskExecution, a1: Option<i32>) {
        T::on_task_process_ended(a0, a1)
    }

    fn create_debug_adapter_descriptor(
        a0: String,
        a1: String,
        a2: Vec<String>,
    ) -> Result<String, String> {
        T::create_debug_adapter_descriptor(a0, a1, a2)
    }

    fn on_debug_session_started(a0: String, a1: String, a2: String) {
        T::on_debug_session_started(a0, a1, a2)
    }

    fn on_debug_session_stopped(a0: String) {
        T::on_debug_session_stopped(a0)
    }

    fn on_debug_breakpoints_changed(a0: Vec<String>, a1: Vec<String>, a2: Vec<String>) {
        T::on_debug_breakpoints_changed(a0, a1, a2)
    }

    fn provide_notebook_serializer_deserialize(
        a0: String,
        a1: Vec<u8>,
    ) -> Result<Vec<NotebookCell>, String> {
        T::provide_notebook_serializer_deserialize(a0, a1)
    }

    fn provide_notebook_serializer_serialize(
        a0: String,
        a1: Vec<NotebookCell>,
    ) -> Result<Vec<u8>, String> {
        T::provide_notebook_serializer_serialize(a0, a1)
    }

    fn provide_notebook_kernel_execute_all(
        a0: String,
        a1: Vec<NotebookCell>,
    ) -> Vec<NotebookCellOutput> {
        T::provide_notebook_kernel_execute_all(a0, a1)
    }

    fn provide_notebook_kernel_execute_cell(
        a0: String,
        a1: u32,
        a2: NotebookCell,
    ) -> NotebookCellOutput {
        T::provide_notebook_kernel_execute_cell(a0, a1, a2)
    }

    fn provide_notebook_kernel_interrupt(a0: String) {
        T::provide_notebook_kernel_interrupt(a0)
    }

    fn provide_tests_resolve_children(a0: String, a1: Option<String>) -> Vec<TestItem> {
        T::provide_tests_resolve_children(a0, a1)
    }

    fn provide_tests_run(a0: String, a1: String, a2: Vec<String>, a3: Vec<String>) {
        T::provide_tests_run(a0, a1, a2, a3)
    }

    fn provide_tests_debug(a0: String, a1: String, a2: Vec<String>, a3: Vec<String>) {
        T::provide_tests_debug(a0, a1, a2, a3)
    }

    fn provide_tests_cancel_run(a0: String, a1: String) {
        T::provide_tests_cancel_run(a0, a1)
    }

    fn custom_editor_open(a0: String, a1: String, a2: u32) -> Result<String, String> {
        T::custom_editor_open(a0, a1, a2)
    }

    fn custom_editor_update(a0: String, a1: Vec<TextEdit>) -> Result<(), String> {
        T::custom_editor_update(a0, a1)
    }

    fn custom_editor_save(a0: String) -> Result<(), String> {
        T::custom_editor_save(a0)
    }

    fn custom_editor_save_as(a0: String, a1: String) -> Result<(), String> {
        T::custom_editor_save_as(a0, a1)
    }

    fn custom_editor_revert(a0: String) -> Result<(), String> {
        T::custom_editor_revert(a0)
    }

    fn custom_editor_dispose(a0: String) {
        T::custom_editor_dispose(a0)
    }

    fn webview_receive_message(a0: String, a1: String) {
        T::webview_receive_message(a0, a1)
    }

    fn on_webview_disposed(a0: String) {
        T::on_webview_disposed(a0)
    }

    fn on_webview_visibility_changed(a0: String, a1: bool) {
        T::on_webview_visibility_changed(a0, a1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Implements only the required hook.
    struct Minimal;
    impl Extension for Minimal {
        fn get_name() -> String {
            "Minimal".to_string()
        }
    }

    /// Overrides a few hooks of different shapes.
    struct Custom;
    impl Extension for Custom {
        fn get_name() -> String {
            "Custom".to_string()
        }
        fn get_version() -> String {
            "2.1.0".to_string()
        }
        fn get_languages() -> Vec<String> {
            vec!["toml".to_string()]
        }
        fn execute_command(command_id: String, args: String) -> Result<String, String> {
            Ok(format!("{command_id}:{args}"))
        }
    }

    type Guest<T> = ExtensionComponent<T>;

    #[test]
    fn a_minimal_extension_gets_working_defaults() {
        assert_eq!(<Minimal as Extension>::get_display_name(), "Minimal");
        assert_eq!(<Minimal as Extension>::get_version(), "0.0.0");
        assert_eq!(<Minimal as Extension>::get_publisher(), "unknown");
        assert_eq!(<Minimal as Extension>::activate(), Ok(()));
        assert!(<Minimal as Extension>::get_activation_events().is_empty());
        assert!(<Minimal as Extension>::get_commands().is_empty());
        assert!(<Minimal as Extension>::get_languages().is_empty());
    }

    #[test]
    fn operations_that_need_an_implementation_return_an_error() {
        assert!(<Minimal as Extension>::execute_command("x".into(), String::new()).is_err());
        assert!(<Minimal as Extension>::custom_editor_open("a".into(), "b".into(), 0).is_err());
        assert!(<Minimal as Extension>::custom_editor_save("a".into()).is_err());
        assert!(<Minimal as Extension>::create_debug_adapter_descriptor(
            "t".into(),
            "s".into(),
            Vec::new()
        )
        .is_err());
    }

    #[test]
    fn providers_default_to_nothing() {
        assert!(<Minimal as Extension>::get_tree_children("v".into(), None).is_empty());
        assert!(<Minimal as Extension>::provide_workspace_symbols("q".into()).is_empty());
        assert!(<Minimal as Extension>::get_tree_item("v".into(), "e".into()).is_none());
        assert!(<Minimal as Extension>::provide_tasks(None).is_empty());
        let out = <Minimal as Extension>::provide_notebook_kernel_execute_cell(
            "k".into(),
            0,
            NotebookCell {
                index: 0,
                kind: NotebookCellKind::Code,
                language_id: String::new(),
                value: String::new(),
                metadata: Vec::new(),
            },
        );
        assert!(out.items.is_empty());
    }

    #[test]
    fn the_adapter_forwards_overrides_and_defaults_to_the_guest_trait() {
        assert_eq!(<Guest<Custom> as SidexExtension>::get_version(), "2.1.0");
        assert_eq!(
            <Guest<Custom> as SidexExtension>::get_languages(),
            vec!["toml".to_string()]
        );
        assert_eq!(
            <Guest<Custom> as SidexExtension>::execute_command("go".into(), "now".into()),
            Ok("go:now".to_string())
        );
        // Not overridden: falls back to the default through the adapter.
        assert_eq!(
            <Guest<Custom> as SidexExtension>::get_publisher(),
            "unknown"
        );
        assert_eq!(
            <Guest<Custom> as SidexExtension>::get_display_name(),
            "Custom"
        );
        assert!(<Guest<Custom> as SidexExtension>::provide_tasks(None).is_empty());
    }
}
