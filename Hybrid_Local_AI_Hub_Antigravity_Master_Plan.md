# Hybrid Local AI Hub
## Master Analysis, Architecture, Research & Implementation Plan for a Fully Local Autonomous System-Control Agent

## 1. Project Objective

Hybrid Local AI Hub is intended to become a **local-first autonomous AI agent platform** capable of receiving commands through:

- Local voice
- Local chat
- Future GUI interactions

and converting those commands into executable automations that can control the user's computer through real, tested capabilities.

The target pipeline is:

```text
USER
 │
 ├── Voice
 │
 └── Chat
      │
      ▼
LOCAL INPUT PROCESSOR
      │
      ▼
LOCAL LLM
      │
      ▼
INTENT UNDERSTANDING
      │
      ▼
TASK ANALYSIS
      │
      ▼
PLAN GENERATION
      │
      ▼
PLAN VALIDATION
      │
      ▼
AGENT GRAPH / NODE GRAPH
      │
      ▼
CAPABILITY + PERMISSION CHECK
      │
      ▼
AGENT RUNTIME
      │
      ▼
NODE EXECUTION
      │
      ▼
OBSERVATION
      │
      ▼
VERIFICATION
      │
      ├── SUCCESS → NEXT NODE
      ├── RETRY → RECOVERY
      └── FAILURE → REPLAN / ASK USER
      │
      ▼
FINAL RESULT
      │
      ▼
LOCAL CHAT / VOICE RESPONSE
```

The core architectural principle is:

> **The LLM decides what should happen; the Agent Runtime decides how it is safely and reliably executed.**

The LLM must not directly control the computer or bypass runtime validation.

---

# 2. First Requirement: Analyze the Existing Repository

Before making major changes, inspect the entire existing repository.

Determine:

1. Programming language(s)
2. Frontend framework
3. Backend/runtime
4. Existing agent implementation
5. Existing node implementation
6. Existing JSON schemas
7. Local LLM integration
8. Ollama integration, if present
9. Database/storage
10. Scheduler
11. Event system
12. Voice system
13. System-control functionality
14. Permission/security mechanisms
15. Existing tests
16. Existing documentation
17. Placeholder/mock implementations
18. Dead or duplicated code
19. Architectural limitations
20. Missing functionality

Create an internal architecture map:

```text
Current Architecture
        ↓
Current Agent Runtime
        ↓
Current Node System
        ↓
Current Model Integration
        ↓
Current UI
        ↓
Current Storage
        ↓
Current Scheduler
        ↓
Current System Tools
        ↓
Missing Components
        ↓
Required Implementation
```

Do not replace working components without a concrete technical reason.

---

# 3. Core Product Requirement

The system must become a:

> **Local-first autonomous agent execution platform**

It must be able to transform natural-language requests into actual executable workflows.

Example:

> "Every day at 9 AM open my notes folder, find today's notes, summarize them locally, create a summary file, and notify me."

The application should actually:

```text
Schedule Trigger
      ↓
Find Files
      ↓
Read Files
      ↓
Local LLM Summarization
      ↓
Write Summary
      ↓
Notify User
```

Another example:

> "Monitor my CPU and alert me if it remains above 80% for 30 seconds."

The system should actually monitor CPU usage and execute the resulting workflow.

---

# 4. Offline-First Architecture

Offline Mode must work without:

- Internet access
- Cloud LLMs
- External AI APIs
- Remote agent execution
- Hidden network calls

The expected architecture is:

```text
Chat
  ↓
Local LLM
  ↓
Agent Planner
  ↓
Local Runtime
  ↓
Local Nodes
  ↓
Computer
```

If an operation requires the Internet, Offline Mode must reject it explicitly.

Example:

```text
User:
"Search the web for today's weather."

Offline Runtime:
Network operation requested
        ↓
Network capability denied
        ↓
Explain that Internet access is required
```

The application must not silently switch to Online Mode.

---

# 5. Hybrid / Online Mode

Online Mode should extend Offline Mode instead of creating a completely separate agent engine.

Both modes should share:

- Agent schema
- Node schema
- Runtime
- Scheduler
- Event bus
- Permissions
- Validation
- Logging
- Recovery
- State management

Architecture:

```text
                 AGENT RUNTIME
                      │
          ┌───────────┴───────────┐
          │                       │
   LOCAL CAPABILITIES       ONLINE CAPABILITIES
          │                       │
 Files/System/Apps         Web/API/Cloud
          │                       │
          └───────────┬───────────┘
                      │
                  AGENT GRAPH
```

Online functionality must be represented as explicit capabilities.

---

# 6. Real Node System

Nodes must be real executable components.

