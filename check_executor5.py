import sys

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

idx = content.find("        // Ã¢â€ â‚¬Ã¢â€ â‚¬ End of match")
if idx == -1:
    idx = content.find("        _ => ")
    
if idx != -1:
    print(content[idx-1000:idx+500])
else:
    print("Not found end of match")