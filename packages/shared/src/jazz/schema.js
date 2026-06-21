"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const jazz_tools_1 = require("jazz-tools");
// Two-table request/response channel between the MCP server and the browser
// extension. The MCP server inserts a chat_requests row; the extension inserts a
// chat_responses row (the reply text rides in response_text — no clipboard).
const schemaDef = {
    chat_requests: jazz_tools_1.schema.table({
        request_id: jazz_tools_1.schema.string(),
        url: jazz_tools_1.schema.string(),
        text: jazz_tools_1.schema.string(),
        prompt_type: jazz_tools_1.schema.string(),
        status: jazz_tools_1.schema.string(), // 'pending' | 'claimed' | 'done' | 'failed'
        created_at: jazz_tools_1.schema.int() // Date.now()
    }),
    chat_responses: jazz_tools_1.schema.table({
        request_id: jazz_tools_1.schema.string(),
        response_text: jazz_tools_1.schema.string(),
        status: jazz_tools_1.schema.string(), // 'done' | 'error'
        error: jazz_tools_1.schema.string().optional(),
        created_at: jazz_tools_1.schema.int()
    })
};
exports.app = jazz_tools_1.schema.defineApp(schemaDef);