A node is not considered implemented merely because it exists in:

- UI
- JSON
- Documentation
- Registry metadata

Every implemented node must contain:

1. Unique ID
2. Version
3. Input schema
4. Output schema
5. Configuration schema
6. Runtime implementation
7. Validation
8. Permission requirements
9. Error handling
10. Cancellation handling
11. Timeout handling
12. Logging
13. Automated tests
14. Documentation

A node is complete only after actual tests prove that it works.

---

# 7. Common Node Contract

Implement a common node abstraction compatible with the existing project architecture.

Conceptually:

```text
Node
 ├── metadata()
 ├── validate(input)
 ├── required_capabilities()
 ├── execute(context, input)
 ├── cancel()
 ├── timeout()
 ├── describe()
 └── test()
```

Each node execution context should contain, as appropriate:

```text
execution_id
agent_id
node_id
inputs
configuration
memory/state
permissions
cancellation_token
timeout
logger
event_bus
filesystem_policy
process_policy
network_policy
environment
```

Do not blindly copy this pseudocode. Adapt it to the actual repository architecture.

---

# 8. Node Registry

Implement a real node registry.

Suggested categories:

```text
Node Registry
│
├── Trigger Nodes
├── Logic Nodes
├── Data Nodes
├── File Nodes
├── Process Nodes
├── System Nodes
├── Application Nodes
├── UI Automation Nodes
├── Monitoring Nodes
├── Communication Nodes
├── AI Nodes
├── Memory Nodes
├── Scheduling Nodes
└── Utility Nodes
```

The registry must expose only nodes that actually exist.

The LLM must not invent node IDs.

If a requested node is not registered and implemented, plan validation must fail.

---

# 9. Trigger Nodes

Implement real triggers such as:

```text
ManualTrigger
ScheduleTrigger
IntervalTrigger
FileCreatedTrigger
FileChangedTrigger
FileDeletedTrigger
ProcessStartedTrigger
ProcessExitedTrigger
SystemStartupTrigger
SystemShutdownTrigger
HotkeyTrigger
EventTrigger
ConditionTrigger
```

Online-only functionality such as webhooks should remain unavailable in strict Offline Mode.

Triggers must be backed by real event sources.

---

# 10. File System Nodes

Required local filesystem capabilities:

```text
ReadFile
WriteFile
AppendFile
CopyFile
MoveFile
RenameFile
DeleteFile
CreateDirectory
DeleteDirectory
ListDirectory
FindFiles
WatchDirectory
GetFileMetadata
CalculateFileHash
CompressFiles
ExtractArchive
```

Requirements:

- Path normalization
- Relative/absolute path handling
- Permission validation
- Allowed-directory policies
- Error handling
- Logging
- Cancellation
- Large-file handling
- Encoding handling where applicable

Destructive operations must respect the configured confirmation policy.

---

# 11. Process and Application Nodes

Implement actual process control:

```text
ListProcesses
GetProcessInfo
StartProcess
StopProcess
RestartProcess
WaitForProcess
CheckProcessRunning
GetProcessResourceUsage
```

Applications should be represented by controlled application definitions.

Do not give the LLM unrestricted arbitrary process execution by default.

Distinguish:

```text
Approved Application
Unknown Application
Restricted Application
```

---

# 12. System Monitoring Nodes

Implement actual operating-system metrics:

```text
GetCPUUsage
GetMemoryUsage
GetDiskUsage
GetDiskIO
GetNetworkStatistics
GetBatteryStatus
GetTemperature
GetProcessCPU
GetProcessMemory
GetSystemUptime
```

These must use real OS APIs or reliable local libraries.

Never generate fake metric values in production.

---

# 13. Logic and Control-Flow Nodes

Implement real:

```text
If
Else
Switch
Compare
Equals
GreaterThan
LessThan
Contains
RegexMatch
And
Or
Not
Loop
ForEach
While
Wait
Retry
Timeout
Parallel
Sequence
Branch
Merge
```

The execution engine must actually enforce the semantics.

Example:

```text
GetCPUUsage (poll continuously over 30s)
      ↓
Did CPU stay > 80% entire time? (reset timer if <= 80%)
      ↓
YES
      ↓
GetProcessResourceUsage
      ↓
WriteFile
      ↓
NotifyUser
```

---

# 14. Data Processing Nodes

Implement:

```text
ParseJSON
CreateJSON
ParseCSV
CreateCSV
TransformData
FilterData
SortData
MapData
AggregateData
ExtractText
RegexExtract
Template
FormatText
ConvertData
```

Nodes must operate on real runtime data.

---

# 15. Local AI Nodes

Create provider-independent local AI abstractions.

Suggested nodes:

