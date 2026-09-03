export interface MailAddress {
  readonly name: string
  readonly address: string
  readonly initials: string
}

export interface AttachmentProjection {
  readonly id: string
  readonly name: string
  readonly mediaType: string
  readonly sizeLabel: string
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
  readonly accountId?: string
  readonly accountLabel?: string
}

export interface MessageProjection extends MessageSummary {
  readonly body: {
    readonly kind: 'sanitized-html' | 'plain-text'
    readonly content: string
  }
  readonly attachments: readonly AttachmentProjection[]
  readonly source: 'demo' | 'gmail'
}

export interface DraftProjection {
  readonly id: string
  readonly inReplyToMessageId: string
  readonly to: readonly MailAddress[]
  readonly subject: string
  readonly bodyText: string
  readonly state: 'draft'
}
