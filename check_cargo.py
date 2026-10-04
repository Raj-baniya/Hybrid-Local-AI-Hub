import sys

path = r"C:\Hybrid Local AI Hub\Cargo.toml"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

print(content)