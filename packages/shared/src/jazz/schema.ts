import { schema as s } from 'jazz-tools'

// Three-table local channel between the MCP server and the browser extension.
//
// chat_requests:
//   MCP server inserts a request.
//
// chat_responses:
//   Browser extension inserts the completed response.
//
// browser_presence:
//   Browser extension inserts heartbeat rows so MCP status can report whether
//   a browser/offscreen Jazz peer is currently alive even before any request has
//   completed.
const schemaDef = {
  chat_requests: s.table({
    request_id: s.string(),
    url: s.string(),
    text: s.string(),
    prompt_type: s.string(),
    status: s.string(), // 'pending' | 'claimed' | 'done' | 'failed'
    created_at: s.float() // Date.now()
  }),

  chat_responses: s.table({
    request_id: s.string(),
    response_text: s.string(),
    status: s.string(), // 'done' | 'error'
    error: s.string().optional(),
    created_at: s.float()
  }),

  browser_presence: s.table({
    browser_id: s.string(),
    status: s.string(), // 'online'
    seen_at: s.float(), // Date.now()
    created_at: s.float()
  })
}

export const app = s.defineApp(schemaDef)
export type App = typeof app

export type ChatRequestRow = s.RowOf<typeof app.chat_requests>
export type ChatResponseRow = s.RowOf<typeof app.chat_responses>
export type BrowserPresenceRow = s.RowOf<typeof app.browser_presence>

export type ChatRequestInsert = s.InsertOf<typeof app.chat_requests>
export type ChatResponseInsert = s.InsertOf<typeof app.chat_responses>
export type BrowserPresenceInsert = s.InsertOf<typeof app.browser_presence>
