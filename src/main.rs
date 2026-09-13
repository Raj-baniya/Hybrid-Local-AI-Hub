use clap::{Parser, Subcommand};

mod cli;

const AFTER_HELP: &str = "\
GETTING STARTED:
  hybrid-hub init                              # 1. check / install Ollama + models
  hybrid-hub chat \"<your automation idea>\"    # 2. generate a workflow
  hybrid-hub validate workflow.json            # 3. verify it
  hybrid-hub run workflow.json                 # 4. run it
  hybrid-hub logs <execution-id>               # 5. inspect results

  hybrid-hub examples                          # real example chat instructions
  hybrid-hub template list                     # starter templates
";

#[derive(Parser, Debug)]
#[command(
    name = "hybrid-hub",
    version,
    about = "Hybrid Local AI Hub — local-first AI workflow orchestrator",
    long_about = "Generate, run, and manage AI workflows entirely on your local machine.\n\
                  No cloud required. Powered by Ollama + ChromaDB.",
    after_help = AFTER_HELP,
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Set up Ollama, pull recommended models, check ChromaDB.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub init
  hybrid-hub init --yes
  hybrid-hub init --ollama-url http://localhost:11434
")]
    Init(cli::init::InitArgs),

    /// Generate or edit a workflow from a natural-language description.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub chat \"Watch my inbox for PDFs and summarize them\"
  hybrid-hub chat \"Watch my inbox for PDFs and summarize them\" -o my_workflow.json
  hybrid-hub chat \"Add a ChromaDB step\" --edit my_workflow.json -o my_workflow.json
")]
    Chat(cli::chat::ChatArgs),

    /// Validate a workflow JSON file.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub validate workflow.json
  hybrid-hub validate workflow.json --json
")]
    Validate(cli::validate::ValidateArgs),

    /// Run a workflow (once, or continuously with --watch).
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub run workflow.json
  hybrid-hub run workflow.json --watch
  hybrid-hub run workflow.json --json
  hybrid-hub run workflow.json --continue-on-failure
")]
    Run(cli::run::RunArgs),

    /// List or pull Ollama models.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub models list
  hybrid-hub models pull llama3.2
  hybrid-hub models pull nomic-embed-text
")]
    Models(cli::models::ModelsArgs),

    /// Show logs for a past execution.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub logs <execution-id>
  hybrid-hub logs <execution-id> --json
")]
    Logs(cli::logs::LogsArgs),

    /// Export a workflow as a portable bundle (.zip).
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub export workflow.json -o bundle.zip
")]
    Export(cli::export::ExportArgs),

    /// Import a workflow bundle (.zip) onto this machine.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub import bundle.zip
  hybrid-hub import bundle.zip -o workflow.json
  hybrid-hub import bundle.zip --yes
")]
    Import(cli::export::ImportArgs),

    /// List or copy starter workflow templates.
    #[command(after_help = "\
EXAMPLES:
  hybrid-hub template list
  hybrid-hub template use gym-intake -o gym.json
  hybrid-hub template use summarizer -o summarizer.json
")]
    Template(cli::template::TemplateArgs),

    /// Show real example instructions for 'hybrid-hub chat'.
    Examples,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    let result: anyhow::Result<()> = match cli.command {
        None => {
            print_getting_started();
            return;
        }
        Some(Commands::Init(args)) => cli::init::init(args).await,
        Some(Commands::Chat(args)) => cli::chat::chat(args).await,
        Some(Commands::Validate(args)) => cli::validate::validate(args),
        Some(Commands::Run(args)) => cli::run::run(args).await,
        Some(Commands::Models(args)) => cli::models::models(args).await,
        Some(Commands::Logs(args)) => cli::logs::logs(args).await,
        Some(Commands::Export(args)) => cli::export::export(args).await,
        Some(Commands::Import(args)) => cli::export::import(args).await,
        Some(Commands::Template(args)) => cli::template::template(args),
        Some(Commands::Examples) => {
            print_examples();
            return;
        }
    };

    if let Err(e) = result {
        eprintln!("Error: {e:#}");
        std::process::exit(1);
    }
}

