import type { AppSummary, ConversationProjection, ConversationSummary, DraftProjection, GmailAccount, MailStateFilter, MessageProjection, MessageSummary } from './contracts.js'

const MAIL = 'http://127.0.0.1:8411'
const AGENT = 'http://127.0.0.1:8412'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as unknown
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(value)}`)
  return value as T
}

export const api = {
  async listAccounts(): Promise<GmailAccount[]> {
    const result = await request<{ accounts: GmailAccount[] }>(`${MAIL}/v1/accounts`)
    return result.accounts
  },
  async listMessages(accountId?: string): Promise<{ source: 'demo' | 'gmail'; messages: MessageSummary[] }> {
    const query = accountId ? `?account=${encodeURIComponent(accountId)}` : ''
    return request(`${MAIL}/v1/messages${query}`)
  },
  async listConversations(state: MailStateFilter, accountId?: string): Promise<{ source: 'demo' | 'gmail'; conversations: ConversationSummary[] }> {
    const params = new URLSearchParams({ state })
    if (accountId) params.set('account', accountId)
    return request(`${MAIL}/v1/conversations?${params}`)
  },
  async readConversation(threadId: string, accountId?: string): Promise<ConversationProjection> {
    const query = accountId ? `?account=${encodeURIComponent(accountId)}` : ''
    const result = await request<{ conversation: ConversationProjection }>(`${MAIL}/v1/conversations/${encodeURIComponent(threadId)}${query}`)
    return result.conversation
  },
  async readMessage(id: string, accountId?: string): Promise<MessageProjection> {
    const query = accountId ? `?account=${encodeURIComponent(accountId)}` : ''
    const result = await request<{ message: MessageProjection }>(`${MAIL}/v1/messages/${encodeURIComponent(id)}${query}`)
    return result.message
  },
  async createDraft(messageId: string): Promise<DraftProjection> {
    const result = await request<{ draft: DraftProjection }>(`${MAIL}/v1/drafts`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId }),
    })
    return result.draft
  },
  async agentReady(): Promise<boolean> {
    try { return (await fetch(`${AGENT}/ready`)).ok } catch { return false }
  },
  async listApps(): Promise<AppSummary[]> {
    const result = await request<{ data?: AppSummary[] }>(`${AGENT}/v1/apps`)
    return result.data ?? []
  },
  async startThread(): Promise<string> {
    const result = await request<{ thread: { id: string } }>(`${AGENT}/v1/threads`, { method: 'POST' })
    return result.thread.id
  },
  async resumeThread(threadId: string): Promise<string> {
    const result = await request<{ thread: { id: string } }>(`${AGENT}/v1/threads/${encodeURIComponent(threadId)}/resume`, { method: 'POST' })
    return result.thread.id
  },
  async startTurn(threadId: string, payload: Record<string, unknown>): Promise<void> {
    await request(`${AGENT}/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
  },
  events(threadId: string): EventSource {
    return new EventSource(`${AGENT}/v1/events?threadId=${encodeURIComponent(threadId)}`)
  },
  async respondToServerRequest(id: number | string, result: unknown): Promise<void> {
    await request(`${AGENT}/v1/server-requests/respond`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, result }),
    })
  },
}
