use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// â”€â”€â”€ Node type enum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Every node variant carries its own config fields inline (discriminated union).
/// The `type` field is the tag that drives deserialization.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
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
}

// â”€â”€â”€ Per-variant config structs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextInputConfig {
    /// Static text content, or a template using `{{node_id.output}}` references.
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageInputConfig {
    /// Absolute or relative path to the image file.
    pub image_path: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEmbedderConfig {
    /// Embedding model identifier (e.g. "nomic-embed-text").
    pub model: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PDFExtractorConfig {
    /// If provided, only extract this range of pages (1-indexed, inclusive).
    pub page_range: Option<(u32, u32)>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
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

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalRouterConfig {
    /// CEL-style condition expression evaluated against the input string.
    pub condition: String,
    /// Node id to route to when condition is true.
    pub true_target: String,
    /// Node id to route to when condition is false.
    pub false_target: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileWriterConfig {
    /// Output file path. Supports `{{node_id.output}}` for dynamic paths.
    pub output_path: String,
    /// If true, append rather than overwrite.
    #[serde(default)]
    pub append: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebScraperConfig {
    /// The URL to scrape. Supports `{{node_id.output}}` or `{{input}}`.
    pub url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandConfig {
    /// The shell command to run. Supports `{{node_id.output}}` or `{{input}}`.
    pub command: String,
    /// Must be explicitly enabled to execute raw shell commands containing input interpolation
    pub unsafe_raw_shell: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegexExtractorConfig {
    /// The regex pattern to apply to the input.
    pub pattern: String,
    /// The group index to extract (0 for full match).
    #[serde(default)]
    pub group: usize,
}

// â”€â”€â”€ Graph structs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// A node in the graph. `position` is optional/unused in CLI mode but kept for
/// forward JSON-compatibility when a GUI is added.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct GraphNode {
    pub id: String,
    pub position: Option<(f64, f64)>,
    pub data: NodeType,
}

/// A directed edge between two nodes, with optional named handles for
/// multi-output/multi-input scenarios.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub source_handle: Option<String>,
    pub target: String,
    pub target_handle: Option<String>,
}

/// A complete workflow graph.
#[derive(Serialize, Deserialize, Debug, Clone)]
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
