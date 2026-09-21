import sys

with open('src-tauri/src/commands.rs', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove duplicate imports
content = content.replace('use std::collections::HashMap;\nuse std::sync::{Arc, Mutex};\nuse tauri::{AppHandle, Emitter, Manager, State};\n', '')
content = content.replace('use std::collections::HashMap;\r\nuse std::sync::{Arc, Mutex};\r\nuse tauri::{AppHandle, Emitter, Manager, State};\r\n', '')

# 1a. Fix line 11
content = content.replace('use tauri::{Emitter, Manager};', 'use tauri::{AppHandle, Emitter, Manager, State};')

# 2. Add ScheduledTaskState
content = content.replace('pub struct ChatState {\n    pub active_tasks:\n        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,\n}', 
'''pub struct ChatState {
    pub active_tasks:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Default)]
pub struct ScheduledTaskState {
    pub active_tasks:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}''')
content = content.replace('pub struct ChatState {\r\n    pub active_tasks:\r\n        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,\r\n}', 
'''pub struct ChatState {
    pub active_tasks:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Default)]
pub struct ScheduledTaskState {
    pub active_tasks:
        tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<()>>>,
}''')


# 3. Fix lock calls (they return futures and need .await)
content = content.replace('.lock().map_err(|e| format!("Lock error: {}", e))?;', '.lock().await;')

content = content.replace('let mut tasks = state.active_tasks.lock().ok();\n        if let Some(mut tasks) = tasks {\n            tasks.remove(&task_id);\n        }', 'let mut tasks = state.active_tasks.lock().await;\n        tasks.remove(&task_id);')
content = content.replace('let mut tasks = state.active_tasks.lock().ok();\r\n        if let Some(mut tasks) = tasks {\r\n            tasks.remove(&task_id);\r\n        }', 'let mut tasks = state.active_tasks.lock().await;\r\n        tasks.remove(&task_id);')

# 4. Fix list_scheduled_tasks signature
content = content.replace('pub fn list_scheduled_tasks(', 'pub async fn list_scheduled_tasks(')

with open('src-tauri/src/commands.rs', 'w', encoding='utf-8') as f:
    f.write(content)
