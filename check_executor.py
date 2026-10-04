import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("fn node_type_name")
if idx != -1:
    print(content[idx:idx+1000])
else:
    print("Not found node_type_name")
    
idx2 = content.find("pub async fn execute_node")
if idx2 != -1:
    print("\n\n" + content[idx2:idx2+1500])
else:
    print("Not found execute_node")