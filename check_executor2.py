import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("fn run_node")
if idx == -1:
    idx = content.find("fn execute")
    
if idx != -1:
    print(content[idx:idx+1500])
else:
    print("Not found run_node")