```text
LocalLLM
LocalLLMReason
LocalLLMClassify
LocalLLMExtract
LocalLLMSummarize
LocalLLMGenerate
LocalLLMDecision
LocalEmbedding
LocalSpeechToText
LocalTextToSpeech
```

Potential local backends may include:

```text
Ollama
llama.cpp
Local model servers
ONNX/local inference
Other supported local runtimes
```

Do not hard-code the entire architecture around one provider.

---

# 16. Local Voice Control

Offline voice architecture:

```text
Microphone
   ↓
Local Voice Activity Detection
   ↓
Local Speech-to-Text
   ↓
Command Normalization
   ↓
Local LLM
   ↓
Agent Planner
   ↓
Agent Runtime
   ↓
Local Text-to-Speech
   ↓
Speaker
```

Support:

```text
Push-to-talk
Voice command
Command cancellation
Confirmation
Voice response
```

Microphone audio must remain local in Offline Mode.

---

# 17. Computer Control

Computer-control capabilities should be separated into explicit capability groups.

## Keyboard

```text
PressKey
TypeText
KeyCombination
Hotkey
```

## Mouse

```text
MoveMouse
Click
DoubleClick
RightClick
Drag
Scroll
```

## Screen

```text
CaptureScreen
GetScreenDimensions
FindVisualElement
WaitForVisualElement
```

## Window Management

```text
ListWindows
GetActiveWindow
FocusWindow
MoveWindow
ResizeWindow
MinimizeWindow
MaximizeWindow
CloseWindow
```

## Application Interaction

```text
LaunchApplication
FocusApplication
InteractWithApplication
CloseApplication
```

These must perform real operating-system interactions.

---

# 18. UI Automation and Computer Vision

Use the following preference order where possible:

```text
Accessibility/UI Automation
        ↓
Structured application APIs
        ↓
DOM/browser automation where applicable
        ↓
OCR
        ↓
Image matching
        ↓
Coordinate interaction
```

Coordinates should not be the primary strategy when reliable structured UI information exists.

Architecture:

```text
Screen Capture
      ↓
Visual Perception
      ↓
Element Detection
      ↓
Element Identification
      ↓
Action
      ↓
Screen/UI Verification
```

---

# 19. Observe → Act → Verify

Computer-control actions should use:

```text
OBSERVE
   ↓
PLAN
   ↓
ACT
   ↓
OBSERVE AGAIN
   ↓
VERIFY
```

Example:

```text
Launch Calculator
      ↓
Wait for application/window
      ↓
Focus window
      ↓
Verify expected application
      ↓
Perform action
      ↓
Verify result
```

Avoid relying entirely on arbitrary sleep delays.

---

# 20. Agent Planner

The local LLM converts natural language into structured plans.

Example request:

> "If CPU stays above 80% for 30 seconds, notify me and save the top processes to a file."

Conceptual plan:

```json
{
  "trigger": {
    "node": "SystemMonitorTrigger"
  },
  "graph": [
    {
      "node": "GetCPUUsage"
    },
    {
      "node": "GreaterThan",
      "value": 80
    },
    {
      "node": "Wait",
      "duration": 30
    },
    {
      "node": "GetCPUUsage"
    },
    {
      "node": "GreaterThan",
      "value": 80
    },
    {
      "node": "GetProcessResourceUsage"
    },
    {
      "node": "WriteFile"
    },
    {
      "node": "NotifyUser"
    }
  ]
}
```

The plan must never be executed directly from raw LLM output.

Validation pipeline:

```text
Parse
 ↓
Schema Validate
 ↓
Node Validate
 ↓
Capability Validate
 ↓
Permission Validate
 ↓
Resource Validate
 ↓
Graph Validate
 ↓
Execute
```

---

# 21. Agent JSON Schema

Create a versioned agent format.

Conceptual structure:

```json
{
  "schema_version": "1.0",
  "agent": {
    "id": "cpu-monitor",
    "name": "CPU Monitor",
    "description": "Monitors CPU usage and alerts the user when sustained usage exceeds a threshold"
  },
  "mode": "offline",
  "inputs": {},
  "permissions": [],
  "triggers": [],
  "nodes": [],
  "edges": [],
  "state": {},
  "memory": {},
  "error_policy": {},
  "limits": {},
  "metadata": {}
}
```

The final schema must be adapted to the actual project.

Implement:

```text
Schema validation
Serialization
Deserialization
Versioning
Migration
Backward compatibility where practical
```

---

# 22. Agent Execution Engine

Implement a real execution lifecycle:

```text
CREATED
   ↓
VALIDATING
   ↓
READY
   ↓
RUNNING
   ↓
WAITING
   ↓
RUNNING
   ↓
VERIFYING
   ↓
COMPLETED
```

