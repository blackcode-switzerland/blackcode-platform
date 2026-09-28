'use client'

// The shared workspace components' words, in the reader's language.
//
// `@blackcode/platform-ui/workspace/*` prints nothing it was not given (see its
// `labels.ts`), so this is the one place its English defaults are replaced —
// from `lib/dictionary/workspace.ts`, which carries both languages and which
// `tsc` checks for a missing French key.

import { useMemo } from 'react'
import type { WorkspaceLabels } from '@blackcode/platform-ui/workspace/labels'
import { useT } from '@/lib/i18n'

export function useWorkspaceLabels(): WorkspaceLabels {
  const t = useT()
  return useMemo(
    () => ({
      workspaces: t('ws.workspaces'),
      chooseWorkspace: t('ws.chooseWorkspace'),
      owner: t('ws.owner'),
      member: t('ws.member'),
      createWorkspace: t('ws.createWorkspace'),
      manage: (name) => t('ws.manage', { name }),
      createTitle: t('ws.createTitle'),
      createDescription: t('ws.createDescription'),
      nameLabel: t('ws.nameLabel'),
      namePlaceholder: t('ws.namePlaceholder'),
      cancel: t('ws.cancel'),
      creating: t('ws.creating'),
      general: t('ws.general'),
      name: t('ws.name'),
      slug: t('ws.slug'),
      slugFixed: t('ws.slugFixed'),
      yourRole: t('ws.yourRole'),
      logo: t('ws.logo'),
      logoHint: t('ws.logoHint'),
      uploadLogo: t('ws.uploadLogo'),
      removeLogo: t('ws.removeLogo'),
      save: t('ws.save'),
      saving: t('ws.saving'),
      members: t('ws.members'),
      you: t('ws.you'),
      accountClosed: t('ws.accountClosed'),
      makeOwner: t('ws.makeOwner'),
      makeOwnerAria: (who) => t('ws.makeOwnerAria', { who }),
      transferTitle: (who) => t('ws.transferTitle', { who }),
      transferDescription: t('ws.transferDescription'),
      transferConfirm: t('ws.transferConfirm'),
      removeMember: t('ws.removeMember'),
      removeMemberAria: (who) => t('ws.removeMemberAria', { who }),
      removeTitle: (who) => t('ws.removeTitle', { who }),
      removeDescription: t('ws.removeDescription'),
      removeConfirm: t('ws.removeConfirm'),
      invitations: t('ws.invitations'),
      invitationsDescription: t('ws.invitationsDescription'),
      inviteEmailPlaceholder: t('ws.inviteEmailPlaceholder'),
      invite: t('ws.invite'),
      inviting: t('ws.inviting'),
      colleagues: t('ws.colleagues'),
      copy: t('ws.copy'),
      copyLinkAria: (email) => t('ws.copyLinkAria', { email }),
      revokeAria: (email) => t('ws.revokeAria', { email }),
      revokeTitle: (email) => t('ws.revokeTitle', { email }),
      revokeDescription: t('ws.revokeDescription'),
      revokeConfirm: t('ws.revokeConfirm'),
      noInvitations: t('ws.noInvitations'),
      noInvitationsHint: t('ws.noInvitationsHint'),
      invitedBy: (who) => t('ws.invitedBy', { who }),
      expires: (date) => t('ws.expires', { date }),
      leaveWorkspace: t('ws.leaveWorkspace'),
      leaveDetail: t('ws.leaveDetail'),
      leaveTitle: (name) => t('ws.leaveTitle', { name }),
      leaveDescription: t('ws.leaveDescription'),
      dangerZone: t('ws.dangerZone'),
      deleteWorkspace: t('ws.deleteWorkspace'),
      deleteDetail: t('ws.deleteDetail'),
      deleteTitle: (name) => t('ws.deleteTitle', { name }),
      deleteDescription: (slug) => t('ws.deleteDescription', { slug }),
      deleteInputLabel: t('ws.deleteInputLabel'),
      ownerOnly: t('ws.ownerOnly'),
      joinTitle: (workspace) => t('ws.joinTitle', { workspace }),
      invitedYou: (inviter) => t('ws.invitedYou', { inviter }),
      signedInAs: (email) => t('ws.signedInAs', { email }),
      accept: t('ws.accept'),
      accepting: t('ws.accepting'),
      decline: t('ws.decline'),
      chooserTitle: t('ws.chooserTitle'),
      chooserDescription: t('ws.chooserDescription'),
    }),
    [t]
  )
}
