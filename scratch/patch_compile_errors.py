import os

file_path = "e:/Hybrid Local AI Hub/src/executor.rs"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Move outputs initialization up
# Delete the old line
old_outputs_decl = "    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));\n"
content = content.replace(old_outputs_decl, "")

# Add it before the checkpoint loading
target_spot = """    let run_id = record.execution_id.clone();
    
    // Attempt crash recovery:"""
new_spot = """    let run_id = record.execution_id.clone();
    
    let outputs: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
    // Attempt crash recovery:"""
content = content.replace(target_spot, new_spot)

# 2. Remove `mut` from `effect` at line 670
target_effect = "            let mut effect = crate::schema::SideEffectRecord {"
new_effect = "            let effect = crate::schema::SideEffectRecord {"
content = content.replace(target_effect, new_effect)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)


state_store_path = "e:/Hybrid Local AI Hub/src/state_store.rs"
with open(state_store_path, "r", encoding="utf-8") as f:
    state_content = f.read()
    
# Remove unused imports
target_import = "use serde::{Deserialize, Serialize};\n"
state_content = state_content.replace(target_import, "")

with open(state_store_path, "w", encoding="utf-8") as f:
    f.write(state_content)

print("Patch applied successfully.")
