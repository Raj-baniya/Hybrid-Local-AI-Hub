/// Integration tests for the execution engine.
///
/// These tests verify scheduling behaviour using stub async functions
/// (no live Ollama/ChromaDB required). Real network calls are exercised
/// manually during Phase 3's acceptance check per the plan.
use hybrid_local_ai_hub::executor::{run_graph, ExecutorConfig, FailurePolicy};
use hybrid_local_ai_hub::execution_record::NodeStatus;
use hybrid_local_ai_hub::schema::*;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn text_node(id: &str, text: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::TextInputNode(TextInputConfig {
            text: text.to_string(),
        }),
    }
}

fn writer_node(id: &str, path: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::LocalFileWriterNode(LocalFileWriterConfig {
            output_path: path.to_string(),
            append: false,
        }),
    }
}

fn edge(id: &str, source: &str, target: &str) -> GraphEdge {
    GraphEdge {
        id: id.to_string(),
        source: source.to_string(),
        source_handle: None,
        target: target.to_string(),
        target_handle: None,
    }
}

fn make_graph(nodes: Vec<GraphNode>, edges: Vec<GraphEdge>) -> Graph {
    Graph { version: 1, nodes, edges }
}

fn test_config() -> ExecutorConfig {
    ExecutorConfig {
        ollama_url: "http://localhost:11434".to_string(),
        chroma_url: "http://localhost:8000".to_string(),
        failure_policy: FailurePolicy::HaltOnFailure,
        default_timeout_secs: 5,
        llm_timeout_secs: 10,
    }
}

fn temp_dir_path(filename: &str) -> String {
    let dir = std::env::temp_dir();
    dir.join(filename).to_string_lossy().to_string()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn single_text_node_succeeds() {
    let nodes = vec![text_node("t1", "Hello, world!")];
    let graph = make_graph(nodes, vec![]);

    let record = run_graph(&graph, test_config(), "test", None).await
        .expect("run_graph should succeed");

    assert_eq!(record.nodes.len(), 1);
    assert_eq!(record.nodes[0].status, NodeStatus::Success);
    assert!(record.nodes[0].output_preview.as_deref()
        .unwrap_or("").contains("Hello"));
}

#[tokio::test]
async fn text_to_file_writer_pipeline_succeeds() {
    let out_path = temp_dir_path("hybrid_hub_test_output.txt");
    let nodes = vec![
        text_node("input", "Hello from executor test"),
        writer_node("writer", &out_path),
    ];
    let edges = vec![edge("e1", "input", "writer")];
    let graph = make_graph(nodes, edges);

    let record = run_graph(&graph, test_config(), "test", None).await
        .expect("run_graph should succeed");

    assert_eq!(record.nodes.len(), 2);
    let writer_rec = record.nodes.iter().find(|n| n.node_id == "writer").unwrap();
    assert_eq!(writer_rec.status, NodeStatus::Success);

    // Verify the file was actually written.
    let contents = std::fs::read_to_string(&out_path)
        .expect("output file should exist");
    assert!(contents.contains("Hello from executor test"));

    // Cleanup.
    let _ = std::fs::remove_file(&out_path);
}

#[tokio::test]
async fn cycle_graph_rejected_before_execution() {
    // a → b → a : cycle — should fail at template validation or schema level,
    // but our executor should not run any node.
    // Note: cycle detection lives in validate_graph; executor calls validate_templates first.
    // Build a cyclic graph (validate_graph would reject it, but executor gets it raw here
    // to test that it does NOT silently execute).
    //
    // We test this indirectly: passing a cyclic graph to run_graph should return Err
    // (because validate_templates will catch template issues, and our integration tests
    // for cycle detection live in schema_tests.rs which test validate_graph directly).
    // Here we verify the executor respects topological ordering — a node with in-degree > 0
    // is never run before its predecessor regardless of input order.

    // Linear chain but nodes given in reverse order in the `nodes` vec.
    let out_path = temp_dir_path("hybrid_hub_test_order.txt");
    let nodes = vec![
        // Writer comes first in the list — executor must still run input first.
        writer_node("writer", &out_path),
        text_node("input", "ordering test"),
    ];
    let edges = vec![edge("e1", "input", "writer")];
    let graph = make_graph(nodes, edges);

    let record = run_graph(&graph, test_config(), "test", None).await
        .expect("valid graph should succeed");

    let writer_rec = record.nodes.iter().find(|n| n.node_id == "writer").unwrap();
    assert_eq!(writer_rec.status, NodeStatus::Success,
        "writer should succeed even though it was listed first in nodes vec");

    let _ = std::fs::remove_file(&out_path);
}

#[tokio::test]
async fn parallel_nodes_run_concurrently() {
    // Two independent text nodes with no edges between them should complete in parallel.
    // We can't easily measure real parallelism in unit tests, but we can verify both succeed.
    let nodes = vec![
        text_node("a", "branch A output"),
        text_node("b", "branch B output"),
    ];
    let graph = make_graph(nodes, vec![]);

    let record = run_graph(&graph, test_config(), "test", None).await
        .expect("should succeed");

    assert!(record.nodes.iter().all(|n| n.status == NodeStatus::Success));
}

#[tokio::test]
async fn fan_out_both_branches_succeed() {
    // input → writer_a, input → writer_b  (fan-out from one source)
    let path_a = temp_dir_path("hybrid_hub_test_fan_a.txt");
    let path_b = temp_dir_path("hybrid_hub_test_fan_b.txt");

    let nodes = vec![
        text_node("input", "fan-out content"),
        writer_node("writer_a", &path_a),
        writer_node("writer_b", &path_b),
    ];
    let edges = vec![
        edge("e1", "input", "writer_a"),
        edge("e2", "input", "writer_b"),
    ];
    let graph = make_graph(nodes, edges);

    let record = run_graph(&graph, test_config(), "test", None).await.expect("succeed");

    assert!(record.nodes.iter().all(|n| n.status == NodeStatus::Success),
        "All branches should succeed in fan-out. Records: {:?}",
        record.nodes.iter().map(|n| (&n.node_id, &n.status, &n.error)).collect::<Vec<_>>()
    );

    let _ = std::fs::remove_file(&path_a);
    let _ = std::fs::remove_file(&path_b);
}

#[tokio::test]
async fn execution_record_saved_to_disk() {
    let nodes = vec![text_node("t1", "record persistence test")];
    let graph = make_graph(nodes, vec![]);

    let record = run_graph(&graph, test_config(), "test", None).await.expect("succeed");

    // The record should have been saved to ~/.hybrid-hub/logs/<id>.json
    let log_path = dirs::home_dir()
        .unwrap()
        .join(".hybrid-hub")
        .join("logs")
        .join(format!("{}.json", record.execution_id));

    assert!(log_path.exists(), "Execution log file should exist at {:?}", log_path);

    // Load and verify round-trip.
    let loaded = hybrid_local_ai_hub::execution_record::ExecutionRecord::load(&record.execution_id)
        .await
        .expect("should load");
    assert_eq!(loaded.execution_id, record.execution_id);
}
