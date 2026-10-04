import sys

path = r"c:\Users\rajba\.gemini\antigravity-ide\brain\6fee192d-e343-4b34-83ab-030510b3cab0\offline_nodes_implementation_plan.md"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("### Phase 3: Execution Logic (Rust) [IN PROGRESS]", "### Phase 3: Execution Logic (Rust) [COMPLETED]")

with open(path, "w", encoding="utf-8") as f:
    f.write(content)