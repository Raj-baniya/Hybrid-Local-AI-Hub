import sys
import re

path = r"C:\Hybrid Local AI Hub\src\executor.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

target = r"""        NodeType::ScreenCaptureNode\(cfg\) => \{
            if suppress_actions \{ return Ok\("\[DRY-RUN\] ScreenCaptureNode action suppressed"\.to_string\(\)\); \}
            let locked = outputs\.lock\(\)\.await;
            let single = single_input_value\(&predecessors, &locked\);
            let path = interpolation::resolve\(&cfg\.output_path, &locked, single\.as_deref\(\)\)\?;
            drop\(locked\);
            // Example stub for xcap
            Ok\(format!\("Screen captured to \{\}", path\)\)
        \}
        NodeType::MouseKeyboardSimNode\(cfg\) => \{
            if suppress_actions \{ return Ok\(format!\("\[DRY-RUN\] MouseKeyboardSimNode \{\} suppressed", cfg\.action_type\)\); \}
            // Example stub for enigo
            Ok\(format!\("Simulated action: \{\}", cfg\.action_type\)\)
        \}
        NodeType::LocalOCRNode\(cfg\) => \{
            let locked = outputs\.lock\(\)\.await;
            let single = single_input_value\(&predecessors, &locked\);
            let path = interpolation::resolve\(&cfg\.image_path, &locked, single\.as_deref\(\)\)\?;
            drop\(locked\);
            // Example stub for rusty-tesseract
            Ok\(format!\("Extracted text from \{\}", path\)\)
        \}
        NodeType::DuckDbQueryNode\(cfg\) => \{
            let locked = outputs\.lock\(\)\.await;
            let single = single_input_value\(&predecessors, &locked\);
            let q = interpolation::resolve\(&cfg\.query, &locked, single\.as_deref\(\)\)\?;
            drop\(locked\);
            // Example stub for duckdb
            Ok\(format!\("Executed DuckDB query: \{\}", q\)\)
        \}
        NodeType::WasmSandboxNode\(cfg\) => \{
            let locked = outputs\.lock\(\)\.await;
            let single = single_input_value\(&predecessors, &locked\);
            let path = interpolation::resolve\(&cfg\.wasm_module_path, &locked, single\.as_deref\(\)\)\?;
            drop\(locked\);
            // Example stub for wasmtime
            Ok\(format!\("Executed WASM module at \{\}", path\)\)
        \}"""