Failure states:

```text
FAILED
CANCELLED
TIMED_OUT
BLOCKED
WAITING_FOR_APPROVAL
```

Required capabilities:

- Cancellation
- Timeout
- Retry
- Checkpoints
- Recovery
- Error propagation
- Execution history
- Node-level logs
- Execution IDs
- State persistence

---

# 23. Failure Recovery

Agents must not immediately fail when recoverable errors occur.

Example:

```text
Open Application
      ↓
FAILED
      ↓
Check whether application is already open
      ↓
If yes → focus existing window
      ↓
If no → retry launch
      ↓
Verify
```

Recovery policies:

```text
retry
retry_with_backoff
alternative_node
replan
ask_user
abort
```

The LLM may assist with replanning, but the runtime remains responsible for enforcing limits and permissions.

---

# 24. Memory and State

Separate the following:

### Agent Configuration

Defines what the agent is.

### Runtime State

Defines what the agent is currently doing.

### Persistent Memory

Information explicitly permitted to be retained.

### Execution History

Records what happened during previous executions.

Use local persistent storage.

A database such as SQLite is appropriate if compatible with the existing architecture.

Potential tables:

```text
agents
agent_versions
executions
execution_nodes
events
memory
variables
schedules
permissions
approvals
logs
```

---

# 25. Scheduler

Implement a real local scheduler supporting:

```text
Run once
Every X minutes
Hourly
Daily
Weekly
Specific date/time
Cron-like schedules
Startup
File event
System event
```

Scheduled agents must survive application restart where appropriate.

---

# 26. Event Bus

Implement an internal event bus:

```text
System Event
     ↓
Event Bus
     ↓
Matching Trigger
     ↓
Agent Execution
```

Potential events:

```text
file.created
file.changed
process.started
process.exited
system.startup
system.shutdown
timer.elapsed
user.command
voice.command
window.changed
application.opened
```

---

# 27. Capability-Based Permission System

Agents must not receive unrestricted privileges automatically.

Capabilities can include:

```text
filesystem.read
filesystem.write
filesystem.delete

process.read
process.start
process.stop

system.read
system.modify

input.keyboard
input.mouse

screen.capture
window.control

network.read
network.write

application.launch
```

Agents request capabilities.

The runtime evaluates those capabilities against the active policy.

Example:

```text
Agent requests:
filesystem.read
filesystem.write

Allowed directory:
Documents/Automation
```

The LLM cannot bypass these policies.

---

# 28. Human Approval System

Support policies:

```text
automatic
ask_once
ask_each_time
blocked
```

Potential confirmation operations:

```text
Delete files
Overwrite important files
Terminate processes
Change system configuration
Install software
Modify security settings
Send external communication
Privileged operations
```

UI example:

```text
Agent wants to:

Delete:
C:\Example\file.txt

Reason:
Cleanup operation

[Allow] [Deny]
```

---

# 29. Dry Run Mode

Every agent should support:

```text
DRY RUN
```

Example:

```text
User:
"Delete all temporary files."

Dry Run:

Would delete:
- file1.tmp
- file2.tmp
- file3.tmp
```

No destructive operation is performed.

---

# 30. Plan Preview

Before executing a newly generated complex agent, show:

```text
PLAN

Trigger:
Every day at 9 AM

Actions:
1. Read Documents/Notes
2. Find today's files
3. Summarize using local LLM
4. Write summary
5. Notify user

Required permissions:
- Documents read
- Documents write
- Local LLM
- Notification
```

Available actions:

```text
Run
Edit
Dry Run
Cancel
```

---

# 31. LLM Must Not Invent Tools

The model should receive a generated catalog containing only real registered nodes.

Example:

```text
AVAILABLE NODE

Name:
GetCPUUsage

Description:
Returns current CPU utilization.

Input:
none

Output:
cpu_percent

Required capability:
system.read
```

The planner must construct plans only from the available tool catalog.

---

# 32. Tool Result Feedback

Return structured execution results to the LLM.

Success:

```json
{
  "success": true,
  "node": "GetCPUUsage",
  "output": {
    "cpu_percent": 84.2
  }
}
```

Failure:

```json
{
  "success": false,
  "node": "LaunchApplication",
  "error": {
    "code": "APPLICATION_NOT_FOUND",
    "message": "Application could not be located"
  }
}
```

This allows replanning based on actual system state.

---

# 33. Controlled Autonomous Loop

Implement:

