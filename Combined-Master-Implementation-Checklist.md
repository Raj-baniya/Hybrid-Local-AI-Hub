## Read this whole section before Step 1 — how this document works and why

This is a checklist for building and fixing a real desktop application called Hybrid Local AI Hub. It is a local-first AI automation tool: users describe a workflow in plain English or build one visually on a node canvas, and the app runs that workflow using a local AI model (Ollama) so nothing leaves their computer. The app is built with Rust (the backend/logic layer) and React + TypeScript (the visual interface), wrapped together by a framework called Tauri that lets a Rust program show a web-based UI as a native desktop app.

Nothing described below has actually been built and confirmed working yet, except where a step explicitly says otherwise (see Rule 9). Every step is a separate, small unit of work. The reason this document is broken into so many small steps instead of a few big ones is simple: large changes are hard to debug when something breaks, because there are many possible causes mixed together. Small changes are easy to debug, because if something breaks right after one small step, that step is almost certainly the cause.

**The exact loop to follow, for every single step in this document, with no exceptions:**
1. Read the step. Understand what it's asking for and why (each step explains its own reasoning).
2. Make only the change that step describes. Do not also make changes described in a later step, even if it seems convenient to do them together.
3. Output exactly one command for the human to run, under the heading `RUN THIS:`. Output nothing else after that command — no extra explanation, no "let me know how it goes," nothing. The command should be the next literal thing the human types into their terminal.
4. Stop. Do not continue working. Do not start the next step. Wait for the human's next message.
5. The human will run that command on their own computer (you cannot run commands yourself — you have no way to execute anything on their machine) and will reply with one of two things:
   - A short word like `go`, `continue`, `next`, or `done` — this means the command succeeded and you should now move to the next step.
   - The actual error text or unexpected output they saw — this means something went wrong. Do not guess wildly. Read the error carefully, figure out specifically what it means, make a targeted fix for that specific problem, and output one new `RUN THIS:` command. Then stop and wait again. This can repeat several times for the same step — that is normal and expected, not a failure on your part.
6. You may only say a step is "done" or "fixed" after the human has told you so with one of the confirmation words above. If you have not received that word, the step is still in progress, no matter how confident you feel that your code change is correct. Code that "looks right" and code that "actually works when run" are different things, and only the human running it on the real machine can tell you which one you have.

**Extra rules that apply throughout the whole document:**

- Never write placeholder code. This means: no `// TODO, fill this in later` comments in code that's supposed to be working right now. No functions that pretend to succeed without actually doing the real work. No hardcoded example output disguised as a real result. If you cannot complete something for a real reason, say so plainly instead of faking it.
- You do not have the ability to run terminal commands, install software, or execute code directly. This is not a preference — it is a hard limit of how you're being used in this project right now. Every single action that touches the real computer must go through the `RUN THIS:` command and the human's hands.
- If the exact same step fails three times in a row even after you've tried different fixes, stop trying to guess a fourth fix. Instead, add temporary debug output — things like `println!()` in Rust or `console.log()` in TypeScript — right at the point where the failure happens, so that the next attempt will show you the actual real values involved (the actual error object, the actual data being sent, the actual response received) instead of you continuing to guess blindly. Ask the human to run that debug version and paste back what it prints. Only once you can see the real values should you try another fix.
- If a step has failed five times total, stop completely. Do not try a sixth fix. Instead, write out clearly: what you tried, what the diagnostic output showed, your best guess at the cause (clearly labeled as a guess, not a fact), and what specific piece of information from the human would help you figure it out. This hands the problem back cleanly instead of wasting further attempts on low-confidence guesses.
- No real API key, password, or secret value should ever end up inside a file that gets saved into the project's git history. Step 33 explains exactly where real key values are allowed to live (a special file that git is told to ignore) and where they are never allowed to live (any normal source code file). If you are ever unsure whether a piece of code you're about to write would expose a secret, stop and think it through rather than proceeding.
- **Offline mode (the core, non-internet part of this app) has already been confirmed working by the human.** This is an important fact that changes how you should treat Parts I and II below. Those two parts were originally written as if things were broken and needed fixing from scratch. That is no longer true. Treat every step in Parts I and II as a "please double check this is still working" request, not a "please rebuild this" request. If the human's test for a given step passes on the first try, say so clearly and move to the next step immediately — do not rewrite, refactor, or "improve" code that is already functioning correctly. The actual real remaining problem with offline mode is that the AI-generated workflows are not always accurate (see Step 27a), and that parts of the interface need polishing (Part IV) — not that the underlying plumbing is broken.

---

# PART I — Core correctness (verification pass — the plumbing is believed to already work; confirm it, don't rebuild it)

## Step 1 — Confirm the app correctly detects whether Ollama is installed and running

**Why this matters:** the entire app depends on Ollama being available, because Ollama is what actually runs the local AI model. If the app can't tell whether Ollama is present, it will fail in confusing ways later (a generation request will just hang or error with no clear explanation) instead of telling the user clearly, right at launch, exactly what's wrong and how to fix it. Good detection here prevents a huge number of confusing downstream support questions.

