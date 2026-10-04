import sys
import re

path = r"C:\Hybrid Local AI Hub\src\schema.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

structs = ["ScreenCaptureConfig", "MouseKeyboardSimConfig", "LocalOCRConfig", "DuckDbQueryConfig", "WasmSandboxConfig"]

for struct in structs:
    match = re.search(f"pub struct {struct} {{[^}}]+}}", content)
    if match:
        print(match.group(0))
        print("\n")