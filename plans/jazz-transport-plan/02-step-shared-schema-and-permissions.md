# Step 2 — Shared schema & permissions

Define the two-table channel and open permissions for the private local link.
This `schema.ts`/`permissions.ts` pair is **shared by both peers** — put it in
`packages/shared` so `apps/mcp-server` and `apps/browser` both import it.

> ⚠️ The exact Jazz schema DSL is alpha; the snippets show the *shape*. Verify
> against the installed `jazz-tools` (`schemas/defining-tables`, `auth/permissions`).

## 2.1 Schema

`packages/shared/src/jazz/schema.ts`:

```ts
import { defineApp, table, column as c } from 'jazz-tools' // confirm import path

export const app = defineApp({
  // MCP server inserts; extension reads & flips status
  chat_requests: table({
    request_id: c.text(),     // correlation id (uuid)
    url: c.text(),            // chatbot URL
    text: c.text(),           // the prompt
    prompt_type: c.text(),    // 'edit-context' etc.
    status: c.text(),         // 'pending' | 'claimed' | 'done' | 'failed'
    created_at: c.number()    // Date.now()
  }),
  // extension inserts; MCP server reads
  chat_responses: table({
    request_id: c.text(),     // matches chat_requests.request_id
    response_text: c.text(),  // THE REPLY — replaces the clipboard
    status: c.text(),         // 'done' | 'error'
    error: c.text().nullable(),
    created_at: c.number()
  })
})

export type App = typeof app
```

## 2.2 Permissions (private local channel → open)

`packages/shared/src/jazz/permissions.ts`:

```ts
import { definePermissions, allow } from 'jazz-tools' // confirm import path
import { app } from './schema.js'

// Private, single-user, localhost channel: both peers may read/write both tables.
// (Tighten later for remote/multi-user — see 10-step-remote-and-hardening.md.)
export default definePermissions(app, {
  chat_requests: {
    read: allow.always(),
    insert: allow.always(),
    update: allow.always(),
    delete: allow.always()
  },
  chat_responses: {
    read: allow.always(),
    insert: allow.always(),
    update: allow.always(),
    delete: allow.always()
  }
})
```

> `allow.always()` is acceptable **only** because this is a private, local,
> single-user channel behind a non-guessable `appId`. For remote/multi-user, scope
> by `$createdBy` / a `user_id` column (Step 10).

## 2.3 Shared message contract (so both peers agree on field names)

`packages/shared/src/jazz/messages.ts`:

```ts
export type ChatRequestRow = {
  id: string
  request_id: string
  url: string
  text: string
  prompt_type: string
  status: 'pending' | 'claimed' | 'done' | 'failed'
  created_at: number
}

export type ChatResponseRow = {
  id: string
  request_id: string
  response_text: string
  status: 'done' | 'error'
  error: string | null
  created_at: number
}
```

## 2.4 Publishing the schema

- **Dev/local:** the Node backend sends its schema on connect; structural
  auto-sync works without an admin secret (the sync server picks up the shape).
- **Prod / migrations:** `pnpm dlx jazz-tools@alpha deploy <appId>` publishes
  schema + permissions + migrations in one step. (Step 10.)

## Done when

- `schema.ts`, `permissions.ts`, `messages.ts` compile in `packages/shared`.
- Both `apps/mcp-server` and `apps/browser` can import `@shared/jazz/schema`.
- (Verified later in Step 6/9 when a real sync server accepts the schema.)
