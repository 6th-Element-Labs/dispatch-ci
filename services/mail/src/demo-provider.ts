import { groupConversations, projectConversation } from './conversation.js'
import { projectDraft } from './draft.js'
import type { ConversationProjection, ConversationSummary, DraftProjection, MailStateFilter, MessageProjection, MessageSummary } from './model.js'

const messages: readonly MessageProjection[] = [
  {
    id: 'demo-message-opua',
    threadId: 'demo-thread-opua',
    sender: { name: 'Ana Morales', address: 'ana@opuamarina.example', initials: 'AM' },
    subject: 'Opua berth confirmation',
    receivedAt: '2026-09-04T09:42:00+12:00',
    receivedLabel: 'Sep 4, 9:42 AM',
    receivedFullLabel: 'September 4, 2026 at 9:42 AM',
    preview: 'The quarantine berth is confirmed for your expected arrival…',
    unread: true,
    body: {
      kind: 'sanitized-html',
      content: '<p><strong>Hi Steve,</strong></p><p>The quarantine berth is confirmed for your expected arrival on 18 September. Please call the marina on VHF 73 before entering the basin.</p><p>I have attached the arrival instructions. The berth assignment can still change if your arrival time moves by more than six hours.</p><p>Regards,<br>Ana</p>',
    },
    attachments: [
      { id: 'demo-attachment-opua', name: 'Opua arrival instructions.pdf', mediaType: 'application/pdf', sizeLabel: '824 KB' },
    ],
    source: 'demo',
  },
  {
    id: 'demo-message-contract',
    threadId: 'demo-thread-contract',
    sender: { name: 'James Liu', address: 'james@acme.example', initials: 'JL' },
    subject: 'Re: Services agreement',
    receivedAt: '2026-09-04T08:16:00+12:00',
    receivedLabel: 'Sep 4, 8:16 AM',
    receivedFullLabel: 'September 4, 2026 at 8:16 AM',
    preview: 'I added our comments to sections 4 and 7. The pricing schedule…',
    unread: true,
    body: {
      kind: 'sanitized-html',
      content: '<p><strong>Steve,</strong></p><p>I added our comments to sections 4 and 7. The pricing schedule is acceptable, subject to the revised service-credit cap.</p><p>Can you confirm that the September 15 start date still works?</p><p>Best,<br>James</p>',
    },
    attachments: [
      { id: 'demo-attachment-contract', name: 'Services agreement redline.docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeLabel: '146 KB' },
    ],
    source: 'demo',
  },
  {
    id: 'demo-message-invoice',
    threadId: 'demo-thread-invoice',
    sender: { name: 'OpenInvoice', address: 'notifications@openinvoice.example', initials: 'OP' },
    subject: 'Invoice status update',
    receivedAt: '2026-09-03T16:31:00+12:00',
    receivedLabel: 'Sep 3, 4:31 PM',
    receivedFullLabel: 'September 3, 2026 at 4:31 PM',
    preview: 'Invoice TKN-2026-0001 has moved to the next review stage…',
    unread: false,
    body: {
      kind: 'sanitized-html',
      content: '<p>Invoice <strong>TKN-2026-0001</strong> has moved to the next review stage.</p><p>No action is required from you at this time.</p>',
    },
    attachments: [],
    source: 'demo',
  },
]

export class DemoMailProvider {
  readonly #drafts = new Map<string, DraftProjection>()

  listMessages(): readonly MessageSummary[] {
    return messages.map(({ body: _body, attachments: _attachments, source: _source, ...summary }) => summary)
  }

  readMessage(id: string): MessageProjection | undefined {
    return messages.find((message) => message.id === id)
  }

  listConversations(state: MailStateFilter): readonly ConversationSummary[] {
    return groupConversations(messages, state)
  }

  readConversation(threadId: string): ConversationProjection | undefined {
    const thread = messages.filter((message) => message.threadId === threadId)
    return thread.length > 0 ? projectConversation(thread, 'demo') : undefined
  }

  createDraft(messageId: string, fields?: { bodyMarkdown?: string }): DraftProjection | undefined {
    const message = this.readMessage(messageId)
    if (!message) return undefined
    const defaultBodyMarkdown = `Hi ${message.sender.name.split(' ')[0] ?? message.sender.name},\n\nThank you.\n\nRegards,\nSteve`
    const bodyMarkdown = typeof fields?.bodyMarkdown === 'string' ? fields.bodyMarkdown : defaultBodyMarkdown
    const draft = projectDraft({
      id: `demo-draft-${message.id}`,
      inReplyToMessageId: message.id,
      to: [message.sender],
      subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
      bodyMarkdown,
    })
    this.#drafts.set(draft.id, draft)
    return draft
  }

  readDraft(draftId: string): DraftProjection | undefined {
    return this.#drafts.get(draftId)
  }

  discardDraft(draftId: string): boolean {
    return this.#drafts.delete(draftId)
  }
}