```text
OBSERVE
   ↓
UNDERSTAND
   ↓
PLAN
   ↓
VALIDATE
   ↓
ACT
   ↓
OBSERVE
   ↓
VERIFY
   ↓
SUCCESS?
 ┌─┴─┐
YES  NO
 │    │
END   RECOVER
       ↓
     REPLAN
       ↓
      ACT
```

Hard limits must include:

```text
Maximum steps
Maximum runtime
Maximum retries
Maximum LLM calls
Maximum resource consumption
Maximum replanning depth
```

Never permit uncontrolled infinite loops.

---

# 34. Required End-to-End Test Agents

## Test Agent 1 — File Automation

Command:

> "Create a folder called TestAutomation in my Documents folder and create a text file containing Hello from Hybrid Local AI Hub."

Expected:

```text
CreateDirectory
      ↓
WriteFile
      ↓
ReadFile
      ↓
VerifyContent
```

The test must inspect the real resulting file.

---

## Test Agent 2 — CPU Monitor

Command:

> "Monitor CPU usage and notify me if it stays above 80%."

Expected:

```text
Interval Trigger
        ↓
GetCPUUsage
        ↓
Compare > 80
        ↓
Condition
        ↓
Wait
        ↓
GetCPUUsage
        ↓
Compare
        ↓
Notify
```

Actual system CPU metrics must be used.

---

## Test Agent 3 — Application Control

Command:

> "Open Calculator."

Expected:

```text
LaunchApplication
      ↓
WaitForWindow
      ↓
VerifyWindow
```

No fake success.

If Calculator is already open, detect and focus the existing instance where possible.

---

## Test Agent 4 — File Search + AI

Command:

> "Find all text files in my test folder and summarize their contents."

Expected:

```text
FindFiles
   ↓
ReadFile
   ↓
LocalLLMSummarize
   ↓
WriteFile
```

---

## Test Agent 5 — Voice

Command:

> "Open Calculator."

Expected:

```text
Microphone
   ↓
Local STT
   ↓
Text command
   ↓
Agent Planner
   ↓
LaunchApplication
   ↓
Verification
   ↓
Local TTS
```

No cloud service in Offline Mode.

---

# 35. Automated Node Testing

Every implemented node must have appropriate:

```text
Unit Test
Integration Test
Failure Test
Permission Test
Cancellation Test
Timeout Test
```

Example:

```text
WriteFile
├── Writes correctly
├── Invalid path rejected
├── Permission denied handled
├── Cancellation handled
└── Overwrite policy enforced
```

A node must not be marked complete without testing.

---

# 36. Test Sandbox

Create a dedicated environment:

```text
HybridLocalAIHub/
    test_sandbox/
        files/
        output/
        temp/
        applications/
```

Destructive tests should use this sandbox rather than arbitrary user directories.

---

# 37. Node Completeness Audit

Create an audit command/tool that produces:

```text
NODE IMPLEMENTATION AUDIT

Node                 Implementation    Tests    Status
---------------------------------------------------------
ReadFile             YES               YES      PASS
WriteFile            YES               YES      PASS
DeleteFile           YES               YES      PASS
GetCPUUsage          YES               YES      PASS
LaunchApplication    YES               YES      PASS
...
```

Node states should distinguish:

```text
IMPLEMENTED
TESTED
EXPERIMENTAL
DISABLED
UNAVAILABLE
```

A node must not appear as available merely because metadata exists.

---

# 38. No Placeholder Policy

Production node implementations must not contain fake behavior such as:

```text
TODO
pass
return true
return false
fake result
random value
hardcoded success
"not implemented"
```

If functionality cannot be implemented reliably on the current platform, mark it:

```text
UNSUPPORTED
```

and document why.

Never pretend that unsupported functionality works.

---

# 39. Cross-Platform Architecture

Initially target the operating system supported by the existing project.

Create an abstraction:

```text
SystemControl
     │
 ┌───┼─────────────┐
 │   │             │
Windows Linux     macOS
```

Platform-specific code should remain behind interfaces.

Do not scatter operating-system-specific implementation throughout the agent engine.

---

# 40. Security Boundary

The system should provide powerful legitimate automation on the user's own computer while preserving explicit control.

Do not implement:

- Hidden persistence
- Credential theft
- Security bypasses
- Uncontrolled privilege escalation
- Silent privilege acquisition
- Silent network activation

Agents must respect:

- OS permissions
- Application security
- User approval
- Network restrictions
- Filesystem policies

---

# 41. Observability

Create an execution inspector.

Show:

```text
Agent
Execution ID
Start time
End time
Current state
```

For every node:

```text
Node
Started
Input
Output
Duration
Status
```

Errors should show:

```text
Error code
Node
Input
Cause
Recovery attempt
Final result
```

---

# 42. Persistent Execution State

If the application closes unexpectedly:

