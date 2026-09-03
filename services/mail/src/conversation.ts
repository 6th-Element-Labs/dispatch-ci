import type { ConversationProjection, ConversationSummary, MailStateFilter, MessageProjection, MessageSummary } from './model.js'

function key(message: MessageSummary): string {
  return `${message.accountId ?? 'demo'}:${message.threadId}`
}

export function summarizeConversation(messages: readonly MessageSummary[]): ConversationSummary {
  const ordered = [...messages].sort((left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt))
  const latest = ordered.at(-1)
  if (!latest) throw new Error('Cannot summarize an empty conversation')
  return {
    id: key(latest),
    threadId: latest.threadId,
    accountId: latest.accountId,
    accountLabel: latest.accountLabel,
    latestMessageId: latest.id,
    sender: latest.sender,
    subject: latest.subject,
    receivedAt: latest.receivedAt,
    receivedLabel: latest.receivedLabel,
    receivedFullLabel: latest.receivedFullLabel,
    preview: latest.preview,
    unread: ordered.some((message) => message.unread),
    messageCount: ordered.length,
  }
}

export function groupConversations(messages: readonly MessageSummary[], state: MailStateFilter): readonly ConversationSummary[] {
  const groups = new Map<string, MessageSummary[]>()
  for (const message of messages) {
    const messagesForThread = groups.get(key(message)) ?? []
    messagesForThread.push(message)
    groups.set(key(message), messagesForThread)
  }
  return [...groups.values()]
    .map(summarizeConversation)
    .filter((conversation) => state === 'all' || (state === 'unread' ? conversation.unread : !conversation.unread))
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
}

export function projectConversation(messages: readonly MessageProjection[], source: 'demo' | 'gmail'): ConversationProjection {
  const ordered = [...messages].sort((left, right) => Date.parse(left.receivedAt) - Date.parse(right.receivedAt))
  return { ...summarizeConversation(ordered), messageCount: ordered.length, messages: ordered, source }
}

