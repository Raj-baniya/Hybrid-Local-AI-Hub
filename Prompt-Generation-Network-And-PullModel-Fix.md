## Confirmed bug 1 — generation path has the same network issue as the pipeline node, unfixed

Chat-to-graph generation fails with:
```
LLM generation request failed: Ollama request failed: error sending request for url (http://127.0.0.1:11434/api/generate)
```
This is the same class of bug already fixed once in the pipeline executor's `OllamaSelectorNode` client (`reqwest::Client::new()` picking up a system proxy, and/or `localhost` DNS resolution issues on Windows). That fix was applied to only ONE `reqwest::Client` in the codebase. The chat-to-graph generation path uses a **separate, different client instance** that never got the same fix.

Do not guess which file — find every remaining instance first.

## Confirmed bug 2 — `pull_model` argument name mismatch

```
invalid args `modelName` for command `pull_model`: command pull_model missing required key modelName
```
Tauri requires the JS-side `invoke()` call's object keys to exactly match the Rust command's parameter names (converted to camelCase). The frontend is calling `pull_model` without sending the key the backend actually expects. This is a naming mismatch, not a logic bug — fix is to make both sides agree on the exact key name.

Follow the same protocol as all prior prompts: one step, one `RUN THIS:` command, then stop and wait for `go`/`continue`/`next`/`done` or a pasted error. No claiming a step is fixed without that confirmation.

---

## STEP 1 — Find every unfixed Ollama client/URL in the codebase

→ `RUN THIS:`
```powershell
Select-String -Path src-tauri\src\*.rs -Pattern "localhost:11434|reqwest::Client::new"
```
→ Human pastes the full output (every file/line it finds).

---

## STEP 2 — Fix every match found in Step 1 that isn't already fixed

For each match from Step 1 that is NOT already using `127.0.0.1` and `.no_proxy()`:
- Change `http://localhost:11434` → `http://127.0.0.1:11434`
- Change `reqwest::Client::new()` → `reqwest::Client::builder().no_proxy().build().unwrap()`

Apply this specifically to the chat-to-graph generation code path (likely `translator.rs` or wherever `cmd_generate_graph` / the system-prompt-to-Ollama call lives), even if other files were already fixed — do not skip a file assuming it's already handled without checking Step 1's actual output.

→ `RUN THIS:` build/run command.
→ Human tests: run chat-to-graph generation with a real instruction. Replies `go` if it succeeds, or pastes the exact new error if it still fails.

---

## STEP 3 — Find the exact parameter name mismatch for `pull_model`

→ `RUN THIS:`
```powershell
Select-String -Path src-tauri\src\commands.rs -Pattern "fn.*pull_model"
Select-String -Path src\components\*.tsx -Pattern "pull_model"
```
→ Human pastes both outputs — this shows the real Rust parameter name next to the real frontend `invoke()` call side by side.

---

## STEP 4 — Fix the mismatch found in Step 3

Whichever side is wrong, make the frontend's `invoke()` call object key match the Rust command's parameter name exactly (Rust `snake_case` → JS `camelCase`). Example: if Rust has `model_name: String`, the frontend call must be:
```tsx
invoke("pull_model", { modelName: selectedModelName })
```
Do not rename the Rust parameter to match a wrong frontend call — fix whichever side deviates from the pair, keeping names consistent everywhere `pull_model` is called across the app (check for more than one call site).

→ `RUN THIS:` build/run command.
→ Human tests: click "Download recommended model" (or equivalent pull button) and confirms a real pull starts with progress, no argument error. Replies `go` or pastes the new error.

---

## Rules

1. One step, one `RUN THIS:` command, then wait.
2. Fix Bug 1 (Steps 1–2) completely before starting Bug 2 (Steps 3–4) — don't interleave them.
3. No claiming fixed without the human's `go`/`continue`/`next`/`done`.
4. If Step 1's search finds zero remaining unfixed matches, say so plainly and report the generation error must have a different cause — do not force an unnecessary edit just to have something to change; move to diagnostics instead (add a debug print of the actual error type/source at the failure point).

## Done condition

```
Step 1: [FOUND N matches] — <list>
Step 2: [VERIFIED / STILL BROKEN] — generation succeeds with a real instruction
Step 3: [FOUND mismatch: Rust expects X, frontend sends Y]
Step 4: [VERIFIED / STILL BROKEN] — model pull starts with no argument error
```
