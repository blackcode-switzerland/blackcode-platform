// A series is addressed by its #number and nothing else. Shared by the two
// `recurrences/[seq]` routes: a route file may export only its handlers.
import { Errors } from '@blackcode/platform-api'

export function seriesSeq(seq: string): number {
  if (!/^\d+$/.test(seq)) {
    throw Errors.badRequest('invalid_recurrence_ref', `${seq} is not a series #number`, 'bk billing recurrence list shows the #number')
  }
  return Number(seq)
}