```text
Agent
 ↓
Execution state persisted
 ↓
Application restart
 ↓
Recoverable execution detected
 ↓
Resume / retry / ask user
```

Do not blindly repeat dangerous actions after restart.

Nodes should indicate whether they are:

```text
idempotent
non-idempotent
unknown
```

Use this information when deciding whether automatic recovery is safe.

---

# 43. Resource Management

Implement limits for:

```text
Execution timeout
Node timeout
LLM call count
Retry count
Parallelism
File size
Output size
Memory where practical
CPU where practical
```

Do not allow an agent to consume unlimited resources.

---

# 44. Natural-Language Agent Creation

Support commands such as:

> "Create an agent that watches my Downloads folder. Whenever a PDF appears, move it into a PDF folder and tell me."

Pipeline:

```text
Understand requirement
        ↓
Ask necessary clarification only
        ↓
Generate graph
        ↓
Validate graph
        ↓
Show plan
        ↓
Request permissions
        ↓
Create agent
        ↓
Activate agent
```

The generated agent must be persisted.

---

# 45. Natural-Language Agent Modification

Support:

> "Change that agent so it only runs between 9 AM and 6 PM."

and:

> "Instead of moving the files, copy them."

Modify the existing agent rather than creating an unrelated agent.

Use versioning:

```text
v1
v2
v3
```

Allow rollback.

---

# 46. Multi-Agent Foundation

The first implementation does not need excessive multi-agent complexity, but the runtime should support multiple independent agents.

Example:

```text
Agent A
File Organizer

Agent B
CPU Monitor

Agent C
Daily Notes Summarizer
```

Each should have isolated:

- Execution state
- Permissions
- Memory
- Schedules
- Logs

---

# 47. Local Model Abstraction

Create:

```text
ModelProvider
```

with implementations such as:

```text
OllamaProvider
LlamaCppProvider
LocalServerProvider
```

The agent runtime should not depend on a specific model provider.

Configuration should support:

```text
model
temperature
context length
structured output support
tool calling support
streaming support
timeout
```

---

# 48. Model Role Separation

Do not force one model to perform every task.

Architect for:

```text
Reasoning Model
      ↓
Agent planning

Fast Model
      ↓
Classification / extraction

STT Model
      ↓
Voice recognition

TTS Model
      ↓
Voice output

Embedding Model
      ↓
Memory/search
```

All can remain local.

---

# 49. Local Tool Documentation

Create a machine-readable local tool catalog.

Each node should expose:

```text
node id
description
inputs
outputs
examples
permissions
failure modes
side effects
```

The planner should retrieve relevant node documentation when generating a plan.

---

# 50. Agent Graph Validation

Validate:

## Structural

```text
No orphan nodes
Valid edges
Valid node IDs
Valid ports
Valid data types
Valid graph structure
```

## Semantic

```text
Inputs exist before use
Output types match inputs
Trigger exists
Terminal path exists
No impossible dependency
```

## Security

```text
Required capability granted
Path permitted
Application permitted
Network permitted
```

---

# 51. Data-Type System

Use typed values instead of passing everything as strings.

Suggested types:

```text
String
Number
Boolean
FilePath
File
Directory
Process
Window
Image
Audio
JSON
Array
Object
DateTime
Duration
```

---

# 52. Cancellation

The user must be able to say:

> "Stop."

or use a Stop button.

Cancellation pipeline:

```text
User cancellation
      ↓
Execution engine
      ↓
Current node
      ↓
Child processes/tasks
      ↓
Cleanup
      ↓
CANCELLED
```

Do not leave unintended background processes running.

---

# 53. Chat Interface

Display actual runtime state:

```text
Understanding...
Planning...
Validating...
Permissions...
Executing...
```

Then:

```text
✓ Step 1
✓ Step 2
✓ Step 3

Completed.
```

For complex agents expose:

```text
Plan
Execution
Logs
Result
```

---

# 54. Voice Interface

Display or announce:

```text
Listening...
Understanding...
Executing...
Completed.
```

The user should be able to interrupt execution.

---

# 55. Offline Network Guarantee

Create a network policy layer.

Modes:

```text
OFFLINE
ONLINE
HYBRID
```

Offline:

```text
Network = DENY
```

Online:

```text
Network = ALLOWED according to policy
```

Hybrid:

```text
Explicit per-agent/per-node permission
```

Network-capable nodes must not silently execute in Offline Mode.

---

# 56. Offline Testing

Create an automated offline test mode.

Tests should verify:

```text
Local LLM works
Local STT works
Local TTS works
File automation works
Process automation works
System monitoring works
Scheduler works
Agent execution works
```