fn print_getting_started() {
    println!();
    println!("  Hybrid Local AI Hub — local-first AI workflow orchestrator");
    println!("  Generate and run AI workflows on your machine. No cloud required.");
    println!();
    println!("  ── Quick Start ────────────────────────────────────────────────");
    println!();
    println!("  1. hybrid-hub init");
    println!("     Check / install Ollama and pull recommended models.");
    println!();
    println!("  2. hybrid-hub chat \"<describe your automation>\" -o workflow.json");
    println!("     Generate a workflow from plain English.");
    println!();
    println!("  3. hybrid-hub validate workflow.json");
    println!("     Verify the generated workflow before running.");
    println!();
    println!("  4. hybrid-hub run workflow.json");
    println!("     Run it once. Add --watch to keep it running on file events.");
    println!();
    println!("  5. hybrid-hub logs <execution-id>");
    println!("     Inspect per-node results from a past run.");
    println!();
    println!("  ── More ────────────────────────────────────────────────────────");
    println!();
    println!("  hybrid-hub examples            real example instructions for chat");
    println!("  hybrid-hub template list       starter templates to copy and run");
    println!("  hybrid-hub models list         Ollama models installed");
    println!("  hybrid-hub export <f> -o <z>   share a workflow as a portable bundle");
    println!("  hybrid-hub import <z>          import a bundle on this machine");
    println!();
    println!("  Run 'hybrid-hub <command> --help' for details.");
    println!();
}

fn print_examples() {
    println!();
    println!("  ── Example Instructions for 'hybrid-hub chat' ──────────────────");
    println!();

    let examples: &[(&str, &str, &str)] = &[
        (
            "Gym intake processor",
            "Watch my ./gym_intake folder for new PDF intake forms. Extract the text, \
             generate a personalised workout plan, route by goal type \
             (weight loss vs muscle gain), embed the profile in ChromaDB, \
             and write the plan to ./output/",
            "--watch",
        ),
        (
            "Document summariser",
            "Watch ./inbox for .txt files. Summarise each with an LLM \
             and save the summary to ./summaries/summary.txt",
            "--watch",
        ),
        (
            "Customer support ticket router",
            "Take a customer support ticket as text input. Classify it as \
             billing or general using an LLM. Route billing tickets to \
             ./queues/billing.txt and general ones to ./queues/general.txt",
            "",
        ),
        (
            "Research digest generator",
            "Accept a research question as text input. Ask an LLM to produce \
             a structured digest with: background context, 5 key findings, \
             and 3 open questions. Save to ./research/digest.md",
            "",
        ),
        (
            "PDF knowledge base indexer",
            "Watch ./docs for new PDFs. Extract text, embed with nomic-embed-text, \
             and store in ChromaDB collection 'knowledge_base'",
            "--watch",
        ),
        (
            "Invoice data extractor",
            "Watch ./invoices for new PDF invoices. Extract text then use an LLM \
             to extract vendor, amount, date, and invoice number as JSON. \
             Append each result to ./extracted/invoices.jsonl",
            "--watch",
        ),
        (
            "Recipe suggestion pipeline",
            "Take a list of ingredients as text input. Ask an LLM to suggest \
             3 recipes using those ingredients with brief instructions. \
             Write the suggestions to ./suggestions/recipes.txt",
            "",
        ),
        (
            "Meeting notes processor",
            "Watch ./meetings for new .txt meeting notes. Summarise each \
             (key decisions, action items, owners). Route notes containing \
             'urgent' to ./urgent/ and others to ./archive/. \
             Embed all notes in ChromaDB for later search.",
            "--watch",
        ),
    ];

    for (i, (title, instruction, flag)) in examples.iter().enumerate() {
        println!("  {}. {}", i + 1, title);
        let slug = title.to_lowercase().replace(' ', "_");
        println!("     hybrid-hub chat \"{}\" -o {}.json", instruction, slug);
        if flag.is_empty() {
            println!("     hybrid-hub run {}.json", slug);
        } else {
            println!("     hybrid-hub run {}.json {}", slug, flag);
        }
        println!();
    }

    println!("  ── Tips ────────────────────────────────────────────────────────");
    println!();
    println!("  • Use --model phi4-mini for faster generation");
    println!("  • Use --model qwen3:4b for better reasoning on complex instructions");
    println!("  • Use --edit <file> to refine an existing workflow iteratively");
    println!();
}