**What should already exist, and what to verify:** when the app starts, it should make a real network request to `GET http://127.0.0.1:11434/api/tags` — this is Ollama's own built-in endpoint for listing installed models. There are three possible outcomes, and the app's interface should show a different, clear message for each one:
- The request fails to connect at all (connection refused) → this means Ollama is not running. The app should show install/start instructions.
- The request succeeds but the list of models is empty → Ollama is running, but no AI model has been downloaded yet. The app should offer a button to download one.
- The request succeeds and returns at least one model → everything is ready, show the list of available models.

→ `RUN THIS:` the app's normal build/run command.
→ The human will test this by: closing Ollama completely and relaunching the app (should show "not running" state), then starting Ollama with zero models downloaded (should show "no models" state with a working download button), then confirming a normal ready state once a model exists. They will tell you which of these three states, if any, did not display correctly.

## Step 2 — Confirm AI generation only ever uses a model that is genuinely installed on this computer

**Why this matters:** if the code has a model name typed directly into it somewhere (for example, the literal text `"llama3.2"` written into a function), that is dangerous, because that exact model might not be installed on a given user's computer. The correct behavior is: before generating anything, the app asks Ollama which models actually exist right now (the same check as Step 1), and only offers those as choices. If none exist, generation should refuse to even attempt, with a clear message telling the user to install a model first — it should never try anyway and produce a confusing network error.

