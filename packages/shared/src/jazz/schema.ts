import { schema as s } from 'jazz-tools'

// Two-table request/response channel between the MCP server and the browser
// extension. The MCP server inserts a chat_requests row; the extension inserts a
// chat_responses row (the reply text rides in response_text — no clipboard).
const schemaDef = {
  chat_requests: s.table({
    request_id: s.string(),
    url: s.string(),
    text: s.string(),
    prompt_type: s.string(),
    status: s.string(), // 'pending' | 'claimed' | 'done' | 'failed'
    created_at: s.int() // Date.now()
  }),
  chat_responses: s.table({
    request_id: s.string(),
    response_text: s.string(),
    status: s.string(), // 'done' | 'error'
    error: s.string().optional(),
    created_at: s.int()
  })
}

export const app = s.defineApp(schemaDef)
export type App = typeof app

export type ChatRequestRow = s.RowOf<typeof app.chat_requests>
export type ChatResponseRow = s.RowOf<typeof app.chat_responses>
export type ChatRequestInsert = s.InsertOf<typeof app.chat_requests>
export type ChatResponseInsert = s.InsertOf<typeof app.chat_responses>
