# Master Prompt — Paste This to Antigravity (or any coding agent)

---

You are implementing **Hybrid Local AI Hub**, a Rust CLI application. The full implementation plan is attached/available at `Agent-Implementation-Plan-v1.md` — that document is your source of truth for architecture, phase order, exact files to create, models to recommend, and acceptance criteria. Do not deviate from its schema, node vocabulary, or phase ordering without a strong, stated reason.

## Operating constraints — read before starting

You have a **limited token budget**. Work as if every token costs real money, because it does. This changes how you should behave, not how much you should accomplish:

1. **Write code, not commentary.** Do not re-explain the plan back to me before implementing it. Do not narrate what you're about to do in prose before doing it — just do it, then report results tersely. I have already read the plan; I don't need it summarized.
2. **No filler acknowledgments.** Skip phrases like "Great, let's get started" or "I'll now proceed to implement." Go straight to tool calls and code.
3. **Batch your work.** Within a phase, write all the files that phase requires before pausing to report — don't create one file, explain it, create another file, explain it. One consolidated report per phase, not per file.
4. **Report progress in this exact compact format, nothing more, at the end of each phase:**
   ```
   Phase N: [DONE/BLOCKED] — <one line on what was built>
   Acceptance check: [PASS/FAIL] — <one line on how you verified it>
   Next: Phase N+1
   ```
   If something failed, state the specific error in one or two lines and your fix, not a full retrospective.
5. **Do not ask for permission between phases** unless the plan's stop condition genuinely fails and you cannot resolve it yourself after a reasonable attempt. Proceed autonomously through all phases in order. Only interrupt me for: (a) a stop condition that fails after your own reasonable debugging effort, (b) a genuine ambiguity in the plan that materially changes architecture, not a minor implementation detail — for minor details, make the most reasonable choice and note the assumption in one line, don't ask.
6. **No mocked or placeholder "success."** Every acceptance check in the plan that requires a real local Ollama/ChromaDB call must be run for real. Do not report a phase as done based on code that "should work" — run it.
7. **Clean as you go, not just at the end.** Follow the plan's per-phase cleanup discipline (`cargo clippy -D warnings`, `cargo fmt`, delete scratch/dead code) before reporting a phase complete — this prevents a large, expensive cleanup pass later that burns more tokens than doing it incrementally.
8. **If you're running low on budget mid-plan**, prioritize in this order and say so explicitly rather than silently truncating: Phase 0–3 (repo, schema, engine, CLI core) is non-negotiable — a broken foundation makes everything after it worthless. Phase 4–5 (model management, chat compiler) is the core value proposition — do not skip. Phase 6–8 (refinement, logs, export, templates) are valuable but can be left as a clearly marked TODO with exact remaining steps if budget runs out. Phase 9 (TUI) is optional — skip it first if budget is tight. Phase 10 (release hardening) can be summarized as a checklist for me to run manually if you can't complete it.

## Quality bar — non-negotiable regardless of budget

- No prototype-quality shortcuts: real error handling (no `unwrap()` on anything that can fail from user input or network calls — use `anyhow`/`thiserror` as specified in the plan), real validation, real tests.
- The chat-to-graph compiler must generalize to instructions never seen in this plan — verify this with genuinely new test prompts at implementation time, per Phase 5's stop condition.
- Every phase's acceptance check must actually pass before you move on. A skipped or fudged acceptance check compounds into a broken final product, which costs far more tokens to fix later than getting it right now.

## Start now

Begin at Phase 0. Work through the plan in order. Report using the compact format above after each phase. Do not stop to summarize the whole plan back to me — start building.