→ `RUN THIS:` build/run command.
→ The human will check which model name is actually installed on their machine (by running Ollama's own list command themselves), then trigger a generation in the app, and confirm that the exact model name used by the app matches what they saw. They'll reply with what they found.

## Step 3 — Confirm AI generation is genuinely calling the AI model, not reusing example output

**Why this matters:** early in this project's development, there is a risk that a shortcut was taken where, instead of really calling the AI model every time, the code might match the user's typed instruction against a small set of example instructions and just return a pre-written example answer if it looks similar. This would make the app look like it works during a demo, while actually being broken for any real, new request a real user types. This step exists specifically to catch and remove that kind of shortcut if it exists anywhere in the code.

**What correct behavior looks like:** every single time a user asks for a workflow to be generated, the code should make one real network call to Ollama's `/api/generate` endpoint, sending the user's actual typed text, and using whatever comes back from that real call — with no code path anywhere that instead returns a fixed, pre-written result based on matching keywords in the user's text.

→ `RUN THIS:` build/run command.
→ The human will type two completely new instructions that have never been used anywhere before in this project's development or testing, one right after the other, and report back what each one produced. You are looking for confirmation that the two results are genuinely different from each other and actually relevant to what was typed — not the same result twice, and not a result that looks suspiciously like a known example.

## Step 4 — Confirm that a failure inside the workflow-running engine produces a clear, specific error instead of crashing the whole app

**Why this matters:** a "pipeline" or "workflow" in this app is a sequence of steps (called nodes) that run one after another, where each step's output can feed into the next step's input. If one step in that sequence fails for some reason (a file doesn't exist, a network call times out, the AI model returns something unexpected), the rest of the app must keep running and must tell the user specifically which step failed and why. It must never crash the entire application window, and it must never fail silently in a way that looks like success but produced nothing useful.

**The specific coding pattern this depends on:** in Rust, there is a difference between code that can "panic" (crash the whole program) and code that returns a `Result` type, which forces every caller to explicitly handle both the success case and the failure case. Functions like `.unwrap()` and `.expect()` are common shortcuts that convert a possible failure into an instant crash — they are appropriate only for situations that are truly impossible to fail, which is rare. Anywhere the code is handling something that comes from outside the program's control (a file on disk, data from the internet, text a user typed), the code should use proper `Result` handling instead of these crash-shortcuts.

→ `RUN THIS:` build command, then run the simplest possible workflow you can construct — just two steps, one that provides some text and one that writes that text to a file, with no AI call involved at all, to isolate whether the basic mechanism of running a workflow works before testing anything more complex.
→ The human will report whether it succeeded normally, or if it failed, they'll paste the exact error text shown (not just "it broke").

## Step 5 — Confirm that no part of the app's network requests to Ollama are silently hanging due to proxy settings

**Why this matters:** this is a specific, real bug that was previously found and partially fixed in this project. The technical cause: the Rust networking library used in this app (`reqwest`) will, by default, automatically detect and try to use any proxy server configured on the computer's operating system — even for requests to `localhost` (the computer talking to itself), which should never need a proxy at all. On a computer with a VPN, certain antivirus software, or certain corporate network settings, this causes requests to Ollama to silently hang for a very long time before eventually timing out with a generic, unhelpful error message. The fix is twofold: use the literal IP address `127.0.0.1` instead of the word `localhost` (removes any ambiguity in how the address gets resolved), and explicitly disable proxy detection when creating the network client. This fix needs to be applied everywhere in the code that talks to Ollama — not just in one file — because the code that runs a workflow and the code that generates a new workflow from a text instruction are two separate places in the codebase that each create their own network client.

→ `RUN THIS:` a search command across the whole codebase to find every place that might still have the old, unfixed pattern:
```powershell
Select-String -Path src-tauri\src\*.rs,src\*.rs -Pattern "localhost:11434|reqwest::Client::new"
```
→ The human will paste back everything that search finds. For each match that is not already using `127.0.0.1` and the proxy-disabling setting, apply both fixes there too.

→ `RUN THIS:` (after making any needed fixes) the build command.
→ The human will test a real AI generation request and confirm it completes quickly, or paste the new error if one still occurs.

## Step 6 — Confirm the "download a model" button sends the right information to the backend

**Why this matters:** in this app, the visual interface (written in TypeScript/React) and the underlying logic (written in Rust) communicate through a mechanism called Tauri's "invoke" system, where the interface calls a named backend function and passes it some data. This only works correctly if the exact name of each piece of data matches exactly on both sides — Rust's naming convention (`snake_case`, like `model_name`) gets automatically converted to JavaScript's convention (`camelCase`, like `modelName`) by Tauri, but only if both sides were written expecting that exact conversion. If one side was written with a different name than the other side expects, the call fails with an error explaining that a required piece of data is missing, even though the human clearly typed something into the button.

→ `RUN THIS:`
```powershell
Select-String -Path src-tauri\src\commands.rs -Pattern "fn.*pull_model"
Select-String -Path ui\components\*.tsx -Pattern "pull_model"
```
→ The human will paste back both results, showing you the real parameter name Rust expects side-by-side with what the interface is actually sending. Fix whichever side does not match, making sure every place in the interface that calls this function uses the exact same naming.

→ `RUN THIS:` build command.
→ The human clicks the model-download button in the real running app and confirms a real download starts with no "missing argument" error, or pastes the new error.

## Step 7 — Confirm that switching between tabs in the app does not destroy whatever the user was doing

**Why this matters:** this app has multiple tabs or panels (Chat, Logs, Models, and so on) that the user switches between. It was previously confirmed as a real, reproduced bug that switching away from the Chat tab while typing a message, or while a generation was in progress, would cause the typed text and the in-progress result to completely disappear — as if the user had never typed anything at all. The technical cause is almost always that the code responsible for showing tabs is written in a way that completely destroys and rebuilds each tab's content every time you switch to a different one, rather than simply hiding it from view while keeping it alive in the background. In React, this typically looks like a piece of code such as `{activeTab === "chat" && <ChatPanel />}` — the `&&` here means the `<ChatPanel />` component is entirely removed from existence whenever `activeTab` is anything other than `"chat"`, and a fresh, empty one is created again if the user switches back. The fix is to keep every tab's component permanently present in the page's structure, and use a simple visual style change (`display: none` versus `display: block`) to hide the ones that aren't currently selected, rather than removing them.

→ `RUN THIS:` build command.
→ The human will type some text into the Chat tab without submitting it, switch to a different tab, then switch back, and confirm whether the typed text is still there. If it's gone, apply the fix described above to whichever code is responsible for switching between tabs, for every tab, not just Chat.

## Step 8 — Move the chat's in-progress state into a place that survives no matter what happens to the visual components around it

**Why this matters:** Step 7 fixes the direct cause of the disappearing-text bug. This step is an additional safety layer on top of that fix, not a replacement for it. The idea is to store the current state of "what is the user typing, is a generation currently running, what did it produce, did it fail" in a separate, centralized piece of storage (in this codebase, that's a library called Zustand, used to create what's called a "store") that exists independently of any single visual component. This way, even if some other, currently-unknown part of the app in the future accidentally causes a component to be destroyed and recreated the same way the Chat tab was, the actual data won't be lost, because it never lived inside that component's temporary memory in the first place — it lived in the separate, persistent store.

→ `RUN THIS:` build command.
→ The human will start a generation, switch tabs while it's still running, and switch back before it finishes, confirming that both the text they typed and the live "still generating" status are shown correctly when they return. They'll reply with what they observed.

## Step 9 — A full, realistic end-to-end test of everything in Part I together

**Why this matters:** the steps above test individual pieces in isolation. This step exists to catch problems that only show up when multiple pieces are used together in a realistic way, which individual tests can sometimes miss.

→ `RUN THIS:` build/run command.
→ The human will build and run a real workflow that uses more than one type of step, including at least one step that calls the AI model, from start to finish, and confirm it completes with real, sensible output, with no crashes, no indefinite hanging, and no suspiciously repeated/canned-looking results. They will report the outcome before you move on to Part II.

---

# PART II — Production hardening (also a verification-and-improvement pass, not a rebuild)

**Why this whole part exists:** even once the main functionality works, a real application needs to handle the countless small things that can go wrong in the real world — a folder that doesn't exist, a file the program isn't allowed to write to, a network connection that drops halfway through, a user who pastes in a broken or hand-edited file. Every single one of these situations must result in a clear, specific message to the user, never a silent failure and never a full application crash. This part systematically goes through the most likely places these problems could hide.

## Step 10 — Find and fix every place in the Rust code that could crash the whole program instead of returning a proper error

**Why this matters:** as explained in Step 4, functions like `.unwrap()`, `.expect()`, and the `panic!` macro are Rust's way of saying "if this fails, stop the entire program immediately." This is sometimes intentional and fine (for example, checking a condition that truly cannot be false if the code is correct), but very often it's used carelessly on things that absolutely can fail in the real world — like reading a file, or parsing text that came from a network response or from something the user typed. Every one of those careless uses is a hidden crash waiting to happen in front of a real user.

→ `RUN THIS:`
```powershell
Select-String -Path src\*.rs,src\cli\*.rs,src-tauri\src\*.rs -Pattern "\.unwrap\(\)|\.expect\(|panic!"
```
→ The human will paste the full list of every place this pattern appears. Go through the list and, for anything touching a network call, a file, or data parsed from outside the program, replace the crash-prone pattern with proper `Result`-based error handling using the `anyhow` and `thiserror` libraries already included in this project, so a failure becomes a clear returned error message instead of a crash. If you genuinely believe a specific instance cannot ever fail in practice, leave a short comment explaining why, rather than silently ignoring it.

→ `RUN THIS:` `cargo build --release`
→ The human confirms the project still builds cleanly after these changes, or pastes any new build error.

## Step 11 — Confirm the app behaves sensibly when Ollama or the vector database (ChromaDB) is completely unreachable

**Why this matters:** Ollama and ChromaDB are both separate programs running alongside this app, not part of it. Either one could be closed, crashed, or simply never started by the user. The app must detect this and explain it clearly, rather than hanging forever or crashing.

→ `RUN THIS:` build command.
→ The human will completely stop Ollama and then try to generate a workflow, run a workflow, or download a model, and report whether each of these produced a clear, specific error message (naming which service is unreachable) rather than a crash or an indefinite hang.

## Step 12 — Confirm the app behaves sensibly when writing files fails

**Why this matters:** a workflow step that writes output to a file can fail for ordinary, common reasons — the target folder doesn't exist, the user doesn't have permission to write there, or the disk is full. None of these should crash the app; all of them should produce a message explaining specifically what went wrong.

→ `RUN THIS:` build command.
→ The human will deliberately configure a file-writing step to save to a folder path that doesn't exist, run it, and report whether the resulting error message was clear and specific rather than a crash.

## Step 13 — Confirm the app behaves sensibly when given a broken or hand-edited workflow file

**Why this matters:** because workflow files are just plain JSON text files, a curious or technically-minded user might open one in a text editor and change something, possibly breaking it — removing a required field, misspelling a step type, or creating a reference to a step that doesn't exist. The app's validation step must catch every one of these problems and explain, specifically, what's wrong and where, rather than crashing or showing a generic "something went wrong" message that gives the user no way to fix it themselves.

→ `RUN THIS:` the app's validate function/button, run against a workflow file the human will deliberately break first.
→ The human will paste the exact error message the app showed, and you'll assess whether it was specific and actionable (good) or vague/crashed (needs fixing).

## Step 14 — Confirm every clickable button in the interface actually does something, or is clearly disabled with an explanation

**Why this matters:** as an interface grows, it's common for a button to get added during development, wired up to a placeholder that does nothing, and then accidentally left that way. A button that silently does nothing when clicked is confusing and erodes a user's trust in the whole app, because they can't tell if it's broken or if they're doing something wrong.

→ `RUN THIS:`
```powershell
Select-String -Path ui\components\*.tsx -Pattern "onClick|invoke\("
```
→ The human will use this list alongside actually clicking through every visible button in the running app once, and report back any button that did nothing or produced an error in the browser developer console that wasn't shown to the user in any way.

## Step 15 — Confirm that running a workflow, like generating one, also survives switching tabs mid-way through

**Why this matters:** Steps 7 and 8 fixed this specific problem for the chat/generation feature. This step exists to check whether the same underlying problem also affects the separate part of the app responsible for actually running a saved workflow — since it's a different piece of code with its own separate state, fixing one does not automatically fix the other.

→ `RUN THIS:` build/run command.
→ The human will start running a workflow, switch tabs while it's still executing, switch back, and confirm the live progress/status is still shown correctly, not reset or lost.

## Step 16 — A completely clean, from-scratch rebuild to catch anything that only breaks in a fresh environment

**Why this matters:** sometimes a project appears to work because of leftover files from previous builds that are quietly covering up a real problem — an old compiled file that never got updated, for instance. Deleting everything and rebuilding from absolute zero is the only way to be certain the project would actually work correctly for a brand new user who has never run it before.

→ `RUN THIS:`
```powershell
cargo clean
Remove-Item -Recurse -Force node_modules
npm install
cargo build --release
npm run tauri build
```
→ The human confirms this entire sequence completes successfully with no errors, or pastes whichever step failed.

---

# PART III — Chat history sidebar (a new feature: let users see and revisit past AI generations)

**Why this whole part exists:** right now, once a user generates a workflow through the chat feature and moves on, there's no way to look back at what they asked for before, or to pick up editing an earlier result. This part adds a sidebar, similar to how chat history works in many AI chat applications, where every past generation is saved, shown in a list, and clickable to bring it back for viewing or further editing.

## Step 17 — Build the backend storage for chat history

**Why this matters and how it should work:** history needs to be saved somewhere that survives the app being closed and reopened — not just kept in memory, which would disappear on restart. The natural place for this in a Tauri app is a special folder the operating system sets aside for each app's own data (different from the project's source code folder, and different from any folder the user manages themselves). Every time a generation succeeds, one entry gets added to this history — recording when it happened, what the user typed, which AI model was used, and the resulting workflow. There need to be three basic backend operations: load the whole history list, save a new entry (or update an existing one, if the user is re-saving something they already edited), and delete a specific entry.

→ `RUN THIS:` `cargo build --release`
→ The human confirms the project builds cleanly with these new backend functions added. They'll reply `go` or paste the error.

## Step 18 — Connect the frontend's state store to this new history storage

**Why this matters:** the interface needs a central place to hold the list of history entries, which of them (if any) is currently being viewed, and functions to load history from the backend, load one specific entry back into the chat view, and delete an entry — extending the same central store discussed in Step 8, so the whole chat feature's state lives in one consistent place.

→ `RUN THIS:` build command.
→ The human confirms this builds without errors.

## Step 19 — Build the visual sidebar itself

**Why this matters:** this is the actual list the user sees and clicks on — showing each past instruction (shortened if it's long), a button to start a completely new chat, and a way to remove an entry they no longer want.

→ `RUN THIS:` build command.
→ The human confirms this new piece of the interface appears and compiles correctly, even before it's connected to the rest of the layout.

## Step 20 — Place the sidebar into the actual chat screen layout

**Why this matters:** having the sidebar exist as a piece of code isn't useful until it's actually placed on screen next to the existing chat interface, arranged so both are visible and usable together (sidebar on one side, the existing chat conversation area on the other).

→ `RUN THIS:` build command.
→ The human will generate two or three different workflows, one after another, confirm each shows up as a new entry in the sidebar, then click on an older one and confirm it correctly brings back that earlier instruction and result.

## Step 21 — Make sure clicking an old entry and continuing to chat actually edits that same workflow, rather than starting an unrelated new one

**Why this matters:** the whole point of history is to let someone pick up an earlier result and refine it — "actually, also add a step that does X" — rather than having to describe the entire workflow again from scratch. This means that once an old entry is loaded, any new instruction the user types needs to be treated as a modification of that specific loaded workflow, using the same underlying "edit an existing workflow" logic this project's chat feature already has for that purpose, not the "create something brand new" logic.

→ `RUN THIS:` build command.
→ The human will load an older history entry, type a small additional instruction, and confirm the result is a modified version of that same workflow rather than a completely different, unrelated one.

---

# PART IV — Interface polish, checking every node type works correctly, adding two new capabilities, and adding a "run in a real terminal" option

## Step 22 — Get specific, concrete complaints about the tabs, instead of a general "it's not good" impression

**Why this matters:** "the tabs aren't good" isn't something that can be directly acted on, because it could mean many different specific things — confusing styling, unclear which tab is currently active, awkward placement, inconsistent spacing, or something else entirely. Fixing this properly requires first turning the vague feeling into a specific list of concrete problems.

→ `RUN THIS:` build/run command.
→ The human will click through every tab in the running app and write down each individual thing that feels wrong, as a separate item, rather than one general complaint.

## Step 23 — Fix each specific issue found in Step 22, one at a time

Go through the list from Step 22 and address each item individually, confirming each one separately rather than making a pile of changes all at once and hoping they're all correct.

## Step 24 — Rebuild the "Saved Agents" screen to actually be useful at a glance

**Why this matters:** a list of saved workflows is only useful if a user can look at it and immediately understand what each one is, whether it last ran successfully, and how to act on it — without having to click into each one individually just to find out its name or status.

**What "good enough" looks like here:** each saved item in the list shows a real, meaningful name (see Step 27 below for how that name gets generated), a short one-line description of what it does, when it last ran and whether that run succeeded, and three clearly visible actions — open it on the canvas to look at or edit it, run it, or delete it — without needing to open a secondary menu just to find those three basic actions.

→ `RUN THIS:` build command.
→ The human will look at the screen with at least three saved workflows present and confirm whether it's genuinely easy to understand what's there at a glance, or list what's still missing.

## Step 25 — Show real, live progress while a workflow is being generated from a text instruction, instead of a plain loading spinner

**Why this matters:** a generic spinner with no text gives the user no information about whether the app is working normally, stuck, or about to fail — leading them to wonder if they should wait, refresh, or give up. Showing specific status messages as the process actually moves through its real stages (understanding the instruction, checking the result is valid, fixing it if it wasn't) builds much more confidence and reduces confusion.

→ `RUN THIS:` build command.
→ The human confirms that during a real generation, they see changing, specific status text rather than a static spinner, and report what (if anything) is still missing.

## Step 26 — When a generation completely fails, explain to the user what was actually unclear about their request

**Why this matters:** if the AI model tried multiple times and still couldn't produce a valid result, simply saying "generation failed" leaves the user with no idea what to do differently. A better failure message uses the actual, specific reason the last attempt was invalid (which the code already has available, from the validation step) and explains it in plain language a non-technical person could act on, rather than a raw technical error dump.

## Step 27 — Real agent auto-naming — generate the workflow's name from what it actually does, not from truncating the user's raw sentence

**Why this matters:** simply cutting off the user's typed instruction at some character limit produces awkward, unclear names. A better approach is to make one additional, separate, short request to the AI model after the workflow itself has been generated, specifically asking it to produce a short title based on a summary of what the finished workflow actually contains (which node types it uses and what they do together) — since the AI model can describe the actual generated result more accurately than a blind truncation of the original request can.

→ `RUN THIS:` build command.
→ The human will generate two different workflows and confirm each receives a distinct, sensible name that reflects what it does, reporting back if either name is generic, unhelpful, or just a cut-off copy of their original sentence.

## Step 27a — Improve how accurate and reliable the offline generation actually is (the real remaining gap — do not touch the underlying plumbing while doing this)

**Why this matters, and why this step is different from everything before it in this part:** the human has confirmed that offline generation technically works — it runs, it doesn't crash, it produces a result — but the results are not consistently accurate or complete enough yet. This is not a bug in the code's mechanics; it's a matter of how well the instructions given to the AI model are written, and how much example material the model has to learn the correct pattern from. Because of this, the fix here is entirely about improving the wording, structure, and examples inside the system prompt sent to the AI model — not about changing how requests are sent or responses are parsed, which already work correctly and should not be touched here.

**Specific things to improve:**
- Add more worked examples to the system prompt — showing the model a wider variety of situations (a workflow with steps happening in parallel, a workflow with a decision point that branches two different ways, a longer chain of several steps in sequence) rather than just one single simple example, since a model shown only one style of example tends to default toward reproducing that one style even when it's not the best fit for a new request.
- Double-check that the formal description of the allowed workflow structure (the schema) shown to the AI model inside the prompt is generated automatically from the real, current code definitions, rather than being a separately hand-written copy that could have drifted out of sync as the real code changed over time.
- Confirm that when a generated result fails validation and the system asks the model to try again, the specific real error message is what actually gets sent back to the model to correct — not a vague, generic "that wasn't right, try again" message, since a specific error gives the model something concrete to fix.
- Consider lowering the "temperature" setting (a number that controls how much randomness/creativity the model uses) further, specifically for this generation task, if you notice the same instruction producing meaningfully different results each time it's tried — lower temperature makes output more consistent and predictable, which is more valuable here than creativity.

→ `RUN THIS:` build command.
→ The human will repeat the same handful of real instructions they've tried before (including any that previously produced wrong or incomplete results) and compare the new results against what they remember from before, reporting whether accuracy has genuinely improved or which specific instructions are still producing bad results.

## Step 28 — Add a new node type for creating text embeddings (a building block for search/similarity features)

**Why this matters and what this actually is, for context:** an "embedding" is a way of converting text into a list of numbers that captures its meaning, allowing a computer to later compare how similar two pieces of text are to each other, even if they don't share the exact same words. This is a required building block for any future "search my past documents" or "find similar past workflows" style features. Ollama has a built-in way to generate these, so this new node type is simply a thin wrapper around that existing capability — it takes some text as input and produces the embedding as output, choosing which specific embedding-focused model to use (a small, purpose-built model like `nomic-embed-text` is the standard choice here, much smaller and faster than a general chat model).

## Step 29 — Add a new node type for storing and searching those embeddings in a local vector database (ChromaDB)

**Why this matters:** producing an embedding by itself isn't useful unless it's stored somewhere it can later be searched. ChromaDB is a piece of local, open-source software specifically built for this purpose. This new node type needs to support two different operations depending on how it's configured: adding a new piece of data to a named collection, or searching an existing collection for entries similar to some new input. Because this operation genuinely needs two separate pieces of input at once (the embedding itself, and the original text it came from, so the original text can be shown later in search results), this node type needs a way to bind two named inputs, not just one — earlier node types in this app that only ever needed one single input don't need this, but this one does, and the code handling node inputs needs to support that.

→ `RUN THIS:` build command.
→ The human will build a small test workflow using both of these new node types together, running it against a real, running local ChromaDB instance, and confirm that both storing and later searching for data genuinely work, reporting the real result or any error encountered.

## Step 30 — Carefully re-check that every one of the seven existing node types actually produces correct results, not just that they run without crashing

**Why this matters and why "doesn't crash" is not enough:** a node can technically finish running "successfully" from the program's point of view while still producing the wrong output — for example, a file-reading step that runs without error but actually returns empty or garbled text because of some subtle bug. This step exists specifically to catch that category of problem, which ordinary error-checking would never catch, because there's no error being thrown at all — the result is just quietly wrong.

**What to specifically check for each node type:**
- The node that calls the AI model: is its output actually relevant to what was asked, complete, and not cut off partway through?
- The node that watches a folder for new files: does it detect a real new file exactly once, without either missing it entirely or reporting it multiple times for the same single change?
- The node that accepts typed text: does text containing multiple lines, quotation marks, or the special `{{` characters (used elsewhere in this app for inserting values) pass through correctly without being corrupted or misinterpreted?
- The node that reads an image file: does the actual image data correctly reach whatever comes next, rather than an empty or broken reference to the file?
- The node that extracts text from a PDF: does the extracted text genuinely match what's really in the PDF, including PDFs with more than one page?
- The node that writes a file: is the file's content and format (such as markdown, plain text, or JSON) actually correct once written, with no accidental double-encoding of the content?
- The node that branches based on a condition: do both possible paths (the "yes, this matched" path and the "no, it didn't" path) each genuinely trigger correctly depending on real, different input?

→ `RUN THIS:` a test workflow that exercises all seven of these node types together in one run.
→ The human will run it and report the real, actual output produced by each individual node, which you'll compare against what each one is supposed to do — fixing any node whose real output is wrong, not just any node that happened to throw a visible error.

## Step 31 — Add a "Run in a real terminal" option for saved workflows

**Why this matters and what this actually does:** this project already includes a separate command-line version of the tool (a program that runs from a terminal window rather than showing a graphical interface), which can run a saved workflow file directly. Right now, using that requires a user to manually open a terminal themselves and type the right command by hand. This step adds a button in the graphical app that does that work for the user — opening an actual, real terminal window on their operating system, and having it automatically run the correct command against whichever workflow they clicked the button on. Because each operating system (Windows, macOS, Linux) has a different way of programmatically opening a terminal window, this needs separate handling for each one. If opening a terminal automatically fails for some reason (for example, if a Linux user doesn't have the specific terminal program the code tries to use), the app should never fail silently — it should show the exact command as text the user can copy and paste themselves instead.

→ `RUN THIS:` build command.
→ The human will click this new button on a real saved workflow and confirm that a real terminal window actually opens and the workflow actually runs through it successfully, or report what happened instead.

---

# PART V — A single switch that changes the whole app between fully offline and using online AI models

**Why this whole part exists and the core principle behind it:** this app's entire identity is built around being private and fully local — nothing about the user's data or requests ever needs to leave their computer. Some users, though, may want the option to use more powerful cloud-hosted AI models when they're available and the user has explicitly chosen to allow it. This part adds that as a clearly separate, deliberately chosen mode, never something that happens by accident or by default. The single most important principle across every step in this part: **offline stays the default every single time the app starts, and nothing about offline mode's behavior should change or be put at risk while building this.**

## Step 32 — Build the central switch itself

**Why this matters:** every single part of the app that ever calls an AI model — the chat/generation feature, the built-in help assistant, and any workflow step that calls the AI model while running — needs to check one single, shared piece of information to know whether it should be using the local Ollama model or an online one. If each of these checked its own separate, independent flag instead of one shared source of truth, they could easily end up disagreeing with each other, which would be confusing and could accidentally cause data to be sent online when the user believed they were in offline mode.

→ `RUN THIS:` build command.
→ The human confirms that no matter what, every time the app is freshly launched, it starts in offline mode, never online, even if online was selected the last time it was used previously — or reports if that's not the case.

## Step 32a — Add a real check for whether the computer currently has an internet connection at all, separate from the offline/online AI mode switch

**Why this matters and why it's a genuinely separate concern from Step 32:** a user could switch the app into "online" mode while their computer's internet connection is actually down, or unavailable for some other reason (airplane mode, a network outage, being somewhere with no signal). If the app doesn't check for this specifically, the user's experience would be a confusing hang or a cryptic network error when they try to use an online model, with nothing telling them the real, simple reason: there's currently no internet connection at all. This check should happen proactively, as soon as the user opens the online section of the app, not only at the moment they try to actually generate something.

→ `RUN THIS:` build command.
→ The human will disconnect their computer from the internet entirely (while leaving Ollama running locally, since that's unrelated) and open the online section of the app, confirming that a clear "no internet connection" message appears rather than a confusing failure, then reconnect and confirm the message correctly goes away.

## Step 33 — Set up how the online AI providers' access credentials (API keys) get stored, in two separate ways for two separate purposes

**Why this needs two separate approaches, explained clearly:** there are two different situations that both need to be handled, and they have different requirements. The first situation is: a real person using the finished app needs a way to type in their own API key once, through the app's own interface, and have it remembered safely — this needs to work without that person ever touching a code file directly. The second, separate situation is: right now, in order for this exact feature to actually be built and tested at all, the code needs some real, working API key values to test against — otherwise nobody, including you, can confirm any of this actually works. These two situations need different handling because of one critical rule that must never be broken: a real API key value must never end up saved inside any file that becomes part of this project's saved, shared history in git, because this project's code is intended to be publicly visible, and anyone who could see that history would then be able to see and misuse that key.

**Part (a) — the real interface for real users:** build a settings screen where a person can type in a label for the provider (something to call it, like "Nemotron"), which specific online model they want to use, and their own API key for it, and have that saved to a special file location that Tauri sets aside for this app's own private data — a location that exists completely outside of and separate from this project's actual source code folder, so it could never accidentally end up being saved into the project's shared history. When this information is shown back to the user later, only the label/name should be shown again, never the actual key value.

**Part (b) — a separate, local-only file purely for building and testing this feature right now:** create a new file at the very top of the project folder, and before doing anything else, check whether the project already has a file (usually named `.gitignore`) that tells the project's version-control system which files to deliberately ignore and never save into its history — and if that ignore-file doesn't already list this new file, add it there first, before creating the new file with any real values in it. Only once that's confirmed should the new file be created, containing the following real values, which are provided here specifically so this feature can actually be built and verified end-to-end right now:
```
NVIDIA_API_KEY_1=YOUR_NVIDIA_API_KEY_HERE_1
NVIDIA_API_KEY_1_NAME=Nemotron
NVIDIA_API_KEY_1_MODEL=nvidia/nemotron-3-super-120b-a12b

NVIDIA_API_KEY_2=YOUR_NVIDIA_API_KEY_HERE_2
NVIDIA_API_KEY_2_NAME=GLM
NVIDIA_API_KEY_2_MODEL=zai-org/glm-5.3

NVIDIA_API_KEY_3=YOUR_NVIDIA_API_KEY_HERE_3
NVIDIA_API_KEY_3_NAME=Kimi
NVIDIA_API_KEY_3_MODEL=moonshotai/kimi-k2.5
```
This file should only ever be read while the app is being run in its development/testing mode, never in the final, real version that would be given to actual users, and its contents should be used purely to automatically fill in the same storage that part (a) above writes to, so that testing can proceed without a human needing to manually type these values into the interface every single time. The exact model identifier text shown above (things like `nvidia/nemotron-3-super-120b-a12b`) is a best-effort guess based on how NVIDIA's model catalog names things in their published documentation — before relying on any of them, check the model's own page on NVIDIA's website to confirm the exact, correct identifier text, and if a request comes back saying a model couldn't be found, that's the first thing to check and correct.

**A short list of other real, currently free models available through this same NVIDIA service, worth adding as further backup options later, alongside the three above** (again, double-check each one's exact identifier on NVIDIA's site before relying on it): a general-purpose open model called GPT-OSS at the 120-billion-parameter size, a reasoning-focused model from the DeepSeek family, a well-established general model from Meta's Llama 3.1 family at the 70-billion-parameter size, a model from the Mistral family that tends to be particularly good at producing well-structured output (useful for this app's own JSON-generation needs specifically), and a reasoning-focused model called MiniMax M2 that could work well specifically for the app's built-in help/troubleshooting assistant. As of when this was researched, this service offers free starting credits to anyone who signs up, with a rate limit of about 40 requests per minute on the free tier — worth keeping in mind, since hitting that limit repeatedly should be recognized by the fallback logic in Step 35 as "temporarily rate-limited," not treated the same as a broken key or dead service.

→ `RUN THIS:` build command.
→ The human will confirm that the provider information loaded correctly from the new local-only file during a development build, and separately confirm — by checking with their version-control tool — that this new local-only file is genuinely being ignored and not something that would get included if they were to save/share their project's history right now. From this point forward in the conversation, the human should only report success or failure, never paste the actual key values back into the chat again.

## Step 34 — Build the shared underlying mechanism that lets the rest of the app call either the local or an online AI model through one consistent interface

**Why this matters:** without this step, every single place in the app that currently calls the local Ollama model directly would need to be individually rewritten to also handle the online case, which is repetitive and error-prone. Instead, this step creates one shared, common shape that both the "call the local model" behavior and the "call an online model" behavior both fit into, so that everywhere else in the app that needs to generate text can simply ask for "whichever provider is currently active" without needing to know or care whether that turns out to be local or online underneath.

→ `RUN THIS:` build command.
→ The human confirms this new shared piece of code builds without errors.

## Step 35 — If the currently selected online provider fails, automatically try another one instead of giving up immediately

**Why this matters:** the whole reason for setting up multiple different online providers, rather than just one, is so that if one of them is temporarily unavailable, overloaded, or has hit its free usage limit for the moment, the app can quietly try the next one instead of immediately showing the user an error. This directly supports the goal of keeping the app usable for free, since it makes the most of several separate free options together rather than relying on just one and being stuck whenever that one specific one has an issue. The interface should show, in a small and unobtrusive way, which provider actually ended up answering, so a curious user can see this happening, but a failure should only be shown to the user as a real error once every single configured option has been tried and all of them failed.

→ `RUN THIS:` build command.
→ The human will deliberately make one of the configured providers fail (for example, by temporarily typing an incorrect key for it) and confirm that the app automatically and successfully falls back to a different, working one instead of showing an error, reporting what actually happened.

## Step 36 — Confirm every part of the app that can call an AI model correctly respects the mode switch, in both directions

**Why this matters and why both directions need separate, explicit testing:** it's not enough to confirm that online mode successfully reaches an online model — it's equally important to explicitly confirm that offline mode never, under any circumstance, makes a request to any online service. This second half is easy to accidentally overlook, because if the app happens to work correctly it will look identical to someone glancing at it whether or not this was ever actually verified — the only way to know for certain is to deliberately check for it, not simply assume it because nothing looked wrong.

→ `RUN THIS:` build command.
→ The human will switch the app into online mode, run a real workflow that includes a step calling the AI model, and confirm that step really did go to an online provider (for example, by noticing the response style is clearly different from the local model, or by checking their computer's network activity). Then they will switch back to offline mode, run the same kind of workflow again, and confirm — as certainly as they can — that no online request happened at all this time. They'll report both results.

---

## Final summary checklist — fill this in honestly as work actually progresses, not in advance

```
Part I   (Steps 1–9,   verification pass): [VERIFIED / STILL BROKEN] — core correctness
Part II  (Steps 10–16, verification pass): [VERIFIED / STILL BROKEN] — production hardening
Part III (Steps 17–21): [VERIFIED / STILL BROKEN] — chat history sidebar
Part IV  (Steps 22–27, 27a, 28–31): [VERIFIED / STILL BROKEN] — interface polish, generation accuracy, node correctness audit, new nodes, terminal launch
Part V   (Steps 32, 32a, 33–36): [VERIFIED / STILL BROKEN] — online/offline mode switch, internet check, real provider setup, fallback
```
