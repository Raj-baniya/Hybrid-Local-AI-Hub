use dialoguer::{theme::ColorfulTheme, Select};
use crossterm::{
    execute,
    style::{Color, ResetColor, SetForegroundColor},
};
use std::io::{stdout, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use sysinfo::System;
use tokio::time::Duration;

const ASCII_ART: &str = r#"
      ###    ##     ## ######## #######     ###     ######  ######## ##    ## 
     ## ##   ##     ##    ##   ##     ##   ## ##   ##    ## ##       ###   ## 
    ##   ##  ##     ##    ##   ##     ##  ##   ##  ##       ##       ####  ## 
   ##     ## ##     ##    ##   ##     ## ##     ## ##   ### ######   ## ## ## 
   ######### ##     ##    ##   ##     ## ######### ##    ## ##       ##  #### 
   ##     ## ##     ##    ##   ##     ## ##     ## ##    ## ##       ##   ### 
   ##     ##  #######     ##    #######  ##     ##  ######  ######## ##    ## 
"#;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    print_banner()?;

    let selections = &[
        "user mode",
        "agent editor",
        "workflow editor",
        "exit",
    ];

    loop {
        let selection = Select::with_theme(&ColorfulTheme::default())
            .with_prompt("Please select the mode:")
            .default(0)
            .items(&selections[..])
            .interact()?;

        match selection {
            0 => run_user_mode().await?,
            1 => println!("\n[Agent Editor] Coming soon..."),
            2 => println!("\n[Workflow Editor] Coming soon..."),
            3 => {
                println!("Exiting...");
                break;
            }
            _ => unreachable!(),
        }
    }

    Ok(())
}

fn print_banner() -> anyhow::Result<()> {
    let mut out = stdout();
    execute!(out, SetForegroundColor(Color::Rgb { r: 255, g: 140, b: 100 }))?;
    println!("+-----------------------------------------------------------------------------+");
    for line in ASCII_ART.lines() {
        if !line.is_empty() {
            println!("|{:<77}|", line);
        }
    }
    println!("|                      Create Agentic AI using Language                       |");
    println!("+-----------------------------------------------------------------------------+");
    
    execute!(out, SetForegroundColor(Color::DarkGreen))?;
    println!("+-----------------------------------------------------------------------------+");
    println!("| Version     | 0.2.0                                                         |");
    println!("| Author      | AutoAgent Team @ Hybrid Hub                                   |");
    println!("| License     | MIT                                                           |");
    println!("+-----------------------------------------------------------------------------+");

    execute!(out, SetForegroundColor(Color::Cyan))?;
    println!("+------------------------------- Important Notes -----------------------------+");
    println!("|                                                                             |");
    println!("|  * Choose user mode if you just want a general AI Assistant to help you     |");
    println!("|  * Choose agent editor to create your own AI Agent with language.           |");
    println!("|  * Choose workflow editor to create your own AI Workflow with language.     |");
    println!("|  * Choose exit to exit the program                                          |");
    println!("|                                                                             |");
    println!("+-----------------------------------------------------------------------------+\n");
    
    execute!(out, ResetColor)?;
    Ok(())
}

