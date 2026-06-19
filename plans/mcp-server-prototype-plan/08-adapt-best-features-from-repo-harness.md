# Step 8 — Adapt best features from `repo-harness` (split)

> **This file has been split into a detailed, step-by-step folder** and updated
> with the developer's DeepWiki Q&A answers.
>
> See **[`08-adapt-from-repo-harness/00-README.md`](08-adapt-from-repo-harness/00-README.md)**.

Each pattern is now its own step file with source links into `draft/`, full code
examples, and the adaptation for `cwc-mcp-server`:

1. `01-server-instructions.md` — server `instructions` string (V0)
2. `02-structured-results-error-codes.md` — error codes (V0); `structuredContent` dropped
3. `03-redaction-and-deny-layer.md` — redaction as backstop, not sole layer (V0)
4. `04-tool-surface-annotations.md` — annotations + strict schemas (V0)
5. `05-effects-injection-testing.md` — injectable effects + test layering (V0)
6. `06-audit-log.md` — hash-only audit log (V0)
7. `07-blocking-human-in-the-loop.md` — 🔴 the unsolved blocking problem + design (V0)
8. `08-path-policy.md` — traversal/symlink/deny globs (V1, if file tools)
9. `09-config-and-secrets.md` — config + secret handling (V1)
10. `10-transports-and-auth.md` — stdio→HTTP, OAuth (V1+)
11. `11-doctor.md` — WebSocket/clipboard doctor (V1)
12. `12-starter-checklist.md` — the developer's starter checklist + V0 gate

## What the developer's answers + review changed

1. **Drop `structuredContent`** from V0 — repo-harness doesn't use it; keep the
   machine-readable error codes only.
2. **Redaction is defense-in-depth, not the primary control** — the real first
   line is the deny-glob list. Your clipboard flow has no path layer, so redact
   *and* treat output as untrusted.
3. **The human-in-the-loop blocking call is genuinely unsolved upstream** — step
   7 proposes the split `send` + `poll` design, and it's a **decision point
   before main-plan Step 3** (it sets the schema + error codes).
4. **Effects injection is general advice, not a repo-harness copy** —
   repo-harness calls its effects directly in `tools.ts`; injection is still the
   right call for your tests (step 5).
5. **`doctor` promoted to V0** — ~30 lines covering `localhost:55155` + clipboard
   directly de-risks your fragile flow; worth more than the audit log at V0
   (step 11).

A recommended V0 build order (effort vs. value) is in the folder README.
