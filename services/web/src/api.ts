import type { AppSummary, DraftProjection, MessageProjection, MessageSummary } from './contracts.js'

const MAIL = 'http://127.0.0.1:8411'
const AGENT = 'http://127.0.0.1:8412'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as unknown
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(value)}`)
  return value as T
}

export const api = {
  async listMessages(): Promise<{ source: 'demo' | 'gmail'; messages: MessageSummary[] }> {
    return request(`${MAIL}/v1/messages`)
  },
  async readMessage(id: string): Promise<MessageProjection> {
    const result = await request<{ message: MessageProjection }>(`${MAIL}/v1/messages/${encodeURIComponent(id)}`)
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
  async startTurn(threadId: string, payload: Record<string, unknown>): Promise<void> {
    await request(`${AGENT}/v1/threads/${encodeURIComponent(threadId)}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
  },
  events(threadId: string): EventSource {
    return new EventSource(`${AGENT}/v1/events?threadId=${encodeURIComponent(threadId)}`)
  },
}

