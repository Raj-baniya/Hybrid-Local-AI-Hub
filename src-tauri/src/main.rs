#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use hybrid_local_ai_hub::schema::Graph;
use hybrid_local_ai_hub::executor::{run_graph, ExecutorConfig};
use sysinfo::{System, Pid};
use tokio::sync::mpsc;

fn speak(text: &str) {
    let command = format!("Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{}')", text.replace("'", "''"));
    Command::new("powershell")
        .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &command])
        .spawn()
        .ok();
}

#[tokio::main]
async fn run_headless(agent_path: &str) {
    let path = PathBuf::from(agent_path);
    let agent_name = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let lock_path = path.with_extension("lock");
    
    // Toggle Logic
    if lock_path.exists() {
        if let Ok(pid_str) = fs::read_to_string(&lock_path) {
            if let Ok(pid_num) = pid_str.trim().parse::<usize>() {
                let mut sys = System::new_all();
                sys.refresh_all();
                if let Some(process) = sys.process(Pid::from(pid_num)) {
                    process.kill();
                    let _ = fs::remove_file(&lock_path);
                    speak(&format!("Stopped agent {}", agent_name));
                    return;
                }
            }
        }
        let _ = fs::remove_file(&lock_path); // Stale lock
    }
    
    // Write lock
    let my_pid = std::process::id();
    let _ = fs::write(&lock_path, my_pid.to_string());
    
    speak(&format!("Starting agent {}", agent_name));
    
    // Load graph
    let graph_json = match fs::read_to_string(&path) {
        Ok(j) => j,
        Err(_) => {
            let _ = fs::remove_file(&lock_path);
            return;
        }
    };
    
    let graph: Graph = match serde_json::from_str(&graph_json) {
        Ok(g) => g,
        Err(_) => {
            let _ = fs::remove_file(&lock_path);
            return;
        }
    };
    
    let config = ExecutorConfig::default();
    
    let (tx, mut rx) = mpsc::unbounded_channel();
    
    let run_task = tokio::spawn(async move {
        let _ = run_graph(
            &graph,
            None,
            config,
            "headless-trigger",
            Some(tx),
            None,
            None,
            None
        ).await;
    });
    
    // Listen for node completions
    while let Some(node_record) = rx.recv().await {
        if node_record.status == hybrid_local_ai_hub::execution_record::NodeStatus::Success {
            speak(&format!("Node {} completed.", node_record.node_type));
        } else if node_record.status == hybrid_local_ai_hub::execution_record::NodeStatus::Failed {
            speak(&format!("Node {} failed.", node_record.node_type));
        }
    }
    
    let _ = run_task.await;
    let _ = fs::remove_file(&lock_path);
    speak(&format!("Agent {} finished.", agent_name));
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() >= 3 && args[1] == "run" {
        run_headless(&args[2]);
    } else {
        hybrid_local_ai_hub_gui_lib::run();
    }
}
