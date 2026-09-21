use hybrid_local_ai_hub::schema::*;
use hybrid_local_ai_hub::executor::*;

#[tokio::main]
async fn main() {
    let mut graph = Graph {
        version: 1,
        name: Some("Test Graph".into()),
        nodes: vec![],
        edges: vec![],
    };

    // Node 1: CsvReaderNode
    let csv_content = "name,age\nAlice,30\nBob,25\n";
    let tmp_dir = std::env::temp_dir();
    let tmp_path = tmp_dir.join(format!("test_{}.csv", std::process::id()));
    std::fs::write(&tmp_path, csv_content).unwrap();

    let node1 = GraphNode {
        position: None, id: "csv_node".into(),
        data: NodeType::CsvReaderNode(CsvReaderConfig {
            file_path: tmp_path.to_string_lossy().to_string(),
            has_header_row: true,
        }),
    };
    graph.nodes.push(node1);

    // Node 2: TemplateFormatterNode
    let node2 = GraphNode {
        position: None, id: "template_node".into(),
        data: NodeType::TemplateFormatterNode(TemplateFormatterConfig {
            template: "Processed CSV data: {{csv_node.output}}".into(),
        }),
    };
    graph.nodes.push(node2);

    graph.edges.push(GraphEdge {
        id: "edge1".into(),
        source: "csv_node".into(),
        target: "template_node".into(),
        source_handle: None,
        target_handle: None,
    });

    let config = ExecutorConfig {
        is_offline: true,
        ollama_url: "http://localhost:11434".into(),
        chroma_url: "http://localhost:8000".into(),
        llm_timeout_secs: 60,
        default_timeout_secs: 15,
        failure_policy: hybrid_local_ai_hub::executor::FailurePolicy::HaltOnFailure,
        online_keys: vec![],
        suppress_actions: false,
    };

    println!("Running graph...");
    let result = run_graph(&graph, None, config, "test", None, None).await;
    
    match result {
        Ok(record) => {
            println!("Graph executed successfully.");
            if let Some(out) = record.nodes.iter().find(|r| r.node_id == "template_node") {
                if out.status == hybrid_local_ai_hub::execution_record::NodeStatus::Success {
                    if let Some(ref preview) = out.output_preview {
                        println!("Template Output: {}", preview);
                    }
                } else {
                    println!("Node didn't succeed. Error: {:?}", out.error);
                }
            }
        },
        Err(e) => {
            eprintln!("Graph execution failed: {}", e);
            std::process::exit(1);
        }
    }

    std::fs::remove_file(&tmp_path).unwrap();
}
