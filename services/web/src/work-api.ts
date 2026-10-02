declare const __DISPATCH_LOCAL_PROXY__: boolean;
const base = typeof __DISPATCH_LOCAL_PROXY__ !== 'undefined' && __DISPATCH_LOCAL_PROXY__ ? `${location.origin}/work` : 'http://127.0.0.1:8413';
export interface WorkSource {
    id: string;
    kind: 'email' | 'codex';
    accountId: string;
    threadId: string;
    messageId: string;
    codexThreadId?: string;
    turnId?: string;
    title: string;
    at: string;
    author: string;
    text: string;
    participants: string[];
}
export interface WorkItem {
    id: string;
    accountId: string;
    kind: 'task' | 'decision';
    title: string;
    summary: string;
    topic: string;
    topicId: string;
    contacts: string[];
    owner: string | null;
    due: string | null;
    status: string;
    certainty: 'explicit' | 'suggested';
    snoozedUntil: string | null;
    revision: number;
    reason?: string;
    evidence: {
        source: WorkSource;
        quote: string;
    }[];
}
export interface WorkView {
    items: WorkItem[];
    decisions: WorkItem[];
    people: string[];
    topics: {
        id: string;
        name: string;
        accountId: string;
    }[];
    scan: {
        enabled: boolean;
        running: boolean;
        scanned: number;
        total: number;
        depth: number;
        lastScan: string | null;
        error: string | null;
        failures: number;
    };
}
export type WorkContext = {
    kind: 'contact' | 'topic';
    accountId: string;
    contextId: string;
};
async function request<T>(path: string, body?: unknown): Promise<T> { const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(path.includes('/analyze') ? 190000 : 8000) }); const value = await response.json(); if (!response.ok)
    throw new Error(value.detail ?? value.error ?? 'Work is unavailable'); return value as T; }
export const workApi = { list: (params: URLSearchParams) => request<WorkView>(`/v1/work?${params}`), action: (item: WorkItem, patch: Record<string, unknown>) => request<{
        item: WorkItem;
    }>(`/v1/work/items/${item.id}`, { revision: item.revision, ...patch }), pause: () => request('/v1/work/pause', {}), scan: (more = false) => request('/v1/work/scan', { more }), analyze: (accountId: string, threadId: string) => request<WorkView>('/v1/work/analyze', { accountId, threadId }) };
