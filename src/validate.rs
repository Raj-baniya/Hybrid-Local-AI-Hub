use std::collections::{HashMap, HashSet, VecDeque};
use crate::schema::{Graph, GraphEdge, GraphNode, NodeType};

// ─── Public API ──────────────────────────────────────────────────────────────

/// Validates the structural integrity of a graph.
///
/// Returns `Ok(())` if the graph is valid, or `Err(Vec<String>)` containing
/// all discovered errors (not just the first one — full error list).
pub fn validate_graph(graph: &Graph) -> Result<(), Vec<String>> {
    let mut errors: Vec<String> = Vec::new();

    let node_ids: HashSet<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();

    // 1. Every edge must reference real node ids.
    for edge in &graph.edges {
        if !node_ids.contains(edge.source.as_str()) {
            errors.push(format!(
                "Edge '{}': source node '{}' does not exist in this graph",
                edge.id, edge.source
            ));
        }
        if !node_ids.contains(edge.target.as_str()) {
            errors.push(format!(
                "Edge '{}': target node '{}' does not exist in this graph",
                edge.id, edge.target
            ));
        }
    }

    // 2. ConditionalRouterNode targets must reference real nodes.
    for node in &graph.nodes {
        if let NodeType::ConditionalRouterNode(cfg) = &node.data {
            if !node_ids.contains(cfg.true_target.as_str()) {
                errors.push(format!(
                    "Node '{}' (ConditionalRouterNode): true_target '{}' does not exist",
                    node.id, cfg.true_target
                ));
            }
            if !node_ids.contains(cfg.false_target.as_str()) {
                errors.push(format!(
                    "Node '{}' (ConditionalRouterNode): false_target '{}' does not exist",
                    node.id, cfg.false_target
                ));
            }
        }
    }

    // 3. `{{node_id.output}}` and `{{input}}` references must be valid.
    //    Build incoming-edge map first so we can check {{input}} validity.
    let incoming: HashMap<&str, Vec<&str>> = build_incoming_map(&graph.nodes, &graph.edges);
    validate_template_references(graph, &node_ids, &incoming, &mut errors);

    // 4. Cycle detection — run after edge validity so we don't panic on bad refs.
    if errors.is_empty() && has_cycle(&graph.nodes, &graph.edges) {
        errors.push(
            "Graph contains a cycle. Workflow graphs must be directed acyclic graphs (DAGs)."
                .to_string(),
        );
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// Returns `true` if adding the candidate edge `(from, to)` to the *current*
/// set of edges would create a cycle in the graph.
///
/// Ported from the earlier TypeScript DFS logic.
pub fn would_create_cycle(
    nodes: &[GraphNode],
    edges: &[GraphEdge],
    candidate: (&str, &str),
) -> bool {
    let (from, to) = candidate;

    // Build adjacency list including the candidate edge.
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in nodes {
        adj.entry(node.id.as_str()).or_default();
    }
    for edge in edges {
        adj.entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }
    // Add candidate.
    adj.entry(from).or_default().push(to);

    // DFS cycle detection via coloring: 0=white, 1=gray(in-stack), 2=black(done).
    let mut color: HashMap<&str, u8> = nodes.iter().map(|n| (n.id.as_str(), 0u8)).collect();

    for start in nodes.iter().map(|n| n.id.as_str()) {
        if color[start] == 0 && dfs_has_cycle(start, &adj, &mut color) {
            return true;
        }
    }
    false
}

// ─── Internals ───────────────────────────────────────────────────────────────

fn build_incoming_map<'a>(
    nodes: &'a [GraphNode],
    edges: &'a [GraphEdge],
) -> HashMap<&'a str, Vec<&'a str>> {
    let mut map: HashMap<&str, Vec<&str>> = nodes.iter().map(|n| (n.id.as_str(), vec![])).collect();
    for edge in edges {
        map.entry(edge.target.as_str())
            .or_default()
            .push(edge.source.as_str());
    }
    map
}

/// Extract all `{{...}}` placeholder tokens from a string.
fn extract_placeholders(s: &str) -> Vec<&str> {
    let mut result = Vec::new();
    let mut remaining = s;
    while let Some(start) = remaining.find("{{") {
        let after = &remaining[start + 2..];
        if let Some(end) = after.find("}}") {
            result.push(&after[..end]);
            remaining = &after[end + 2..];
        } else {
            break;
        }
    }
    result
}

/// Collects all string fields from a node that may contain `{{...}}` references.
fn string_fields_of_node(node: &GraphNode) -> Vec<(&'static str, &str)> {
    match &node.data {
        NodeType::OllamaSelectorNode(cfg) => {
            vec![("promptTemplate", &cfg.prompt_template)]
        }
        NodeType::TextInputNode(cfg) => {
            vec![("text", &cfg.text)]
        }
        NodeType::LocalFileWriterNode(cfg) => {
            vec![("outputPath", &cfg.output_path)]
        }
        NodeType::ChromaDbStoreNode(cfg) => {
            // input_map values can contain references.
            // We return them as a single combined check below.
            let _ = cfg; // handled separately in validate_template_references
            vec![]
        }
        _ => vec![],
    }
}

fn validate_template_references(
    graph: &Graph,
    node_ids: &HashSet<&str>,
    incoming: &HashMap<&str, Vec<&str>>,
    errors: &mut Vec<String>,
) {
    for node in &graph.nodes {
        // Standard string fields.
        for (field_name, field_value) in string_fields_of_node(node) {
            for placeholder in extract_placeholders(field_value) {
                validate_placeholder(placeholder, field_name, &node.id, node_ids, incoming, errors);
            }
        }

        // ChromaDbStoreNode input_map values.
        if let NodeType::ChromaDbStoreNode(cfg) = &node.data {
            if let Some(input_map) = &cfg.input_map {
                for (key, value) in input_map {
                    for placeholder in extract_placeholders(value) {
                        validate_placeholder(
                            placeholder,
                            &format!("inputMap[{}]", key),
                            &node.id,
                            node_ids,
                            incoming,
                            errors,
                        );
                    }
                    // Also validate the value is a "node_id.output" style ref.
                    if !value.contains('.') {
                        errors.push(format!(
                            "Node '{}' (ChromaDbStoreNode): inputMap value '{}' must be in \
                             'node_id.output' format",
                            node.id, value
                        ));
                    } else {
                        let ref_node_id = value.split('.').next().unwrap_or("");
                        if !node_ids.contains(ref_node_id) {
                            errors.push(format!(
                                "Node '{}' (ChromaDbStoreNode): inputMap references node '{}' \
                                 which does not exist",
                                node.id, ref_node_id
                            ));
                        }
                    }
                }
            }
        }
    }
}

fn validate_placeholder(
    placeholder: &str,
    field_name: &str,
    node_id: &str,
    node_ids: &HashSet<&str>,
    incoming: &HashMap<&str, Vec<&str>>,
    errors: &mut Vec<String>,
) {
    if placeholder == "input" {
        // `{{input}}` is only valid when this node has exactly one incoming edge.
        let incoming_count = incoming.get(node_id).map(|v| v.len()).unwrap_or(0);
        if incoming_count != 1 {
            errors.push(format!(
                "Node '{}', field '{}': {{{{input}}}} is only valid when the node has exactly \
                 one incoming edge (found {}). Use {{{{node_id.output}}}} for explicit binding.",
                node_id, field_name, incoming_count
            ));
        }
    } else if let Some(dot_pos) = placeholder.find('.') {
        let ref_node_id = &placeholder[..dot_pos];
        if !node_ids.contains(ref_node_id) {
            errors.push(format!(
                "Node '{}', field '{}': references {{{{{}}}}} — no node with id '{}' exists",
                node_id, field_name, placeholder, ref_node_id
            ));
        }
    } else {
        errors.push(format!(
            "Node '{}', field '{}': unrecognized placeholder {{{{{}}}}}. \
             Use {{{{input}}}} or {{{{node_id.output}}}}.",
            node_id, field_name, placeholder
        ));
    }
}

fn has_cycle(nodes: &[GraphNode], edges: &[GraphEdge]) -> bool {
    // Kahn's algorithm: if the topological sort cannot consume all nodes, there's a cycle.
    let mut in_degree: HashMap<&str, usize> = nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    let mut adj: HashMap<&str, Vec<&str>> = nodes.iter().map(|n| (n.id.as_str(), vec![])).collect();

    for edge in edges {
        *in_degree.entry(edge.target.as_str()).or_insert(0) += 1;
        adj.entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }

    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter_map(|(&id, &deg)| if deg == 0 { Some(id) } else { None })
        .collect();

    let mut visited = 0usize;
    while let Some(node) = queue.pop_front() {
        visited += 1;
        if let Some(neighbors) = adj.get(node) {
            for &neighbor in neighbors {
                let deg = in_degree.entry(neighbor).or_insert(0);
                *deg = deg.saturating_sub(1);
                if *deg == 0 {
                    queue.push_back(neighbor);
                }
            }
        }
    }

    visited != nodes.len()
}

fn dfs_has_cycle<'a>(
    node: &'a str,
    adj: &HashMap<&'a str, Vec<&'a str>>,
    color: &mut HashMap<&'a str, u8>,
) -> bool {
    color.insert(node, 1); // gray = in stack

    if let Some(neighbors) = adj.get(node) {
        for &neighbor in neighbors {
            match color.get(neighbor).copied().unwrap_or(0) {
                1 => return true, // back edge → cycle
                0 if dfs_has_cycle(neighbor, adj, color) => return true,
                _ => {} // black = already fully processed
            }
        }
    }

    color.insert(node, 2); // black = done
    false
}
