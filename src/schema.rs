use serde::{Deserialize, Serialize};
use schemars::JsonSchema;
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// â”€â”€â”€ Node type enum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Every node variant carries its own config fields inline (discriminated union).
/// The `type` field is the tag that drives deserialization.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type")]
pub enum NodeType {
    FileWatcherNode(FileWatcherConfig),
    TextInputNode(TextInputConfig),
    ImageInputNode(ImageInputConfig),
    OllamaSelectorNode(OllamaSelectorConfig),
    LocalEmbedderNode(LocalEmbedderConfig),
    PDFExtractorNode(PDFExtractorConfig),
    ChromaDbStoreNode(ChromaDbStoreConfig),
    ConditionalRouterNode(ConditionalRouterConfig),
    LocalFileWriterNode(LocalFileWriterConfig),
    WebScraperNode(WebScraperConfig),
    ShellCommandNode(ShellCommandConfig),
    RegexExtractorNode(RegexExtractorConfig),
    ScheduleNode(ScheduleConfig),
    SourceFileNode(SourceFileConfig),
    DatasetProfileNode(DatasetProfileConfig),
    TransformAggregateNode(TransformAggregateConfig),
    AnalysisStatsHypothesisTestNode(AnalysisStatsHypothesisTestConfig),
    AiInterpretNode(AiInterpretConfig),
    AiPlanNode(AiPlanConfig),
    NotifyDesktopNode(NotifyDesktopConfig),
    NotifyWebhookNode(NotifyWebhookConfig),
    ClipboardTriggerNode(ClipboardTriggerConfig),
    CsvReaderNode(CsvReaderConfig),
    DelayNode(DelayConfig),
    TemplateFormatterNode(TemplateFormatterConfig),
    MergeNode(MergeConfig),
}

