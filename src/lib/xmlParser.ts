/**
 * xmlParser.ts
 * Robust XML specification parser for Hybrid Local AI Hub.
 * Parses agent specs, workflow specs, and transformed XML tool calls
 * from local LLM responses — all 100% offline.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedAgent {
  name: string;
  description: string;
  instruction: string;
  tools: string[];
  output: string;
}

export interface ParsedAgentSpec {
  agents: ParsedAgent[];
}

export interface ParsedWorkflowEvent {
  name: string;
  agent: string;
  listen: string;
  action: string;
  output: string;
  goto?: string;
}

export interface ParsedWorkflowSpec {
  title: string;
  pattern: "sequential" | "if_else" | "parallelization" | "evaluator_optimizer";
  input: string;
  events: ParsedWorkflowEvent[];
}

export interface XmlToolCall {
  toolName: string;
  params: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core XML Field Extractor
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts text content of the first XML tag with the given name. */
export function extractXmlField(xml: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return null;
  const contentStart = start + open.length;
  const end = xml.indexOf(close, contentStart);
  if (end === -1) return null;
  return xml.slice(contentStart, end).trim();
}

/** Extracts all occurrences of a repeated XML tag. */
export function extractXmlFields(xml: string, tag: string): string[] {
  const results: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let searchFrom = 0;
  while (true) {
    const start = xml.indexOf(open, searchFrom);
    if (start === -1) break;
    const contentStart = start + open.length;
    const end = xml.indexOf(close, contentStart);
    if (end === -1) break;
    results.push(xml.slice(contentStart, end).trim());
    searchFrom = end + close.length;
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Spec Parser
// ─────────────────────────────────────────────────────────────────────────────

/** Parses XML <agents>...</agents> spec returned by the Agent Profiling Agent. */
export function parseAgentSpec(xml: string): ParsedAgentSpec {
  const agents: ParsedAgent[] = [];

  // Find all <agent>...</agent> blocks
  let searchFrom = 0;
  while (true) {
    const start = xml.indexOf("<agent>", searchFrom);
    if (start === -1) break;
    const end = xml.indexOf("</agent>", start);
    if (end === -1) break;
    const agentXml = xml.slice(start, end + "</agent>".length);

    const toolsSection = extractXmlField(agentXml, "tools") ?? "";
    const tools = extractXmlFields(toolsSection, "tool");

    agents.push({
      name: extractXmlField(agentXml, "name") ?? "Unnamed Agent",
      description: extractXmlField(agentXml, "description") ?? "",
      instruction: extractXmlField(agentXml, "instruction") ?? "",
      tools,
      output: extractXmlField(agentXml, "output") ?? "",
    });

    searchFrom = end + "</agent>".length;
  }

  return { agents };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Spec Parser
// ─────────────────────────────────────────────────────────────────────────────

/** Parses XML <workflow>...</workflow> spec returned by the Workflow Profiling Agent. */
export function parseWorkflowSpec(xml: string): ParsedWorkflowSpec {
  const rawPattern = extractXmlField(xml, "pattern") ?? "sequential";

  const patternMap: Record<string, ParsedWorkflowSpec["pattern"]> = {
    sequential: "sequential",
    if_else: "if_else",
    ifelse: "if_else",
    "if-else": "if_else",
    parallelization: "parallelization",
    parallel: "parallelization",
    voting: "parallelization",
    evaluator_optimizer: "evaluator_optimizer",
    "evaluator-optimizer": "evaluator_optimizer",
    eval_opt: "evaluator_optimizer",
  };

  const pattern =
    patternMap[rawPattern.toLowerCase().trim()] ?? "sequential";

  const eventsSection = extractXmlField(xml, "events") ?? "";
  const events: ParsedWorkflowEvent[] = [];

  let searchFrom = 0;
  while (true) {
    const start = eventsSection.indexOf("<event>", searchFrom);
    if (start === -1) break;
    const end = eventsSection.indexOf("</event>", start);
    if (end === -1) break;
    const eventXml = eventsSection.slice(start, end + "</event>".length);

    events.push({
      name: extractXmlField(eventXml, "name") ?? `event_${events.length + 1}`,
      agent: extractXmlField(eventXml, "agent") ?? "AI Agent",
      listen: extractXmlField(eventXml, "listen") ?? "input",
      action: extractXmlField(eventXml, "action") ?? "Process the input",
      output: extractXmlField(eventXml, "output") ?? "result",
      goto: extractXmlField(eventXml, "goto") ?? undefined,
    });

    searchFrom = end + "</event>".length;
  }

  if (events.length === 0) {
    events.push({
      name: "default_step",
      agent: "AI Agent",
      listen: "input",
      action: "Process the given input and provide a comprehensive response",
      output: "result",
    });
  }

  return {
    title: extractXmlField(xml, "title") ?? "Untitled Workflow",
    pattern,
    input: extractXmlField(xml, "input") ?? "user_input",
    events,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformed XML Tool Call Parser (AutoAgent paper protocol)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses transformed XML tool calls from local LLM output.
 * Format: <function=tool_name><parameter=key>value</parameter></function>
 */
export function parseXmlToolCalls(text: string): XmlToolCall[] {
  const calls: XmlToolCall[] = [];
  let searchStart = 0;

  while (true) {
    const fnStart = text.indexOf("<function=", searchStart);
    if (fnStart === -1) break;

    const afterFn = fnStart + "<function=".length;
    const nameEnd = text.indexOf(">", afterFn);
    if (nameEnd === -1) break;
    const toolName = text.slice(afterFn, nameEnd).trim();

    const contentStart = nameEnd + 1;
    const fnEnd = text.indexOf("</function>", contentStart);
    if (fnEnd === -1) break;
    const innerContent = text.slice(contentStart, fnEnd);

    const params: Record<string, string> = {};
    let paramSearch = 0;
    while (true) {
      const pStart = innerContent.indexOf("<parameter=", paramSearch);
      if (pStart === -1) break;
      const afterP = pStart + "<parameter=".length;
      const pNameEnd = innerContent.indexOf(">", afterP);
      if (pNameEnd === -1) break;
      const paramName = innerContent.slice(afterP, pNameEnd).trim();
      const valStart = pNameEnd + 1;
      const pEnd = innerContent.indexOf("</parameter>", valStart);
      if (pEnd === -1) break;
      params[paramName] = innerContent.slice(valStart, pEnd).trim();
      paramSearch = pEnd + "</parameter>".length;
    }

    calls.push({ toolName, params });
    searchStart = fnEnd + "</function>".length;
  }

  return calls;
}

/** Extracts FINAL_ANSWER from LLM response text. */
export function extractFinalAnswer(text: string): string | null {
  const marker = "FINAL_ANSWER:";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  return text.slice(idx + marker.length).trim();
}

/** Detects agent handoff target from parsed tool calls. */
export function detectHandoffTarget(toolCalls: XmlToolCall[]): string | null {
  for (const call of toolCalls) {
    if (call.toolName === "transfer_to_coding_agent") return "Coding Agent";
    if (call.toolName === "transfer_to_local_file_agent") return "Local File Agent";
    if (call.toolName === "transfer_to_web_surfer_agent") return "Web Surfer Agent";
    if (call.toolName === "transfer_back_to_orchestrator") return "Orchestrator";
  }
  return null;
}

/** Converts a ParsedWorkflowSpec into a serializable XML string for the Rust backend. */
export function workflowSpecToXml(spec: ParsedWorkflowSpec): string {
  const eventsXml = spec.events
    .map(
      (e) => `    <event>
      <name>${e.name}</name>
      <agent>${e.agent}</agent>
      <listen>${e.listen}</listen>
      <action>${e.action}</action>
      <output>${e.output}</output>
      ${e.goto ? `<goto>${e.goto}</goto>` : ""}
    </event>`
    )
    .join("\n");

  return `<workflow>
  <title>${spec.title}</title>
  <pattern>${spec.pattern}</pattern>
  <input>${spec.input}</input>
  <events>
${eventsXml}
  </events>
</workflow>`;
}

/** Converts a ParsedAgentSpec back to XML string. */
export function agentSpecToXml(spec: ParsedAgentSpec): string {
  const agentsXml = spec.agents
    .map(
      (a) => `  <agent>
    <name>${a.name}</name>
    <description>${a.description}</description>
    <instruction>${a.instruction}</instruction>
    <tools>
${a.tools.map((t) => `      <tool>${t}</tool>`).join("\n")}
    </tools>
    <output>${a.output}</output>
  </agent>`
    )
    .join("\n");

  return `<agents>\n${agentsXml}\n</agents>`;
}
