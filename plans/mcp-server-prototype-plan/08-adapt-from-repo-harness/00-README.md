# Adapting `repo-harness` MCP patterns into `cwc-mcp-server`

This folder is the detailed, step-by-step version of the original
`08-adapt-best-features-from-repo-harness.md`. Each step is a self-contained
`.md` with: what the pattern does, **links to the source files** in the cloned
repo, a **full code example**, how to adapt it to `cwc-mcp-server`, V0/V1
timing, and the **developer's own answer** (from the DeepWiki Q&A) where it
changes the recommendation.

All source links point into the clone at `draft/`, e.g.
`draft/src/cli/mcp/redaction.ts`.

## Steps

| Step | File | Adopt in | Note |
| --- | --- | --- | --- |
| 1 | [`01-server-instructions.md`](01-server-instructions.md) | **V0** | Dev says: single most effective behavior constraint; first 512 chars must be self-contained. |
| 2 | [`02-structured-results-error-codes.md`](02-structured-results-error-codes.md) | **V0** | ⚠️ Revised: error codes yes; `structuredContent` **dropped** — dev does not use it. |
| 3 | [`03-redaction-and-deny-layer.md`](03-redaction-and-deny-layer.md) | **V0** | ⚠️ Revised: redaction must NOT be the only layer — pair it with a deny list. |
| 4 | [`04-tool-surface-annotations.md`](04-tool-surface-annotations.md) | **V0** | Annotations honored by ChatGPT in E2E; `additionalProperties:false` everywhere. |
| 5 | [`05-effects-injection-testing.md`](05-effects-injection-testing.md) | **V0** | ⚠️ Revised: this is a *general* testability pattern, **not** copied from repo-harness (which calls effects directly). |
| 6 | [`06-audit-log.md`](06-audit-log.md) | **V0** | Hash inputs from day one — never log raw prompt/clipboard. |
| 7 | [`07-blocking-human-in-the-loop.md`](07-blocking-human-in-the-loop.md) | **V0 (decide before tool impl)** | 🔴 Your hardest problem. repo-harness has **no** answer. This is a decision point *before* main-plan Step 3 — it shapes the schema + error codes. |
| 8 | [`11-doctor.md`](11-doctor.md) | **V0** ⬆️ | ⚠️ Promoted from V1: ~30 lines, directly addresses your fragile WebSocket + clipboard flow. |
| 9 | [`08-path-policy.md`](08-path-policy.md) | V1 (if file tools) | Caught traversal, absolute paths, symlink escape, deny globs, size cap. |
| 10 | [`09-config-and-secrets.md`](09-config-and-secrets.md) | V1 | `mode 0o600` is Unix-only (Windows gotcha); corruption silently swallowed. |
| 11 | [`10-transports-and-auth.md`](10-transports-and-auth.md) | V1+ | stdio = 8 lines, HTTP = ~370. Only ChatGPT's remote OAuth forced HTTP. |
| 12 | [`12-starter-checklist.md`](12-starter-checklist.md) | reference | The developer's one-page MCP starter checklist. |

## V0 build order (effort vs. value)

Do them in this order — confirmed with the developer:

| Order | Item | Step | Why this position |
| --- | --- | --- | --- |
| 1 | Instructions string | 01 | ~8 lines; do it before any code, it forces the boundary decision. |
| 2 | Annotations (`readOnlyHint` etc.) | 04 | ~2 lines per tool, zero cost. |
| 3 | **Redaction** | 03 | Highest safety/effort ratio; clipboard content is unvetted. |
| 4 | Error codes (no `structuredContent`) | 02 | Define the enum, use it in tests. |
| 5 | **Blocking strategy decision** | 07 | 🔴 Decide *before* implementing the tool — it changes the schema + error codes. |
| 6 | `doctor` (WS + clipboard) | 11 | ~30 lines; addresses your stated hardest failure mode. |
| 7 | Effects injection (WS + clock) | 05 | Design pattern, not a copy — do it while writing tests. |
| 8 | Audit log | 06 | `audit.ts` is 32 lines; easy, but lower urgency than the above. |

## What changed after the developer's answers

Three concrete revisions to the original doc:

1. **Drop `structuredContent` from V0.** The developer confirmed repo-harness
   returns only `{ content: [{ type:'text', text }] }` and does **not** use
   `structuredContent` — "not worth the effort until clients actually use it."
   Keep the machine-readable **error codes** (those are real and valuable);
   skip structured output. (See step 2.)
2. **Redaction is defense-in-depth, not the primary control.** The primary
   control in repo-harness is the **deny-glob list** that blocks `.env`,
   `*.pem`, `secrets/**` *before any read*. Redaction is a backstop for content
   that slips through. For your clipboard flow you have no path layer, so
   redaction carries more weight — but treat it as imperfect (pattern-based,
   misses `token: value` without `=`). (See step 3.)
3. **The blocking-call problem is unsolved upstream.** repo-harness's only
   blocking tool (`run_workflow_check`) just uses a 60s timeout; there is no
   progress, cancellation, or human-in-the-loop pattern. Your
   `send_to_codewebchat` is genuinely novel territory — step 7 proposes the
   split-tool (`send` + `poll`) design the developer suggested. **This is a
   decision point before main-plan Step 3 (tool implementation)**, because it
   determines the tool's input schema and error codes.
4. **Effects injection is general advice, not a copy.** repo-harness calls
   `runHelper`/`runProcess` directly in `tools.ts` — it does **not** inject them
   into its MCP tools. Injecting your WebSocket factory + clock is still the
   right move for testability; just don't treat it as "copying repo-harness."
5. **`doctor` promoted to V0.** Originally V1. Given your fragile WebSocket +
   clipboard flow, a ~30-line doctor checking `localhost:55155` and clipboard
   access is worth more at V0 than the audit log.

## Source map (best functions, by file)

- `draft/src/cli/mcp/server.ts` — server factory, instructions wiring (step 1)
- `draft/src/cli/mcp/instructions.ts` — the instructions string (step 1)
- `draft/src/cli/mcp/tools.ts` — `textResult`/`errorResult`, tool defs,
  annotations, validation, overwrite guard (steps 2, 4, 6)
- `draft/src/cli/mcp/redaction.ts` — secret patterns (step 3)
- `draft/src/cli/mcp/policy.ts` + `types.ts` — deny globs, profiles (steps 3, 8)
- `draft/src/cli/mcp/audit.ts` — hash-only audit log (step 6)
- `draft/src/cli/mcp/paths.ts` — traversal/symlink/glob guards (step 8)
- `draft/src/cli/mcp/auth.ts` + `oauth.ts` + `transports/http.ts` — auth (step 10)
- `draft/src/cli/mcp/setup.ts` — doctor + gitignore (steps 9, 11)
- `draft/src/cli/mcp/transports/stdio.ts` — the 8-line stdio transport (step 10)