// â”€â”€â”€ Per-variant config structs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileWatcherConfig {
    /// Directory path to watch.
    pub watch_path: String,
    /// Glob pattern to filter events (e.g. "*.pdf").
    pub pattern: Option<String>,
    /// Whether to watch subdirectories recursively.
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TextInputConfig {
    /// Static text content, or a template using `{{node_id.output}}` references.
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImageInputConfig {
    /// Absolute or relative path to the image file.
    pub image_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSelectorConfig {
    pub model: String,
    /// Prompt template. Use `{{input}}` (single-input shorthand) or
    /// `{{node_id.output}}` for explicit references.
    pub prompt_template: String,
    /// If true, request JSON-formatted output from the model.
    #[serde(default)]
    pub json_mode: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalEmbedderConfig {
    /// Embedding model identifier (e.g. "nomic-embed-text").
    pub model: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PDFExtractorConfig {
    /// If provided, only extract this range of pages (1-indexed, inclusive).
    pub page_range: Option<(u32, u32)>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChromaDbStoreConfig {
    /// Name of the ChromaDB collection to upsert into.
    pub collection_name: String,
    /// ChromaDB base URL (default: "http://localhost:8000").
    #[serde(default = "default_chroma_url")]
    pub chroma_url: String,
    /// Named input bindings: maps logical input names (e.g. "vector", "document")
    /// to `"node_id.output"` references. Fixes the gap from the TypeScript prototype.
    pub input_map: Option<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalRouterConfig {
    /// CEL-style condition expression evaluated against the input string.
    pub condition: String,
    /// Node id to route to when condition is true.
    pub true_target: String,
    /// Node id to route to when condition is false.
    pub false_target: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileWriterConfig {
    /// Output file path. Supports `{{node_id.output}}` for dynamic paths.
    pub output_path: String,
    /// If true, append rather than overwrite.
    #[serde(default)]
    pub append: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebScraperConfig {
    /// The URL to scrape. Supports `{{node_id.output}}` or `{{input}}`.
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandConfig {
    /// The shell command to run. Supports `{{node_id.output}}` or `{{input}}`.
    pub command: String,
    /// Must be explicitly enabled to execute raw shell commands containing input interpolation
    pub unsafe_raw_shell: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegexExtractorConfig {
    /// The regex pattern to apply to the input.
    pub pattern: String,
    /// The group index to extract (0 for full match).
    #[serde(default)]
    pub group: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotifyDesktopConfig {
    /// The title of the desktop notification
    pub title: String,
    /// The body text of the notification, supports `{{input}}` and `{{node_id.output}}`
    pub body: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotifyWebhookConfig {
    /// The URL of the webhook
    pub url: String,
    /// The JSON payload template, supports `{{input}}` and `{{node_id.output}}`
    pub payload: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardTriggerConfig {
    #[serde(default)]
    pub only_text: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CsvReaderConfig {
    pub file_path: String,
    #[serde(default = "default_true")]
    pub has_header_row: bool,
}
fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DelayConfig {
    pub duration_seconds: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFormatterConfig {
    pub template: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeConfig {
    // Merge node doesn't explicitly need config other than being connected to two inputs.
    // We could allow users to rename inputs, but defaulting to standard names or simple object is fine.
    #[serde(default)]
    pub _dummy: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    /// Cron expression (6 fields including seconds), e.g. "0 0 */2 * * *" for every 2 hours
    pub cron_expression: String,
}

// â”€â”€â”€ Graph structs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// A node in the graph. `position` is optional/unused in CLI mode but kept for
/// forward JSON-compatibility when a GUI is added.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct GraphNode {
    pub id: String,
    pub position: Option<(f64, f64)>,
    pub data: NodeType,
}

/// A directed edge between two nodes, with optional named handles for
/// multi-output/multi-input scenarios.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub source_handle: Option<String>,
    pub target: String,
    pub target_handle: Option<String>,
}

/// A complete workflow graph.
#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub struct Graph {
    #[serde(default = "default_version")]
    pub version: u32,
    pub name: Option<String>,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

// â”€â”€â”€ Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fn default_chroma_url() -> String {
    "http://localhost:8000".to_string()
}

fn default_version() -> u32 {
    1
}

// ─── Data Analysis Architecture Core Schemas ──────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetRef {
    pub schema_version: String,
    pub dataset_id: String,
    pub name: String,
    pub description: Option<String>,
    pub sensitivity: String,
    pub tags: Vec<String>,
    pub owner_agent_id: Option<String>,
    pub current_version_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetVersion {
    pub schema_version: String,
    pub dataset_version_id: String,
    pub dataset_id: String,
    pub version_no: u32,
    pub schema_id: Option<String>,
    pub profile_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DataProfile {
    pub schema_version: String,
    pub profile_id: String,
    pub dataset_version_id: String,
    // Note: complex profile nested objects omitted for brevity in Phase 1
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AutonomyLevel {
    Observe,
    Notify,
    ActWithApproval,
    Act,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentAutonomy {
    pub level: AutonomyLevel,
    pub max_runs_per_day: u32,
    pub max_consecutive_failures: u32,
    pub allowed_actions: Vec<String>,
    pub requires_approval_for: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScope {
    pub scope: String,
    pub namespace: String,
    pub retention_days: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub trigger_id: String,
    pub kind: String, // e.g. "schedule"
    pub cron: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub schema_version: String,
    pub agent_id: String,
    pub name: String,
    pub goal: String,
    pub workflow_id: String,
    pub workflow_version: u32,
    pub enabled: bool,
    pub triggers: Vec<Trigger>,
    pub permissions_grant_id: Option<String>,
    pub memory: Option<MemoryScope>,
    pub autonomy: AgentAutonomy,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCapability {
    pub cap: String,
    pub scope: Vec<String>,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub denied: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGrant {
    pub schema_version: String,
    pub grant_id: String,
    pub agent_id: String,
    pub granted_at: String,
    pub granted_by: String,
    pub capabilities: Vec<PermissionCapability>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContext {
    pub schema_version: String,
    pub run_id: String,
    pub agent_id: String,
    pub workflow_id: String,
    pub workflow_version: u32,
    pub node_id: String,
    pub attempt: u32,
    pub grant_id: Option<String>,
    pub dry_run: bool,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub budgets: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub consumed: std::collections::HashMap<String, u64>,
    pub seed: u64,
    pub deadline_at: Option<String>,
    pub suppress_actions: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub checkpoint_id: String,
    pub run_id: String,
    pub graph_hash: String,
    pub created_at: String,
    pub node_id: String,
    pub input_hashes: std::collections::HashMap<String, String>,
    pub state: std::collections::HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SideEffectRecord {
    pub effect_id: String,
    pub run_id: String,
    pub node_id: String,
    pub type_: String,
    pub idempotency_key: String,
    pub intent_at: String,
    pub completed_at: Option<String>,
    pub reversible: bool,
    pub verified: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub event_id: String,
    pub schema_version: String,
    pub type_: String,
    pub source: String,
    pub occurred_at: String,
    pub recorded_at: String,
    pub idempotency_key: String,
    pub ttl_s: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GateDecision {
    pub gate_id: String,
    pub run_id: String,
    pub node_id: String,
    pub tool_id: String,
    pub decision: String,
    pub decided_at: String,
}

// ─── Phase 2 Data Analysis Nodes ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceFileConfig {
    pub path: String,
    #[serde(default)]
    pub connector: String, // e.g. "auto", "csv", "parquet"
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DatasetProfileConfig {
    #[serde(default)]
    pub mode: String, // e.g. "auto", "full", "sample"
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransformAggregateConfig {
    pub group_by: Vec<String>,
    // In a real system, aggregations would be a struct
    pub aggregations: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisStatsHypothesisTestConfig {
    pub test: String,
    pub group_column: String,
    pub value_column: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiInterpretConfig {
    pub requires_facts: Vec<String>,
    #[serde(default)]
    pub max_claims: u32,
    pub model: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiPlanConfig {
    pub objective: String,
    pub model_role: String,
    pub model: Option<String>,
}