Where practical, disable network access during tests and verify that Offline Mode remains functional.

---

# 57. Required Documentation

Generate:

```text
ARCHITECTURE.md
AGENT_RUNTIME.md
NODE_SYSTEM.md
NODE_DEVELOPMENT.md
AGENT_SCHEMA.md
VOICE_SYSTEM.md
SYSTEM_CONTROL.md
PERMISSIONS.md
SECURITY.md
OFFLINE_MODE.md
ONLINE_MODE.md
HYBRID_MODE.md
TESTING.md
TROUBLESHOOTING.md
```

Also generate an automatically maintained node catalog.

---

# 58. Implementation Phases

## Phase 0 — Repository Analysis

Produce:

```text
Current architecture
Existing functionality
Missing functionality
Technical risks
Recommended implementation order
```

Do not make major architectural changes before completing this analysis.

---

## Phase 1 — Runtime Foundation

Implement:

```text
Agent schema
Node interface
Node registry
Execution context
Execution engine
Execution states
Logging
Error model
Cancellation
Timeout
```

---

## Phase 2 — Core Nodes

Implement and test:

```text
Triggers
Filesystem
Data
Logic
Process
System monitoring
Notifications
```

---

## Phase 3 — Local AI

Implement:

```text
Model abstraction
Local LLM
Structured generation
Plan validation
Tool catalog
LLM feedback loop
```

---

## Phase 4 — Computer Control

Implement:

```text
Keyboard
Mouse
Screen
Window
Application
UI automation
Observation
Verification
```

---

## Phase 5 — Voice

Implement:

```text
Local STT
Voice command pipeline
Local TTS
Voice interruption
```

---

## Phase 6 — Autonomous Agent Creation

Implement:

```text
Natural language → agent
Agent editing
Agent validation
Agent preview
Dry run
Agent persistence
Versioning
```

---

## Phase 7 — Scheduler + Events

Implement:

```text
Scheduler
Event bus
File events
System events
Process events
Recurring agents
```

---

## Phase 8 — Permissions

Implement:

```text
Capability system
Approval system
Filesystem policies
Process policies
Application policies
Network policies
```

---

## Phase 9 — Recovery

Implement:

```text
Retry
Backoff
Checkpoint
Resume
Replan
Failure classification
Idempotency metadata
```

---

## Phase 10 — UI

Build the user interface around the actual runtime.

Do not build a visual mockup first and connect fake functionality afterward.

The UI must expose real backend state.

---

# 59. Critical Implementation Rule

At every stage:

```text
IMPLEMENT
    ↓
TEST
    ↓
RUN REAL TEST
    ↓
VERIFY
    ↓
DOCUMENT
    ↓
ONLY THEN CONTINUE
```

Do not implement a large collection of nodes and postpone testing until the end.

Implement small groups and verify them continuously.

---

# 60. Final Acceptance Test — Autonomous CPU Agent

The following scenario must work end-to-end without Internet access.

User says:

> "Create an automation that checks my CPU every 10 seconds. If it stays above 80% for 30 seconds, collect the top CPU-consuming processes, save the information to a file in my Documents folder, and notify me."

Expected:

```text
Voice
 ↓
Local STT
 ↓
Text
 ↓
Local LLM
 ↓
Intent understanding
 ↓
Plan generation
 ↓
Plan validation
 ↓
Required capabilities
 ↓
User approval if required
 ↓
Agent created
 ↓
Scheduler/event runtime
 ↓
CPU monitoring
 ↓
Threshold detection
 ↓
30-second verification
 ↓
Process collection
 ↓
File creation
 ↓
Notification
 ↓
Execution log
```

Then:

> "Stop that automation."

The runtime must actually stop it.

Then:

> "Change it so the threshold is 90%."

The existing agent should be modified and versioned.

Then:

> "Run it once now."

The runtime should execute it immediately.

The complete lifecycle must work without Internet access.

---

# 61. Second Acceptance Test — Computer Control

User:

> "Open Calculator."

Expected:

```text
Local STT / Chat
 ↓
Intent
 ↓
Agent plan
 ↓
Launch application
 ↓
Wait for application
 ↓
Verify application
 ↓
Report success
```

If Calculator is already open:

```text
Detect existing window
 ↓
Focus existing window
 ↓
Verify
```

Do not blindly create duplicate instances.

---

# 62. Third Acceptance Test — File Automation

User:

> "Whenever a .txt file appears in my test folder, append its filename and creation time to a log file."

Expected:

```text
WatchDirectory
 ↓
FileCreated
 ↓
Filter extension
 ↓
GetFileMetadata
 ↓
FormatText
 ↓
AppendFile
```

Create a real test file and verify the log changes.

---

