export interface MailAddress {
  readonly name: string
  readonly address: string
  readonly initials: string
}

export interface MessageSummary {
  readonly id: string
  readonly threadId: string
  readonly sender: MailAddress
  readonly subject: string
  readonly receivedAt: string
  readonly receivedLabel: string
  readonly receivedFullLabel: string
  readonly preview: string
  readonly unread: boolean
  readonly hasAttachment?: boolean
  readonly accountId?: string
  readonly accountLabel?: string
}

export interface MessageProjection extends MessageSummary {
  readonly body: { readonly kind: 'sanitized-html' | 'plain-text'; readonly content: string }
  readonly attachments: readonly { readonly id: string; readonly name: string; readonly mediaType: string; readonly sizeLabel: string }[]
  readonly source: 'demo' | 'gmail'
}

export interface DraftProjection {
  readonly id: string
  readonly inReplyToMessageId: string
  readonly to: readonly MailAddress[]
  readonly subject: string
  readonly bodyText: string
  readonly state: 'draft'
  readonly accountId?: string
}

export interface AppSummary {
  readonly id: string
  readonly name: string
  readonly isAccessible: boolean
  readonly isEnabled: boolean
}

export interface GmailAccount {
  readonly id: string
  readonly connectorId: string
  readonly name: string
  readonly email: string
}

export type MailStateFilter = 'all' | 'unread' | 'read'

export interface GmailSyncStatus {
  readonly state: 'idle' | 'syncing' | 'partial' | 'ready' | 'failed'
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly error: string | null
  readonly messageCount: number
  readonly accountCount?: number
  readonly accountsCompleted?: number
  readonly pagesFetched?: number
  readonly fetchedMessages?: number
  readonly currentAccount?: string | null
}

export interface ConversationSummary {
  readonly id: string
  readonly threadId: string
  readonly accountId?: string
  readonly accountLabel?: string
  readonly latestMessageId: string
  readonly sender: MailAddress
  readonly subject: string
  readonly receivedAt: string
  readonly receivedLabel: string
  readonly receivedFullLabel: string
  readonly preview: string
  readonly unread: boolean
  readonly messageCount: number
}

export interface ConversationProjection extends ConversationSummary {
  readonly messages: readonly MessageProjection[]
  readonly source: 'demo' | 'gmail'
}
