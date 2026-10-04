import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("NodeType::CallAgentNode")
if idx != -1:
    print(content[idx:idx+2500])
else:
    print("Not found CallAgentNode")