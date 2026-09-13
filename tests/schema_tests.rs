use std::collections::HashMap;
use hybrid_local_ai_hub::schema::*;
use hybrid_local_ai_hub::validate::{validate_graph, would_create_cycle};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn text_node(id: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::TextInputNode(TextInputConfig {
            text: "Hello world".to_string(),
        }),
    }
}

fn ollama_node(id: &str, prompt: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::OllamaSelectorNode(OllamaSelectorConfig {
            model: "llama3.2".to_string(),
            temperature: 0.7,
            prompt_template: prompt.to_string(),
            json_mode: false,
        }),
    }
}

fn file_watcher_node(id: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::FileWatcherNode(FileWatcherConfig {
            watch_path: "./intake".to_string(),
            pattern: Some("*.pdf".to_string()),
            recursive: false,
        }),
    }
}

fn pdf_node(id: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::PDFExtractorNode(PDFExtractorConfig { page_range: None }),
    }
}

fn router_node(id: &str, true_target: &str, false_target: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::ConditionalRouterNode(ConditionalRouterConfig {
            condition: "output.contains('weight_loss')".to_string(),
            true_target: true_target.to_string(),
            false_target: false_target.to_string(),
        }),
    }
}

fn embedder_node(id: &str) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::LocalEmbedderNode(LocalEmbedderConfig {
            model: "nomic-embed-text".to_string(),
        }),
    }
}

