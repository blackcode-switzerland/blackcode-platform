// Every word the shared workspace screens print, with English defaults.
//
// ── WHY THE WORDS ARE A PARAMETER ──────────────────────────────────────────
// Four apps render these components and one of them, apps/books, is bilingual:
// its `lib/hardcoded-strings.test.ts` fails the build on a sentence typed into
// JSX, and its dictionary type makes a key with no French a `tsc` error. So the
// components hold no copy of their own that an app cannot replace — an app
// passes `labels` (a partial is merged over these defaults) and books builds
// its object from `t()`. Anything with a name in it is a function, because
// French reorders the sentence around the name.
//
// Product nouns stay the app's: "invoices", "books", "prospects" appear only
// in the `*Detail` strings an app supplies, never here.

export interface WorkspaceLabels {
  // ── switcher ───────────────────────────────────────────────────────────
  workspaces: string
  chooseWorkspace: string
  owner: string
  member: string
  ownedBy: (who: string) => string
  createWorkspace: string
  /** The dropdown's link to the current workspace's settings. */
  manage: string

  // ── create ─────────────────────────────────────────────────────────────
  createTitle: string
  createDescription: string
  nameLabel: string
  namePlaceholder: string
  cancel: string
  creating: string

  // ── settings: general ──────────────────────────────────────────────────
  general: string
  name: string
  slug: string
  slugFixed: string
  yourRole: string
  logo: string
  logoHint: string
  uploadLogo: string
  removeLogo: string
  save: string
  saving: string

  // ── settings: members ──────────────────────────────────────────────────
  members: string
  you: string
  accountClosed: string
  makeOwner: string
  makeOwnerAria: (who: string) => string
  transferTitle: (who: string) => string
  transferDescription: string
  transferConfirm: string
  removeMember: string
  removeMemberAria: (who: string) => string
  removeTitle: (who: string) => string
  removeDescription: string
  removeConfirm: string

  // ── settings: invitations ──────────────────────────────────────────────
  invitations: string
  invitationsDescription: string
  inviteEmailPlaceholder: string
  invite: string
  inviting: string
  colleagues: string
  copy: string
  copyLinkAria: (email: string) => string
  revokeAria: (email: string) => string
  revokeTitle: (email: string) => string
  revokeDescription: string
  revokeConfirm: string
  noInvitations: string
  noInvitationsHint: string
  invitedBy: (who: string) => string
  expires: (date: string) => string

  // ── settings: leave / danger zone ──────────────────────────────────────
  leaveWorkspace: string
  leaveDetail: string
  leaveTitle: (name: string) => string
  leaveDescription: string
  dangerZone: string
  deleteWorkspace: string
  deleteDetail: string
  deleteTitle: (name: string) => string
  deleteDescription: (slug: string) => string
  deleteInputLabel: string
  ownerOnly: string

  // ── accept an invitation ───────────────────────────────────────────────
  joinTitle: (workspace: string) => string
  invitedYou: (inviter: string) => string
  signedInAs: (email: string) => string
  accept: string
  accepting: string
  decline: string

  // ── chooser ────────────────────────────────────────────────────────────
  chooserTitle: string
  chooserDescription: string
}

export const DEFAULT_WORKSPACE_LABELS: WorkspaceLabels = {
  workspaces: 'Workspaces',
  chooseWorkspace: 'Choose a workspace',
  owner: 'Owner',
  member: 'Member',
  ownedBy: (who) => `Owned by ${who}`,
  createWorkspace: 'Create workspace',
  manage: 'Workspace settings',

  createTitle: 'Create workspace',
  createDescription: 'A separate space with its own people. You can invite others once it exists.',
  nameLabel: 'Workspace name',
  namePlaceholder: 'Acme SA',
  cancel: 'Cancel',
  creating: 'Creating…',

  general: 'Workspace',
  name: 'Name',
  slug: 'Slug',
  slugFixed: 'fixed — it is part of every reference this workspace has printed',
  yourRole: 'Your role',
  logo: 'Logo',
  logoHint: 'Square images look best. Shown in the sidebar and the workspace list.',
  uploadLogo: 'Upload logo',
  removeLogo: 'Remove',
  save: 'Save',
  saving: 'Saving…',

  members: 'Members',
  you: '(you)',
  accountClosed: '(account closed)',
  makeOwner: 'Make owner',
  makeOwnerAria: (who) => `Make ${who} the owner`,
  transferTitle: (who) => `Make ${who} the owner?`,
  transferDescription:
    'They take over invitations, member management and deletion. You stay in the workspace as a member, and only they can make you owner again.',
  transferConfirm: 'Transfer ownership',
  removeMember: 'Remove from workspace',
  removeMemberAria: (who) => `Remove ${who}`,
  removeTitle: (who) => `Remove ${who} from this workspace?`,
  removeDescription: 'They lose access immediately. What they created stays, attributed to them.',
  removeConfirm: 'Remove',

  invitations: 'Invitations',
  invitationsDescription:
    'Invitees get an email with a link, and accept it signed in as that address. The link is shown here too.',
  inviteEmailPlaceholder: 'teammate@example.com',
  invite: 'Invite',
  inviting: 'Sending…',
  colleagues: 'People you already work with',
  copy: 'Copy',
  copyLinkAria: (email) => `Copy the invitation link for ${email}`,
  revokeAria: (email) => `Revoke the invitation to ${email}`,
  revokeTitle: (email) => `Revoke the invitation to ${email}?`,
  revokeDescription: 'The link stops working immediately.',
  revokeConfirm: 'Revoke',
  noInvitations: 'No pending invitations',
  noInvitationsHint: 'Invite somebody above.',
  invitedBy: (who) => `invited by ${who}`,
  expires: (date) => `expires ${date}`,

  leaveWorkspace: 'Leave workspace',
  leaveDetail: 'What you created stays in the workspace, attributed to you. The owner can invite you back.',
  leaveTitle: (name) => `Leave ${name}?`,
  leaveDescription: 'You lose access immediately. The owner can invite you back.',
  dangerZone: 'Danger zone',
  deleteWorkspace: 'Delete workspace',
  deleteDetail: 'This permanently deletes the workspace, its members and its invitations.',
  deleteTitle: (name) => `Delete ${name}?`,
  deleteDescription: (slug) =>
    `This permanently deletes the workspace, its members and its invitations. Type ${slug} to confirm.`,
  deleteInputLabel: 'Workspace slug',
  ownerOnly: 'Only the owner can rename this workspace, manage its members, or delete it.',

  joinTitle: (workspace) => `Join ${workspace}`,
  invitedYou: (inviter) => `${inviter} invited you to this workspace.`,
  signedInAs: (email) => `Signed in as ${email}`,
  accept: 'Accept invitation',
  accepting: 'Joining…',
  decline: 'Decline',

  chooserTitle: 'Choose a workspace',
  chooserDescription: 'You belong to more than one. Your choice is remembered for next time.',
}

export function withDefaults(labels?: Partial<WorkspaceLabels>): WorkspaceLabels {
  return labels ? { ...DEFAULT_WORKSPACE_LABELS, ...labels } : DEFAULT_WORKSPACE_LABELS
}
