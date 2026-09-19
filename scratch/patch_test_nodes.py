import os

file_path = "e:/Hybrid Local AI Hub/src/bin/test_nodes.rs"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove HashMap import
content = content.replace("use std::collections::HashMap;\n", "")

# 2. Fix GraphEdge
old_edge = """    graph.edges.push(GraphEdge {
        source: "csv_node".into(),
        target: "template_node".into(),
    });"""
new_edge = """    graph.edges.push(GraphEdge {
        id: "edge1".into(),
        source: "csv_node".into(),
        target: "template_node".into(),
        source_handle: None,
        target_handle: None,
    });"""
content = content.replace(old_edge, new_edge)

# 3. Fix NodeRecord output
old_out = """            if let Some(out) = record.nodes.iter().find(|r| r.node_id == "template_node") {
                println!("Template Output: {}", out.output);
            }"""
new_out = """            if let Some(out) = record.nodes.iter().find(|r| r.node_id == "template_node") {
                if let hybrid_local_ai_hub::execution_record::NodeStatus::Success { ref output } = out.status {
                    println!("Template Output: {}", output);
                } else {
                    println!("Node didn't succeed. Status: {:?}", out.status);
                }
            }"""
content = content.replace(old_out, new_out)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("test_nodes.rs patched.")
