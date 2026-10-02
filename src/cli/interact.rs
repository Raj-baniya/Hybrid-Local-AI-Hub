use anyhow::{Context, Result};
use clap::Args;
use dialoguer::{theme::ColorfulTheme, Select};
use std::path::PathBuf;
use hybrid_local_ai_hub::schema::Graph;
use hybrid_local_ai_hub::executor::ExecutorConfig;
use console::{style, Term};


#[derive(Args, Debug)]
pub struct InteractArgs {
    /// Path to the agent automation workflow JSON file
    pub file: PathBuf,
}

// Very simple ASCII text generator for block letters
fn generate_ascii_art(text: &str) -> String {
    let mut lines = vec![String::new(); 5];
    for c in text.to_uppercase().chars() {
        let (l0, l1, l2, l3, l4) = match c {
            'A' => ("  A  ", " A A ", "AAAAA", "A   A", "A   A"),
            'B' => ("BBBB ", "B   B", "BBBB ", "B   B", "BBBB "),
            'C' => (" CCC ", "C    ", "C    ", "C    ", " CCC "),
            'D' => ("DDDD ", "D   D", "D   D", "D   D", "DDDD "),
            'E' => ("EEEEE", "E    ", "EEEE ", "E    ", "EEEEE"),
            'F' => ("EEEEE", "E    ", "EEEE ", "E    ", "E    "),
            'G' => (" GGG ", "G    ", "G  GG", "G   G", " GGG "),
            'H' => ("H   H", "H   H", "HHHHH", "H   H", "H   H"),
            'I' => (" III ", "  I  ", "  I  ", "  I  ", " III "),
            'J' => ("  JJJ", "   J ", "   J ", "J  J ", " JJ  "),
            'K' => ("K   K", "K  K ", "KK   ", "K  K ", "K   K"),
            'L' => ("L    ", "L    ", "L    ", "L    ", "LLLLL"),
            'M' => ("M   M", "MM MM", "M M M", "M   M", "M   M"),
            'N' => ("N   N", "NN  N", "N N N", "N  NN", "N   N"),
            'O' => (" OOO ", "O   O", "O   O", "O   O", " OOO "),
            'P' => ("PPPP ", "P   P", "PPPP ", "P    ", "P    "),
            'Q' => (" QQQ ", "Q   Q", "Q   Q", "Q  QQ", " QQQQ"),
            'R' => ("RRRR ", "R   R", "RRRR ", "R R  ", "R  RR"),
            'S' => (" SSS ", "S    ", " SSS ", "    S", "SSSS "),
            'T' => ("TTTTT", "  T  ", "  T  ", "  T  ", "  T  "),
            'U' => ("U   U", "U   U", "U   U", "U   U", " UUU "),
            'V' => ("V   V", "V   V", "V   V", " V V ", "  V  "),
            'W' => ("W   W", "W   W", "W W W", "WW WW", "W   W"),
            'X' => ("X   X", " X X ", "  X  ", " X X ", "X   X"),
            'Y' => ("Y   Y", " Y Y ", "  Y  ", "  Y  ", "  Y  "),
            'Z' => ("ZZZZZ", "   Z ", "  Z  ", " Z   ", "ZZZZZ"),
            ' ' => ("     ", "     ", "     ", "     ", "     "),
            _ => (" ??? ", " ??? ", " ??? ", " ??? ", " ??? "),
        };
        lines[0].push_str(l0); lines[0].push_str("  ");
        lines[1].push_str(l1); lines[1].push_str("  ");
        lines[2].push_str(l2); lines[2].push_str("  ");
        lines[3].push_str(l3); lines[3].push_str("  ");
        lines[4].push_str(l4); lines[4].push_str("  ");
    }
    lines.join("\n")
}

pub async fn interact(args: InteractArgs) -> Result<()> {
    let content = std::fs::read_to_string(&args.file)
        .with_context(|| format!("Failed to read graph file {:?}", args.file))?;
    
    let graph: Graph = serde_json::from_str(&content)
        .with_context(|| "Failed to parse JSON into a Graph")?;

    let agent_name = graph.name.clone().unwrap_or_else(|| "AUTOAGENT".to_string());
    
    // Clear screen
    let term = Term::stdout();
    term.clear_screen()?;

    println!("{}", style("================================================================================").color256(166)); // Orange box
    
    let ascii_art = generate_ascii_art(&agent_name);
    for line in ascii_art.lines() {
        println!("{}", style(line).bold().color256(208)); // Orange-ish
    }
    
    println!();
    println!("      {} {}", style("Create Agentic AI using").italic().color256(166), style("Language").italic().color256(166));
    println!("{}", style("================================================================================").color256(166));
    println!();
    
    println!("{} {}", style("Version").cyan(), "0.1.0");
    println!("{} {}", style("Author ").cyan(), "Hybrid Local AI Hub");
    println!("{} {}", style("License").cyan(), "MIT");
    println!("{}", style("--------------------------------------------------------------------------------").dim());
    
    println!();
    println!("                                Important Notes                                 ");
    println!("{}", style("--------------------------------------------------------------------------------").dim());
    println!(" * Choose {} if you want to run the automated workflow for this agent.", style("start automation").green());
    println!(" * Choose {} to ask the agent to reason about the tasks.", style("user query more(reasoning)").green());
    println!(" * Choose {} to exit the program.", style("exit").green());
    println!();

    let mut selections = vec![];
    let has_watcher = graph.nodes.iter().any(|n| matches!(n.data, hybrid_local_ai_hub::schema::NodeType::FileWatcherNode(_)));
    let has_schedule = graph.nodes.iter().any(|n| matches!(n.data, hybrid_local_ai_hub::schema::NodeType::ScheduleNode(_)));
    
    if has_watcher {
        selections.push(format!("start automation (Event driven - {} nodes)", graph.nodes.len()));
    } else if has_schedule {
        selections.push(format!("start automation (Scheduled Cron - {} nodes)", graph.nodes.len()));
    } else {
        selections.push(format!("start automation (Run Pipeline once - {} nodes)", graph.nodes.len()));
    }
    
    selections.push("user query more(reasoning)".to_string());
    selections.push("exit".to_string());

    loop {
        let selection = Select::with_theme(&ColorfulTheme::default())
            .with_prompt("[?] Please select the mode:")
            .default(0)
            .items(&selections[..])
            .interact()?;
        
        if selection == 0 {
            println!("\n{} Starting automation for {}...", style(">").green(), style(&agent_name).bold());
            
            let mut config = ExecutorConfig::default();
            config.is_offline = true; // Use default offline configs for now
            
            // Let's run the graph
            let result = hybrid_local_ai_hub::executor::run_graph(
                &graph,
                None,
                config,
                "cli-interactive",
                None,
                None,
                None,
                None,
            ).await;
            
            match result {
                Ok(record) => {
                    println!("\n Automation completed successfully!");
                    println!("Status: {:?}", record.overall_status);
                },
                Err(e) => {
                    println!("\n Automation failed: {}", e);
                }
            }
            println!();
        } else if selection == 1 {
            println!("\n{} Reasoning mode (coming soon in next iteration)...", style(">").yellow());
            println!("This will allow you to query the internal state of the agent.\n");
        } else if selection == 2 {
            println!("Exiting program. Goodbye!");
            break;
        }
    }

    Ok(())
}
