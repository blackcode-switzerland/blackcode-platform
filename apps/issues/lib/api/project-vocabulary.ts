// Maps the project query layer's vocabulary errors to a 400 that NAMES the
// accepted values.
//
// It lives here rather than inline in each route because there are two routes
// (POST …/projects and PATCH …/projects/{id}) and the message is the load-
// bearing part: the whole point of the fix is that `--priority urgent` used to
// SUCCEED and write a string nothing could read, so the refusal has to say what
// would have worked instead. Two copies of that message is how the next one
// drifts. See lib/db/queries/projects.ts → assertProjectVocabulary.
//
// Anything that is not a vocabulary error is returned unchanged, so a caller
// can `throw projectVocabularyError(err)` unconditionally.

import { Errors } from '@blackcode/platform-api'
import { PROJECT_PRIORITY_VALUES, PROJECT_STATUS_VALUES } from '@/lib/work-items'

export function projectVocabularyError(err: unknown): unknown {
  const m = (err as Error)?.message
  if (m === 'invalid_status') {
    return Errors.badRequest(
      'invalid_status',
      `status must be one of: ${PROJECT_STATUS_VALUES.join(', ')}`
    )
  }
  if (m === 'invalid_priority') {
    return Errors.badRequest(
      'invalid_priority',
      `priority must be one of: ${PROJECT_PRIORITY_VALUES.join(', ')}`,
      'P0 is the highest — P0=Urgent, P1=High, P2=Medium, P3=Low, P4=No priority'
    )
  }
  return err
}
