import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("fn execute_node")
if idx != -1:
    idx2 = content.find("NodeType::NativeWindowControlNode", idx)
    if idx2 != -1:
        print(content[idx2-500:idx2+2500])
    else:
        print("Not found NativeWindowControlNode")
else:
    print("Not found execute_node")