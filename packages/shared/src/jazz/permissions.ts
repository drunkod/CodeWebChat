import { schema as s } from 'jazz-tools'
import { app } from './schema.js'

// Private, single-user, localhost channel: both peers may read/write both tables.
// `.always()` is acceptable ONLY because this is a private local channel behind a
// non-guessable appId. For remote/multi-user, scope by $createdBy / a user_id
// column (see plans/jazz-transport-plan/10-step-remote-and-hardening.md).
export default s.definePermissions(app, ({ policy }) => {
  policy.chat_requests.allowRead.always()
  policy.chat_requests.allowInsert.always()
  policy.chat_requests.allowUpdate.always()
  policy.chat_requests.allowDelete.always()

  policy.chat_responses.allowRead.always()
  policy.chat_responses.allowInsert.always()
  policy.chat_responses.allowUpdate.always()
  policy.chat_responses.allowDelete.always()
})
