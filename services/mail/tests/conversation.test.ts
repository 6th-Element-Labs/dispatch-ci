import { describe, expect, it } from 'vitest'
import { groupConversations, projectConversation } from '../src/conversation.js'
import type { MessageProjection, MessageSummary } from '../src/model.js'

const base: MessageSummary = {
  id: 'm1', threadId: 't1', sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' }, subject: 'Hello',
  receivedAt: '2026-09-04T08:00:00Z', receivedLabel: 'Sep 4, 8:00 AM', receivedFullLabel: 'September 4, 2026 at 8:00 AM',
  preview: 'Hello', unread: false, accountId: 'work', accountLabel: 'work@example.com',
}

describe('conversation projection', () => {
  it('groups by account and Gmail thread, keeping the newest message', () => {
    const conversations = groupConversations([
      base,
      { ...base, id: 'm2', receivedAt: '2026-09-04T09:00:00Z', receivedLabel: 'Sep 4, 9:00 AM', receivedFullLabel: 'September 4, 2026 at 9:00 AM', unread: true },
      { ...base, id: 'm3', accountId: 'personal' },
    ], 'all')
    expect(conversations).toHaveLength(2)
    expect(conversations[0]).toMatchObject({ latestMessageId: 'm2', messageCount: 2, unread: true })
  })

  it('filters read and unread conversations', () => {
    expect(groupConversations([base, { ...base, id: 'm2', threadId: 't2', unread: true }], 'read')).toHaveLength(1)
    expect(groupConversations([base, { ...base, id: 'm2', threadId: 't2', unread: true }], 'unread')).toHaveLength(1)
  })

  it('renders full conversation messages newest first', () => {
    const message = { ...base, body: { kind: 'plain-text' as const, content: 'Hello' }, attachments: [], source: 'gmail' as const }
    const conversation = projectConversation([message, { ...message, id: 'm2', receivedAt: '2026-09-04T09:00:00Z' } satisfies MessageProjection], 'gmail')
    expect(conversation.messages.map((item) => item.id)).toEqual(['m2', 'm1'])
  })
})