# 63. Fourth Acceptance Test — Failure Recovery

Intentionally cause a node failure, for example:

```text
Application unavailable
```

Expected:

```text
Detect failure
 ↓
Classify error
 ↓
Attempt recovery where appropriate
 ↓
Retry / replan / ask user
 ↓
Record result
```

The system must never falsely report success.

---

# 64. Performance Measurements

Measure:

```text
LLM planning latency
Node execution latency
Voice recognition latency
Agent startup latency
Memory usage
CPU usage
Scheduler accuracy
```

Profile before optimizing.

---

# 65. Architecture Principle

Maintain this strict separation:

```text
LLM
=
Reasoning + Planning + Interpretation

RUNTIME
=
Execution + Security + Scheduling + State + Recovery

NODES
=
Actual Capabilities

EVENT BUS
=
System Events

SCHEDULER
=
Time-Based Execution

MEMORY
=
Persistent Knowledge/State

UI
=
User Control + Visibility
```

Do not put runtime responsibilities inside the LLM.

---

# 66. Research Requirement

Before implementing major subsystems, research established technical approaches and reliable libraries relevant to the actual target platform.

Research:

```text
Local LLM tool calling
Structured output
Agent execution engines
Workflow DAG execution
Desktop automation
Windows UI Automation
Accessibility APIs
Keyboard/mouse automation
Screen capture
OCR
Local speech recognition
Local text-to-speech
File system watchers
Process monitoring
System metrics
Local schedulers
Event buses
SQLite agent state
Agent recovery
Workflow persistence
Capability-based permissions
Sandboxing
```

For each candidate technology, verify:

```text
API availability
Platform compatibility
License
Maintenance status
Actual functionality
Offline capability
```

Do not blindly copy internet examples.

---

# 67. Technology Selection Rules

When selecting technologies:

1. Prefer compatibility with the existing repository.
2. Prefer mature libraries.
3. Prefer local/offline functionality.
4. Prefer maintainability.
5. Prefer deterministic behavior.
6. Prefer OS-native APIs for system control where appropriate.
7. Prefer structured interfaces over screen-coordinate hacks.
8. Prefer tested libraries over unnecessary custom low-level implementations.
9. Avoid unnecessary dependencies.
10. Do not introduce a framework merely because it is popular.

---

# 68. Final Deliverables

At completion, provide:

```text
1. Architecture overview
2. Repository changes
3. Implemented node catalog
4. Node implementation status
5. Agent schema
6. Runtime architecture
7. Permission architecture
8. Voice architecture
9. Local model architecture
10. Scheduler architecture
11. Event architecture
12. Recovery architecture
13. Test results
14. Offline test results
15. Known limitations
16. How to run
17. How to create an agent
18. How to add a new node
19. How to configure local models
20. How to configure voice
21. Security considerations
```

Also provide:

```text
Feature                  Status       Tested
------------------------------------------------
Local chat               COMPLETE     YES
Local LLM                COMPLETE     YES
Agent planning           COMPLETE     YES
Agent execution          COMPLETE     YES
Filesystem nodes         COMPLETE     YES
Process nodes            COMPLETE     YES
System monitoring        COMPLETE     YES
Scheduler                COMPLETE     YES
Event bus                COMPLETE     YES
Computer control         COMPLETE     YES
Voice STT                COMPLETE     YES
Voice TTS                COMPLETE     YES
Permissions              COMPLETE     YES
Dry run                  COMPLETE     YES
Recovery                 COMPLETE     YES
Agent persistence        COMPLETE     YES
Agent versioning         COMPLETE     YES
Offline mode             COMPLETE     YES
```

Never mark anything COMPLETE unless it has actually been implemented and tested.

---

# 69. Operating Mode for the Coding Agent

Do not merely generate code snippets.

Take the existing Hybrid Local AI Hub repository toward a functioning autonomous local-agent platform.

Use:

```text
ANALYZE
 ↓
PLAN
 ↓
IMPLEMENT
 ↓
TEST
 ↓
RUN
 ↓
INSPECT
 ↓
FIX
 ↓
TEST AGAIN
 ↓
DOCUMENT
```

When an architectural problem is found, explain it and fix it instead of hiding it behind a workaround.

When an API or dependency is uncertain, verify it before using it.

When a feature cannot reliably be implemented, mark it unsupported rather than pretending it works.

The final standard is:

> **If the user can see a node in the UI, that node must correspond to real executable functionality in the runtime.**

And:

> **If the agent reports that an action succeeded, the runtime must have evidence that the action actually succeeded whenever verification is technically possible.**

The ultimate goal is a genuinely usable **local autonomous computer-agent platform**, not a workflow mockup.
