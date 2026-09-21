use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::path::PathBuf;
use anyhow::Result;

// â”€â”€â”€ Status types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Pending,
    Running,
    Success,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ExecutionStatus {
    Running,
    Success,
    PartialFailure,
    Failed,
}

// â”€â”€â”€ Per-node record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeRecord {
    pub node_id: String,
    pub node_type: String,
    pub status: NodeStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    /// Duration in milliseconds.
    pub duration_ms: Option<u64>,
    /// First 512 characters of the node's output (truncated for log readability).
    pub output_preview: Option<String>,
    /// Error message if status == Failed.
    pub error: Option<String>,
}

const OUTPUT_PREVIEW_LEN: usize = 512;

impl NodeRecord {
    pub fn new(node_id: &str, node_type: &str) -> Self {
        Self {
            node_id: node_id.to_string(),
            node_type: node_type.to_string(),
            status: NodeStatus::Pending,
            started_at: None,
            finished_at: None,
            duration_ms: None,
            output_preview: None,
            error: None,
        }
    }

    pub fn start(&mut self) {
        self.status = NodeStatus::Running;
        self.started_at = Some(Utc::now());
    }

    pub fn succeed(&mut self, output: &str) {
        let now = Utc::now();
        self.status = NodeStatus::Success;
        self.finished_at = Some(now);
        self.duration_ms = self.started_at.map(|s| {
            (now - s).num_milliseconds().unsigned_abs()
        });
        self.output_preview = Some(output.chars().take(OUTPUT_PREVIEW_LEN).collect());
    }

    pub fn fail(&mut self, error: &str) {
        let now = Utc::now();
        self.status = NodeStatus::Failed;
        self.finished_at = Some(now);
        self.duration_ms = self.started_at.map(|s| {
            (now - s).num_milliseconds().unsigned_abs()
        });
        self.error = Some(error.to_string());
    }

    pub fn skip(&mut self) {
        self.status = NodeStatus::Skipped;
    }
}

// â”€â”€â”€ Execution record â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRecord {
    pub execution_id: String,
    pub graph_id: Option<String>,
    pub trigger_source: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub overall_status: ExecutionStatus,
    pub nodes: Vec<NodeRecord>,
    pub resumed_from: Option<String>,
    pub nodes_skipped_on_recovery: Vec<String>,
}

impl ExecutionRecord {
    pub fn new(trigger_source: &str, graph_id: Option<&str>) -> Self {
        Self {
            execution_id: Uuid::new_v4().to_string(),
            graph_id: graph_id.map(|s| s.to_string()),
            trigger_source: trigger_source.to_string(),
            started_at: Utc::now(),
            finished_at: None,
            overall_status: ExecutionStatus::Running,
            nodes: Vec::new(),
            resumed_from: None,
            nodes_skipped_on_recovery: Vec::new(),
        }
    }

    pub fn finish(&mut self) {
        self.finished_at = Some(Utc::now());
        let has_failed = self.nodes.iter().any(|n| n.status == NodeStatus::Failed);
        let has_success = self.nodes.iter().any(|n| n.status == NodeStatus::Success);
        self.overall_status = match (has_failed, has_success) {
            (true, true) => ExecutionStatus::PartialFailure,
            (true, false) => ExecutionStatus::Failed,
            _ => ExecutionStatus::Success,
        };
    }

    /// Persist this record to `~/.hybrid-hub/logs/<execution_id>.json`.
    pub async fn save(&self) -> Result<PathBuf> {
        let logs_dir = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine home directory"))?
            .join(".hybrid-hub")
            .join("logs");

        tokio::fs::create_dir_all(&logs_dir).await?;

        let path = logs_dir.join(format!("{}.json", self.execution_id));
        let json = serde_json::to_string_pretty(self)?;
        tokio::fs::write(&path, json).await?;
        Ok(path)
    }

    /// Load an execution record from disk by id.
    pub async fn load(execution_id: &str) -> Result<Self> {
        let path = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("Cannot determine home directory"))?
            .join(".hybrid-hub")
            .join("logs")
            .join(format!("{}.json", execution_id));

        let json = tokio::fs::read_to_string(&path).await.map_err(|e| {
            anyhow::anyhow!("Cannot read execution log '{}': {e}", path.display())
        })?;

        let record: Self = serde_json::from_str(&json)?;
        Ok(record)
    }
}
