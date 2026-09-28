// The `bk books` spellings the workspace screens print beside their controls.
//
// COMMANDS, not copy: never translated (a French sentence containing a flag
// that does not exist is worse than an English command inside a French
// sentence), so they live here rather than in `lib/dictionary/`. Kept out of
// the components for a second reason: `lib/hardcoded-strings.test.ts` reads JSX
// by looking between `>` and `<`, and two `<user_id>` placeholders a line apart
// in a component look to it like a sentence between two tags.

export const WORKSPACE_CLI = {
  memberList: 'bk books member list',
  memberRemove: 'bk books member remove <user_id>',
  transfer: 'bk books workspace transfer --to <user_id>',
  inviteSend: 'bk books invite send <email>',
  inviteAccept: 'bk books invite accept <token>',
  leave: (userId: number) => `bk books member remove ${userId}`,
  delete: (slug: string) => `bk books workspace delete ${slug} --confirm ${slug}`,
} as const
