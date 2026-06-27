import { schema as s } from 'jazz-tools'
import { app } from './schema.js'

// Private, single-user, localhost channel: both peers may read/write all local
// transport tables.
//
// `.always()` is acceptable ONLY because this is a private local channel behind
// a non-guessable appId. For remote/multi-user, scope by $createdBy / user_id.
export default s.definePermissions(app, ({ policy }) => {
  policy.chat_requests.allowRead.always()
  policy.chat_requests.allowInsert.always()
  policy.chat_requests.allowUpdate.always()
  policy.chat_requests.allowDelete.always()

  policy.chat_responses.allowRead.always()
  policy.chat_responses.allowInsert.always()
  policy.chat_responses.allowUpdate.always()
  policy.chat_responses.allowDelete.always()

  policy.browser_presence.allowRead.always()
  policy.browser_presence.allowInsert.always()
  policy.browser_presence.allowUpdate.always()
  policy.browser_presence.allowDelete.always()
})
