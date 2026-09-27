# Antigravity AI Automation Architecture Plan

This document outlines a powerful, detailed analysis plan to build an automated AI agent using local execution, giving it complete system control via voice or chat commands.

## Phase 1: Core Architecture and Local Runtime Environment

The foundation of this localized AI control system relies on the Google Antigravity SDK, a Python framework specifically designed to manage AI agents. To achieve a 100% air-gapped, local execution environment, the system leverages `LiteRTAgentConfig` with a downloaded on-device model or `LocalOpenAIAgentConfig` pointed at a local server. However, local inference alone does not guarantee that zero data leaves the host; a true air-gapped environment requires strict network egress restrictions and exclusively local `stdio` MCP servers, ensuring no discovered MCP configuration routes prompt-derived tool arguments to external `serverUrl` endpoints.

To initiate the core controller, the Python agent must be instantiated with unrestricted execution rights. By default, the Antigravity Agent runs in a read-only safety mode; comprehensive system control requires passing `capabilities=CapabilitiesConfig()` into the configuration, which enables all tools, including system-level writes and file modifications. The main agent lifecycle is managed via an asynchronous context manager, discovering binaries, wiring tools, and registering lifecycle hooks dynamically. 

## Phase 2: Autonomous Tool Orchestration via Model Context Protocol (MCP)

To ensure the "nodes" actually function and manipulate the host operating system rather than outputting theoretical text, the agent must bridge to the OS using the open-standard Model Context Protocol (MCP). MCP acts as the universal secure bridge connecting the Antigravity AI to local developer tools, system shells, file parsers, and local databases. 

Instead of writing bespoke proxy functions, you will configure local MCP servers using `stdio` processes defined in the global `~/.gemini/config/mcp_config.json` configuration file. 
The operational nodes required for full system control include:
*   **System Shell Execution Node:** A local standard I/O (stdio) MCP server that executes bash/PowerShell commands.
*   **File System Management Node:** An MCP server granting read/write/execute permissions across the local directory structure.
*   **Process Management Node:** For spawning, monitoring, and killing local processes.

The Antigravity SDK automatically discovers these servers when configured in the workspace's `.agents/mcp_config.json` file, seamlessly integrating them into the agent's execution pipeline alongside custom Python functions. Access to these MCP tools is governed by a permissions policy. To eliminate human intervention for safe commands, the policy must explicitly allow per-server or per-tool rules (e.g., `mcp(file_system/read)`), while retaining user confirmation for destructive operations (e.g., file deletion or process killing).

## Phase 3: Unattended Automation and Remote Interaction Bridge

To achieve complete automation without human supervision, the system utilizes the Antigravity Automation bridge. This local server eliminates manual interaction by automatically approving execution prompts and interacting with the UI. 

The automation bridge runs entirely on the local machine and exposes two critical local endpoints:
*   **REST API (Default Port 5000):** Used to programmatically enqueue prompts and manage state. You will utilize the `POST /toggle_auto_run` and `POST /toggle_auto_allow` endpoints to permanently suppress user confirmation dialogs for long-running autonomous sessions.
*   **WebSocket Stream (Default Port 9812):** Used to stream AI reasoning, standard output, and tool execution status in real-time with sub-second latency back to your external dashboards or voice-synthesizers. 

Using the `POST /send_command` endpoint, external scripts or triggers can inject chat instructions directly into the active AI context stream, allowing the agent to react to external programmatic stimuli instantly. 

## Phase 4: Voice and Chat Command Integration

The command injection pipeline requires dual-modal input (Voice and Chat) translating into standard text commands for the SDK.

**Voice Commands:**
The standalone Antigravity desktop command center natively supports voice transcription out of the box. Alternatively, for a fully custom Python backend, you can route a local lightweight Whisper model's STT (Speech-to-Text) output directly into the Antigravity Agent using the Python SDK's `agent.chat()` asynchronous method. 

**Chat/Text Commands:**
For real-time console applications or fluid UIs, chat inputs are passed to the agent, and the responses can be streamed via an `async for token in response:` loop. This zero-network-overhead stream directly yields conversational text tokens as the local model processes the command, which can then be piped back to a local TTS (Text-to-Speech) engine. Advanced programmatic streams, such as `response.tool_calls`, can be intercepted to trigger local UI spinners or visual feedback while the agent executes OS-level commands.

## Phase 5: Asynchronous Subagent Delegation

To ensure the system remains responsive to new voice or chat commands while executing complex system operations (like compiling code, searching the local filesystem, or modifying registry keys), the architecture must utilize Asynchronous Subagents. 

The main Antigravity agent acts as a supervisor routing the user's intent. When a heavy system task is detected, it delegates the operation to parallel concurrent subagents operating in the background. This allows the primary voice/chat loop to remain unblocked. These subagents are spawned programmatically via the Antigravity SDK and utilize the same local MCP node connections to perform safe, isolated modifications to the operating system. Visual artifacts, such as execution logs and state changes, are tracked asynchronously, allowing the main agent to report task completion back through the WebSocket stream once the subagent finishes.