replacement = """        NodeType::ScreenCaptureNode(cfg) => {
            if suppress_actions { return Ok("[DRY-RUN] ScreenCaptureNode action suppressed".to_string()); }
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let path = interpolation::resolve(&cfg.output_path, &locked, single.as_deref())?;
            let window_title = cfg.specific_window_title.as_ref().map(|t| interpolation::resolve(t, &locked, single.as_deref()).unwrap_or_default());
            drop(locked);
            
            if let Some(title) = window_title {
                let windows = xcap::Window::all().map_err(|e| anyhow::anyhow!("Failed to list windows: {}", e))?;
                let window = windows.into_iter().find(|w| w.title() == title || w.title().contains(&title))
                    .ok_or_else(|| anyhow::anyhow!("No window found with title containing '{}'", title))?;
                let image = window.capture_image().map_err(|e| anyhow::anyhow!("Failed to capture window: {}", e))?;
                image.save(&path).map_err(|e| anyhow::anyhow!("Failed to save image to {}: {}", path, e))?;
            } else {
                let monitors = xcap::Monitor::all().map_err(|e| anyhow::anyhow!("Failed to list monitors: {}", e))?;
                let monitor = monitors.into_iter().find(|m| m.is_primary()).or_else(|| monitors.first().cloned()).ok_or_else(|| anyhow::anyhow!("No active monitors found"))?;
                let image = monitor.capture_image().map_err(|e| anyhow::anyhow!("Failed to capture screen: {}", e))?;
                image.save(&path).map_err(|e| anyhow::anyhow!("Failed to save image to {}: {}", path, e))?;
            }
            Ok(path)
        }
        NodeType::MouseKeyboardSimNode(cfg) => {
            use enigo::{Mouse, Keyboard, Settings, Coordinate, Direction};
            if suppress_actions { return Ok(format!("[DRY-RUN] MouseKeyboardSimNode {} suppressed", cfg.action_type)); }
            let mut enigo = enigo::Enigo::new(&Settings::default()).map_err(|e| anyhow::anyhow!("Enigo error: {:?}", e))?;
            
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let action = interpolation::resolve(&cfg.action_type, &locked, single.as_deref())?;
            let payload = cfg.payload.as_ref().map(|p| interpolation::resolve(p, &locked, single.as_deref()).unwrap_or_default());
            drop(locked);
            
            match action.as_str() {
                "click" => {
                    if let (Some(x), Some(y)) = (cfg.x, cfg.y) {
                        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| anyhow::anyhow!("{:?}", e))?;
                    }
                    enigo.button(enigo::MouseButton::Left, Direction::Click).map_err(|e| anyhow::anyhow!("{:?}", e))?;
                }
                "type" => {
                    if let Some(text) = payload {
                        enigo.text(&text).map_err(|e| anyhow::anyhow!("{:?}", e))?;
                    }
                }
                "move" => {
                    if let (Some(x), Some(y)) = (cfg.x, cfg.y) {
                        enigo.move_mouse(x, y, Coordinate::Abs).map_err(|e| anyhow::anyhow!("{:?}", e))?;
                    }
                }
                _ => return Err(anyhow::anyhow!("Unknown mouse/keyboard action: {}", action))
            }
            Ok(format!("Simulated action: {}", action))
        }
        NodeType::LocalOCRNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let path = interpolation::resolve(&cfg.image_path, &locked, single.as_deref())?;
            drop(locked);
            
            let img = rusty_tesseract::Image::from_path(&path).map_err(|e| anyhow::anyhow!("Failed to load image for OCR: {}", e))?;
            let args = rusty_tesseract::Args::default();
            let text = rusty_tesseract::image_to_string(&img, &args).map_err(|e| anyhow::anyhow!("OCR failed: {}", e))?;
            Ok(text.trim().to_string())
        }
        NodeType::DuckDbQueryNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let q = interpolation::resolve(&cfg.query, &locked, single.as_deref())?;
            let db_path = cfg.db_path.as_ref().map(|p| interpolation::resolve(p, &locked, single.as_deref()).unwrap_or_default());
            drop(locked);
            
            let conn = if let Some(path) = db_path {
                duckdb::Connection::open(&path).map_err(|e| anyhow::anyhow!("DuckDB open error: {}", e))?
            } else {
                duckdb::Connection::open_in_memory().map_err(|e| anyhow::anyhow!("DuckDB memory error: {}", e))?
            };
            
            let wrapped_query = format!("SELECT CAST(row_to_json(tbl) AS VARCHAR) FROM ({}) AS tbl", q);
            let mut stmt = conn.prepare(&wrapped_query).map_err(|e| anyhow::anyhow!("Query prepare error: {}", e))?;
            let mut rows = stmt.query([]).map_err(|e| anyhow::anyhow!("Query execute error: {}", e))?;
            
            let mut results = vec![];
            while let Some(row) = rows.next().map_err(|e| anyhow::anyhow!("Row fetch error: {}", e))? {
                let json_str: String = row.get(0).unwrap_or_default();
                results.push(json_str);
            }
            Ok(format!("[{}]", results.join(",")))
        }
        NodeType::WasmSandboxNode(cfg) => {
            let locked = outputs.lock().await;
            let single = single_input_value(&predecessors, &locked);
            let path = interpolation::resolve(&cfg.wasm_module_path, &locked, single.as_deref())?;
            drop(locked);
            
            let engine = wasmtime::Engine::default();
            let module = wasmtime::Module::from_file(&engine, &path).map_err(|e| anyhow::anyhow!("Failed to load WASM module: {}", e))?;
            let mut store = wasmtime::Store::new(&engine, ());
            let instance = wasmtime::Instance::new(&mut store, &module, &[]).map_err(|e| anyhow::anyhow!("Failed to instantiate WASM: {}", e))?;
            
            let run = instance.get_typed_func::<(), ()>(&mut store, "run")
                .or_else(|_| instance.get_typed_func::<(), ()>(&mut store, "_start"))
                .map_err(|e| anyhow::anyhow!("Could not find exported 'run' or '_start' function: {}", e))?;
            
            run.call(&mut store, ()).map_err(|e| anyhow::anyhow!("Failed to execute WASM: {}", e))?;
            Ok(format!("Executed WASM module at {}", path))
        }"""

if re.search(target, content):
    content = re.sub(target, replacement, content)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Patched executor.rs successfully!")
else:
    print("Could not find target block in executor.rs")