fn chroma_node_with_input_map(id: &str, input_map: HashMap<String, String>) -> GraphNode {
    GraphNode {
        id: id.to_string(),
        position: None,
        data: NodeType::ChromaDbStoreNode(ChromaDbStoreConfig {
            collection_name: "profiles".to_string(),
            chroma_url: "http://localhost:8000".to_string(),
            input_map: Some(input_map),
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

fn simple_graph(nodes: Vec<GraphNode>, edges: Vec<GraphEdge>) -> Graph {
    Graph {
        version: 1,
        nodes,
        edges,
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn valid_graph_passes() {
    // text1 → ollama1 (uses {{input}}, single incoming)
    let nodes = vec![
        text_node("text1"),
        ollama_node("ollama1", "Summarize: {{input}}"),
    ];
    let edges = vec![edge("e1", "text1", "ollama1")];
    let graph = simple_graph(nodes, edges);
    assert!(
        validate_graph(&graph).is_ok(),
        "A simple valid graph should pass validation"
    );
}

#[test]
fn edge_referencing_nonexistent_source_fails() {
    let nodes = vec![text_node("text1")];
    let edges = vec![edge("e1", "ghost_node", "text1")];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err());
    let errs = result.unwrap_err();
    assert!(
        errs.iter().any(|e| e.contains("ghost_node")),
        "Error should mention the missing node id. Got: {:?}",
        errs
    );
}

#[test]
fn edge_referencing_nonexistent_target_fails() {
    let nodes = vec![text_node("text1")];
    let edges = vec![edge("e1", "text1", "ghost_target")];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err());
    let errs = result.unwrap_err();
    assert!(
        errs.iter().any(|e| e.contains("ghost_target")),
        "Got: {:?}",
        errs
    );
}

#[test]
fn cycle_is_detected() {
    // a → b → c → a  (triangle cycle)
    let nodes = vec![
        text_node("a"),
        ollama_node("b", "{{input}}"),
        writer_node("c", "/tmp/out.txt"),
    ];
    let edges = vec![
        edge("e1", "a", "b"),
        edge("e2", "b", "c"),
        edge("e3", "c", "a"), // back-edge: cycle
    ];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err(), "Cycle graph should fail validation");
    let errs = result.unwrap_err();
    assert!(
        errs.iter().any(|e| e.to_lowercase().contains("cycle")),
        "Error should mention cycle. Got: {:?}",
        errs
    );
}

#[test]
fn invalid_placeholder_nonexistent_node_fails() {
    // OllamaSelector references {{nonexistent.output}}
    let nodes = vec![
        text_node("text1"),
        ollama_node("ollama1", "Summarize: {{nonexistent.output}}"),
    ];
    let edges = vec![edge("e1", "text1", "ollama1")];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err());
    let errs = result.unwrap_err();
    assert!(
        errs.iter().any(|e| e.contains("nonexistent")),
        "Error should name the missing node. Got: {:?}",
        errs
    );
}

#[test]
fn input_shorthand_with_multiple_incoming_fails() {
    // ollama1 has TWO incoming edges but uses {{input}} — must be rejected.
    let nodes = vec![
        text_node("text1"),
        text_node("text2"),
        ollama_node("ollama1", "{{input}}"),
    ];
    let edges = vec![
        edge("e1", "text1", "ollama1"),
        edge("e2", "text2", "ollama1"),
    ];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err());
    let errs = result.unwrap_err();
    assert!(
        errs.iter().any(|e| e.contains("{{input}}")),
        "Error should explain {{input}} constraint. Got: {:?}",
        errs
    );
}

#[test]
fn conditional_router_bad_targets_fail() {
    let nodes = vec![
        text_node("text1"),
        router_node("router1", "missing_true", "missing_false"),
    ];
    let edges = vec![edge("e1", "text1", "router1")];
    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(result.is_err());
    let errs = result.unwrap_err();
    assert!(errs.iter().any(|e| e.contains("missing_true")), "Got: {:?}", errs);
    assert!(errs.iter().any(|e| e.contains("missing_false")), "Got: {:?}", errs);
}

#[test]
fn gym_automation_example_validates() {
    // Gym intake processor: FileWatcher → PDF → LLM plan → ConditionalRouter → (branch A: writer,
    // branch B: writer) → Embedder → ChromaDB
    // This exercises fan-out, conditional routing, and multi-input ChromaDB binding.
    let mut input_map = HashMap::new();
    input_map.insert("vector".to_string(), "embedder1.output".to_string());
    input_map.insert("document".to_string(), "pdf1.output".to_string());

    let nodes = vec![
        file_watcher_node("watcher1"),
        pdf_node("pdf1"),
        ollama_node("llm1", "Create a personalized plan from: {{pdf1.output}}"),
        router_node("router1", "writer_wl", "writer_mg"),
        writer_node("writer_wl", "./output/weight_loss_plan.txt"),
        writer_node("writer_mg", "./output/muscle_gain_plan.txt"),
        embedder_node("embedder1"),
        chroma_node_with_input_map("chroma1", input_map),
    ];

    let edges = vec![
        edge("e1", "watcher1", "pdf1"),
        edge("e2", "pdf1", "llm1"),
        edge("e3", "llm1", "router1"),
        edge("e4", "router1", "writer_wl"),
        edge("e5", "router1", "writer_mg"),
        edge("e6", "pdf1", "embedder1"),
        edge("e7", "embedder1", "chroma1"),
    ];

    let graph = simple_graph(nodes, edges);
    let result = validate_graph(&graph);
    assert!(
        result.is_ok(),
        "Gym automation graph should be valid. Errors: {:?}",
        result.err()
    );
}

#[test]
fn would_create_cycle_detects_back_edge() {
    // a → b; candidate (b → a) should create a cycle.
    let nodes = vec![text_node("a"), text_node("b")];
    let edges = vec![edge("e1", "a", "b")];
    assert!(
        would_create_cycle(&nodes, &edges, ("b", "a")),
        "Adding b→a should create a cycle"
    );
}

#[test]
fn would_create_cycle_allows_valid_edge() {
    // a → b; candidate (b → c) is fine.
    let nodes = vec![text_node("a"), text_node("b"), text_node("c")];
    let edges = vec![edge("e1", "a", "b")];
    assert!(
        !would_create_cycle(&nodes, &edges, ("b", "c")),
        "Adding b→c should not create a cycle"
    );
}

#[test]
fn graph_json_round_trips() {
    // Verify serde round-trip for all node types.
    let nodes = vec![
        file_watcher_node("fw1"),
        text_node("t1"),
        GraphNode {
            id: "img1".to_string(),
            position: Some((10.0, 20.0)),
            data: NodeType::ImageInputNode(ImageInputConfig {
                image_path: "./photo.jpg".to_string(),
            }),
        },
        ollama_node("llm1", "{{fw1.output}}"),
        embedder_node("emb1"),
        pdf_node("pdf1"),
        {
            let mut map = HashMap::new();
            map.insert("doc".to_string(), "pdf1.output".to_string());
            chroma_node_with_input_map("chroma1", map)
        },
        router_node("router1", "writer_a", "writer_b"),
        writer_node("writer_a", "/out/a.txt"),
        writer_node("writer_b", "/out/b.txt"),
    ];

    let graph = Graph {
        version: 1,
        nodes,
        edges: vec![],
    };

    let json = serde_json::to_string_pretty(&graph).expect("serialize");
    let back: Graph = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(graph.nodes.len(), back.nodes.len());
    assert_eq!(graph.version, back.version);
}

#[test]
fn schema_prompt_not_stale() {
    let prompt = hybrid_local_ai_hub::translator_prompt::build_system_prompt();
    let expected_node_types = [
        "FileWatcherNode",
        "TextInputNode",
        "ImageInputNode",
        "OllamaSelectorNode",
        "LocalEmbedderNode",
        "PDFExtractorNode",
        "ChromaDbStoreNode",
        "ConditionalRouterNode",
        "LocalFileWriterNode",
    ];
    for nt in expected_node_types {
        assert!(
            prompt.contains(nt),
            "System prompt is missing node type documentation: {}",
            nt
        );
    }
}
