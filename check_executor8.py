import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("if sub_record.overall_status !=")
if idx != -1:
    print(content[idx:idx+1500])
else:
    print("Not found end of CallAgentNode")