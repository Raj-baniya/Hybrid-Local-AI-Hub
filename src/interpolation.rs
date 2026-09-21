use anyhow::{anyhow, Result};
use crate::schema::Graph;

/// Resolve all `{{...}}` template placeholders in a string.
///
/// Two valid forms:
///   - `{{input}}` â€” shorthand for "the single incoming node's output"
///     (validated structurally in `validate.rs`; here we look up via `single_input`).
///   - `{{node_id.output}}` â€” explicit reference to a specific node's output.
///
/// `outputs` maps `node_id` â†’ its runtime output string.
/// `single_input` is `Some(value)` if the node receiving this template has
/// exactly one incoming edge, `None` otherwise (should have been caught by validate).
pub fn resolve(
    template: &str,
    outputs: &std::collections::HashMap<String, String>,
    single_input: Option<&str>,
) -> Result<String> {
    let mut result = String::with_capacity(template.len());
    let mut remaining = template;

    while let Some(start) = remaining.find("{{") {
        result.push_str(&remaining[..start]);
        let after = &remaining[start + 2..];

        let end = after
            .find("}}")
            .ok_or_else(|| anyhow!("Unclosed '{{{{' in template: {}", template))?;

        let placeholder = &after[..end];
        remaining = &after[end + 2..];

        if placeholder == "input" {
            let val_raw = single_input.ok_or_else(|| {
                anyhow!(
                    "{{{{input}}}} used but no single-input value is available. \
                     This should have been caught by validation."
                )
            })?;
            let val = if val_raw.starts_with("FILE_EVENT:") {
                let p = val_raw.trim_start_matches("FILE_EVENT:");
                std::fs::read_to_string(p).unwrap_or_else(|_| val_raw.to_string())
            } else {
                val_raw.to_string()
            };
            result.push_str(&val);
        } else if let Some(dot) = placeholder.find('.') {
            let node_id = &placeholder[..dot];
            let output_raw = outputs.get(node_id).ok_or_else(|| {
                anyhow!(
                    "Template references {{{{{}}}}} but node '{}' has no output yet. \
                     This likely indicates a missing edge in the workflow graph.",
                    placeholder, node_id
                )
            })?;
            let output = if output_raw.starts_with("FILE_EVENT:") {
                let p = output_raw.trim_start_matches("FILE_EVENT:");
                std::fs::read_to_string(p).unwrap_or_else(|_| output_raw.to_string())
            } else {
                output_raw.to_string()
            };
            result.push_str(&output);
        } else {
            return Err(anyhow!(
                "Unrecognized placeholder {{{{{}}}}}: must be '{{{{input}}}}' or \
                 '{{{{node_id.output}}}}'.",
                placeholder
            ));
        }
    }

    result.push_str(remaining);
    Ok(result)
}

/// Pre-validate all templates in the graph against the node set before execution starts.
/// This catches template errors before any node runs (fail fast).
pub fn validate_templates(graph: &Graph) -> Result<()> {
    use crate::schema::NodeType;

    let node_ids: std::collections::HashSet<&str> =
        graph.nodes.iter().map(|n| n.id.as_str()).collect();

    // Build incoming-edge counts.
    let mut incoming_count: std::collections::HashMap<&str, usize> =
        graph.nodes.iter().map(|n| (n.id.as_str(), 0usize)).collect();
    for edge in &graph.edges {
        *incoming_count.entry(edge.target.as_str()).or_insert(0) += 1;
    }

    let mut errors: Vec<String> = Vec::new();

    for node in &graph.nodes {
        let templates: Vec<(&str, &str)> = match &node.data {
            NodeType::OllamaSelectorNode(cfg) => {
                vec![("promptTemplate", &cfg.prompt_template)]
            }
            NodeType::TextInputNode(cfg) => vec![("text", &cfg.text)],
            NodeType::LocalFileWriterNode(cfg) => vec![("outputPath", &cfg.output_path)],
            NodeType::WebScraperNode(cfg) => vec![("url", &cfg.url)],
            NodeType::ShellCommandNode(cfg) => vec![("command", &cfg.command)],
            NodeType::NotifyDesktopNode(cfg) => vec![("title", &cfg.title), ("body", &cfg.body)],
            NodeType::NotifyWebhookNode(cfg) => vec![("url", &cfg.url), ("payload", &cfg.payload)],
            NodeType::CsvReaderNode(cfg) => vec![("filePath", &cfg.file_path)],
            NodeType::TemplateFormatterNode(cfg) => vec![("template", &cfg.template)],
            NodeType::ChromaDbStoreNode(cfg) => {
                let mut fields = Vec::new();
                if let Some(map) = &cfg.input_map {
                    for value in map.values() {
                        fields.push(("inputMap", value.as_str()));
                    }
                }
                fields
            }
            _ => vec![],
        };

        for (field, tmpl) in templates {
            let ic = incoming_count.get(node.id.as_str()).copied().unwrap_or(0);
            check_template_placeholders(tmpl, field, &node.id, &node_ids, ic, &mut errors);
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(anyhow!(
            "Template validation failed before execution:\n{}",
            errors.join("\n")
        ))
    }
}

fn check_template_placeholders(
    template: &str,
    field: &str,
    node_id: &str,
    node_ids: &std::collections::HashSet<&str>,
    incoming_count: usize,
    errors: &mut Vec<String>,
) {
    let mut remaining = template;
    while let Some(start) = remaining.find("{{") {
        let after = &remaining[start + 2..];
        if let Some(end) = after.find("}}") {
            let placeholder = &after[..end];
            remaining = &after[end + 2..];

            if placeholder == "input" {
                if incoming_count != 1 {
                    errors.push(format!(
                        "Node '{}', field '{}': {{{{input}}}} requires exactly 1 incoming \
                         edge (has {})",
                        node_id, field, incoming_count
                    ));
                }
            } else if let Some(dot) = placeholder.find('.') {
                let ref_id = &placeholder[..dot];
                if !node_ids.contains(ref_id) {
                    errors.push(format!(
                        "Node '{}', field '{}': {{{{{}}}}} â€” no node with id '{}' exists",
                        node_id, field, placeholder, ref_id
                    ));
                }
            } else {
                errors.push(format!(
                    "Node '{}', field '{}': unrecognized placeholder {{{{{}}}}}",
                    node_id, field, placeholder
                ));
            }
        } else {
            break;
        }
    }
}