async fn run_user_mode() -> anyhow::Result<()> {
    println!("\n--- Entering User Mode ---");
    println!("(Type 'exit' to return to menu)");
    
    let cancel_token = Arc::new(AtomicBool::new(false));
    let token_clone = cancel_token.clone();
    
    let monitor_handle = tokio::spawn(async move {
        let mut sys = System::new_all();
        loop {
            tokio::select! {
                _ = std::future::ready(()), if token_clone.load(Ordering::Relaxed) => {
                    break;
                }
                _ = tokio::time::sleep(Duration::from_secs(1)) => {
                    sys.refresh_cpu();
                    sys.refresh_memory();
                    sys.refresh_processes();
                    
                    let mut cpu_usage = 0.0;
                    for cpu in sys.cpus() {
                        cpu_usage += cpu.cpu_usage();
                    }
                    if sys.cpus().len() > 0 {
                        cpu_usage /= sys.cpus().len() as f32;
                    }
                    
                    if cpu_usage > 70.0 {
                        let mut out = stdout();
                        let _ = execute!(out, SetForegroundColor(Color::Red));
                        println!("\n\n[SYSTEM ALERT] CPU Usage is high: {:.1}%", cpu_usage);
                        let _ = execute!(out, ResetColor);
                        
                        let mut top_proc = None;
                        let mut top_usage = 0.0;
                        for (pid, process) in sys.processes() {
                            let u = process.cpu_usage();
                            if u > top_usage {
                                top_usage = u;
                                top_proc = Some((pid, process.name().to_string()));
                            }
                        }
                        
                        if let Some((pid, name)) = top_proc {
                            println!("[SYSTEM SUGGESTION] Process '{}' (PID: {}) is using {:.1}% CPU.", name, pid, top_usage);
                            println!("Suggestion: Kill this process if it's not being accessed to optimize performance.");
                            println!("To do this automatically, just ask: 'kill process {}'", name);
                        }
                        
                        print!("\n> ");
                        let _ = std::io::stdout().flush();
                        
                        tokio::select! {
                            _ = std::future::ready(()), if token_clone.load(Ordering::Relaxed) => { break; }
                            _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                        }
                    }
                }
            }
        }
    });

    let stdin = std::io::stdin();

    loop {
        print!("> ");
        std::io::stdout().flush()?;
        
        let mut input = String::new();
        if stdin.read_line(&mut input).is_err() {
            cancel_token.store(true, Ordering::Relaxed);
            break;
        }
        let input = input.trim();
        
        if input.eq_ignore_ascii_case("exit") || input.eq_ignore_ascii_case("quit") {
            cancel_token.store(true, Ordering::Relaxed);
            break;
        }
        
        if input.is_empty() {
            continue;
        }
        
        if let Err(e) = handle_user_intent(input).await {
            println!("[Agent] Error: {}", e);
        }
    }
    
    let _ = monitor_handle.await;
    Ok(())
}

async fn handle_user_intent(input: &str) -> anyhow::Result<()> {
    let lower = input.to_lowercase();
    
    if lower.starts_with("kill process") {
        println!("[Agent] I would run: taskkill /F /IM <pid> here, but for safety I will just simulate it.");
        println!("[Agent] Simulated killing the requested process. Performance optimized.");
    } 
    else if lower.starts_with("open ") || lower.starts_with("start ") {
        let app_name = lower.replace("open ", "").replace("start ", "").trim().to_string();
        
        let allowed = ["notepad", "calc", "cmd", "explorer"];
        if !allowed.contains(&app_name.as_str()) {
            println!("[Agent] Cannot open '{}': not in allowed list.", app_name);
            return Ok(());
        }

        println!("[Agent] Opening {}...", app_name);
        
        let status = std::process::Command::new("explorer.exe")
            .arg(&app_name)
            .status();
            
        match status {
            Ok(s) if s.success() => println!("[Agent] {} opened successfully.", app_name),
            _ => println!("[Agent] Could not directly open '{}'. Please make sure the app name is correct.", app_name),
        }
    }
    else if lower.starts_with("close ") {
        let app_name = lower.replace("close ", "").trim().to_string();
        println!("[Agent] Are you sure you want to close '{}'? (y/n)", app_name);
        let mut confirm = String::new();
        std::io::stdin().read_line(&mut confirm)?;
        if !confirm.trim().eq_ignore_ascii_case("y") {
            println!("[Agent] Aborted.");
            return Ok(());
        }

        let exe_name = if app_name.ends_with(".exe") { app_name.clone() } else { format!("{}.exe", app_name) };
        let lower_exe = exe_name.to_lowercase();
        
        let protected_apps = ["hybrid-hub.exe", "hybrid_local_ai_hub.exe", "node.exe", "tauri.exe", "autoagent.exe", "cargo.exe", "npm.cmd", "code.exe", "explorer.exe", "svchost.exe", "csrss.exe"];
        if protected_apps.contains(&lower_exe.as_str()) {
            println!("[Agent] [SECURITY WARNING] Cannot kill protected system or app process: {}", exe_name);
            return Ok(());
        }
        let status = std::process::Command::new("taskkill")
            .args(["/F", "/IM", &exe_name])
            .status();
            
        match status {
            Ok(s) if s.success() => println!("[Agent] {} closed successfully.", app_name),
            _ => println!("[Agent] Failed to close '{}'.", app_name),
        }
    }
    else if lower.contains("whatsapp") && (lower.contains("send") || lower.contains("message")) {
        println!("[Agent] Opening WhatsApp to send a message...");
        let _ = std::process::Command::new("explorer.exe")
            .arg("whatsapp://send?text=Hello%20from%20AutoAgent")
            .status();
        println!("[Agent] Please complete the send action in the WhatsApp window.");
    }
    else {
        println!("[Agent] (Simulated LLM response) I received your query: '{}'. How else can I help?", input);
    }
    
    Ok(())
}
