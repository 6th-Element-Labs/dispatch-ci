import type { AppSummary, ConversationProjection, ConversationSummary, DraftProjection, GmailAccount, GmailSyncStatus, MailStateFilter, MessageProjection, MessageSummary } from './contracts.js'

const MAIL = 'http://127.0.0.1:8411'
const AGENT = 'http://127.0.0.1:8412'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const endpoint = new URL(url).pathname
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Service request failed at ${endpoint}: ${detail}`)
  }
  const responseText = await response.text()
  let value: unknown
  try {
    value = responseText ? JSON.parse(responseText) as unknown : {}
  } catch {
    throw new Error(`Service returned invalid JSON at ${endpoint} (${response.status})`)
  }
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(value)}`)
  return value as T
}

export const api = {
  async listAccounts(): Promise<GmailAccount[]> {
    const result = await request<{ accounts: GmailAccount[] }>(`${MAIL}/v1/accounts`)
    return result.accounts
  },
  async syncStatus(): Promise<GmailSyncStatus> {
    const result = await request<{ sync: GmailSyncStatus }>(`${MAIL}/v1/sync/status`)
    return result.sync
  },
  async listMessages(accountId?: string): Promise<{ source: 'demo' | 'gmail'; messages: MessageSummary[] }> {
    const query = accountId ? `?account=${encodeURIComponent(accountId)}` : ''
    return request(`${MAIL}/v1/messages${query}`)
  },
  async listConversations(state: MailStateFilter, accountId?: string, cursor?: string, search?: string): Promise<{ source: 'demo' | 'gmail'; conversations: ConversationSummary[]; nextCursor: string | null; total: number }> {
    const params = new URLSearchParams({ state, limit: '100' })
    if (accountId) params.set('account', accountId)
    if (cursor) params.set('cursor', cursor)
    if (search) params.set('q', search)
    return request(`${MAIL}/v1/conversations?${params}`)
  },
  async readConversation(threadId: string, accountId?: string): Promise<ConversationProjection> {
    const query = accountId ? `?account=${encodeURIComponent(accountId)}` : ''
    const result = await request<{ conversation: ConversationProjection }>(`${MAIL}/v1/conversations/${encodeURIComponent(threadId)}${query}`)
    return result.conversation
  },
  async setConversationUnread(threadId: string, accountId: string, unread: boolean): Promise<void> {
    await request(`${MAIL}/v1/conversations/${encodeURIComponent(threadId)}/read-state`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId, unread }),
    })
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
    try { return (await fetch(`${AGENT}/ready`, { signal: AbortSignal.timeout(3_000) })).ok } catch { return false }
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
