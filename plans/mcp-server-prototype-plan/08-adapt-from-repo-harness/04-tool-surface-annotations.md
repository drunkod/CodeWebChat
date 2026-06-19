# Step 4 — Small tool surface, annotations, strict schemas (V0)

**Source:** `draft/src/cli/mcp/tools.ts:379-499` (annotations + tool defs +
`additionalProperties: false`).

## Developer's answer

> "MCP tools should be designed by **user intent**, not by exposing low-level
> operations." Annotations (`readOnlyHint`, `openWorldHint`, `destructiveHint`)
> are used on every tool and "ChatGPT honored the distinction — it prompted for
> confirmation on write tools." `additionalProperties: false` on every input
> schema "rejects unknown fields and provides forward-compat protection."

## Source example

```ts
const readOnly = { readOnlyHint: true,  openWorldHint: false };
const write    = { readOnlyHint: false, openWorldHint: false, destructiveHint: false };

const tools = [
  { name: 'harness_status', description: '...', inputSchema: EMPTY_SCHEMA, annotations: readOnly },
  { name: 'write_prd',      description: '...', inputSchema: markdownWriterSchema, annotations: write },
  // ...
];

// every schema:
const ideaPrdSchema = {
  type: 'object',
  properties: { title: { type: 'string' }, /* ... */ },
  required: ['title', 'slug', 'idea'],
  additionalProperties: false,   // <- forward-compat guard
};
```

Note their tool surface is ~17 narrow tools, but each maps to one intent. They
also kept a raw-body `write_prd` *and* a structured `write_prd_from_idea`; the
developer said the raw variants are the ones he'd **drop** — structured schemas
produce better model output. Lesson: prefer a typed schema over a free-form
`body`.

## Adapt to `cwc-mcp-server`

Keep your two V0 tools, add annotations + strict schemas:

```ts
server.tool(
  'cwc_status',
  'Report CodeWebChat bridge status: WebSocket connection, registered editor/browser clients.',
  { /* no inputs */ },
  { readOnlyHint: true, openWorldHint: true }, // openWorld: it observes external state
  async () => textResult(await bridge.status()),
)

server.tool(
  'send_to_codewebchat',
  'Send a prompt to a CodeWebChat-supported chatbot and return the reply after the user clicks Apply Response.',
  {
    type: 'object',
    properties: {
      prompt:  { type: 'string', minLength: 1 },
      chatbot: { type: 'string', enum: ['chatgpt', 'gemini', 'claude'] },
      timeout_ms: { type: 'number', minimum: 5000, maximum: 600000 },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  { readOnlyHint: false, openWorldHint: true, destructiveHint: false },
  async (args) => /* step 7 */,
)
```

If you use the high-level `McpServer` + zod (your Step 3), express the same with
`z.object({...}).strict()` — `.strict()` is the zod equivalent of
`additionalProperties: false`.

## Developer's tool-granularity lesson

> "The signal that a tool is wrong: the model consistently sends malformed input
> or the E2E needs multiple correction rounds." Watch for that as you grow past
> two tools; split a tool when one schema is trying to serve two intents.

## Checklist

- [ ] Every tool annotated (`readOnlyHint` at minimum).
- [ ] Every input schema has `additionalProperties: false` / `.strict()`.
- [ ] Enums for closed choices (`chatbot`).
- [ ] Prefer typed fields over a free-form `body`.
