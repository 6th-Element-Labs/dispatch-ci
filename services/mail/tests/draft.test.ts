import { describe, expect, it } from 'vitest'
import { projectDraft, quoteReplyMarkdown } from '../src/draft.js'
import type { MessageProjection } from '../src/model.js'

const message: MessageProjection = {
  id: 'm2', threadId: 't1', sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' },
  subject: 'Hello', receivedAt: '2026-09-04T10:00:00Z', receivedLabel: 'Sep 4', receivedFullLabel: 'September 4',
  preview: 'Hello', unread: false, body: { kind: 'plain-text', content: 'Please confirm.' },
  attachments: [{ id: 'a1', name: 'note.pdf', mediaType: 'application/pdf', sizeLabel: '12 KB' }],
  source: 'gmail',
}

describe('draft helpers', () => {
  it('projects Markdown and derived HTML with bodyText alias', () => {
    const draft = projectDraft({
      id: 'd1', inReplyToMessageId: 'm2', to: [message.sender], cc: '', bcc: '',
      subject: 'Re: Hello', bodyMarkdown: '**Thanks**', attachments: [], accountId: 'link-one',
    })
    expect(draft.bodyText).toBe('**Thanks**')
    expect(draft.bodyHtml).toContain('<strong>Thanks</strong>')
  })

  it('quotes the source message as Markdown', () => {
    expect(quoteReplyMarkdown(message)).toBe('\n\n> Please confirm.')
  })
})
