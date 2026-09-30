import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { GmailOAuth, type GmailCredential, type GmailCredentialStore } from '../src/gmail-oauth.js'
import type { IndexedGmailAccount } from '../src/gmail-index.js'

const account: IndexedGmailAccount = { id: 'one', email: 'work@example.com', name: 'Work', connectorId: 'gmail' }
const config = { clientId: 'test.apps.googleusercontent.com', clientSecret: 'fixture-client-secret' }
const scope = 'https://www.googleapis.com/auth/gmail.readonly'
const managers: GmailOAuth[] = []
afterEach(() => { managers.splice(0).forEach(manager => manager.stop()); vi.restoreAllMocks() })
function json(value: unknown, status = 200, headers?: HeadersInit) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } }) }
function credential(overrides: Partial<GmailCredential> = {}): GmailCredential {
  return { clientId: config.clientId, email: account.email, scope, accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 600_000, ...overrides }
}
function fixture(handler: (url: string, init?: RequestInit) => Response | Promise<Response>, stored?: GmailCredential) {
  let value = stored
  const write = vi.fn(async (_accountId: string, next: GmailCredential) => { value = next })
  const store: GmailCredentialStore = { read: async () => value, write }
  const fetcher = vi.fn((async (input, init) => handler(String(input), init)) as typeof fetch)
  const onConnected = vi.fn()
  let retryAt = 0
  const manager = new GmailOAuth(config, store, { fetch: fetcher, onConnected, retryAfter: () => retryAt, pauseUntil: (_id, time) => { retryAt = time } })
  managers.push(manager)
  return { manager, store, fetcher, write, onConnected, value: () => value, retryAt: () => retryAt }
}

describe('mail-owned Google authorization', () => {
  it('renews expired tokens once across concurrent reads and preserves refresh grant and scope', async () => {
    const f = fixture(url => url.endsWith('/token') ? json({ access_token: 'renewed', expires_in: 3600 }) : json({ historyId: '200' }), credential({ expiresAt: 0 }))
    await Promise.all([f.manager.get(account, 'history?startHistoryId=100', new AbortController().signal), f.manager.get(account, 'history?startHistoryId=100', new AbortController().signal)])
    expect(f.fetcher.mock.calls.filter(call => String(call[0]).endsWith('/token'))).toHaveLength(1)
    expect(f.value()).toMatchObject({ accessToken: 'renewed', refreshToken: 'fixture-refresh', scope })
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.fetcher.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
  })

  it('retries a rejected read once without replaying any mutation', async () => {
    let reads = 0
    const f = fixture(url => url.endsWith('/token') ? json({ access_token: 'renewed', expires_in: 3600 }) : ++reads === 1 ? json({}, 401) : json({ historyId: '200' }), credential())
    await expect(f.manager.get(account, 'history?startHistoryId=100', new AbortController().signal)).resolves.toEqual({ historyId: '200' })
    expect(reads).toBe(2)
    expect(f.fetcher.mock.calls.filter(call => !String(call[0]).endsWith('/token')).every(call => !call[1]?.method)).toBe(true)
  })

  it('keeps a revoked grant visible and does not repeatedly refresh it', async () => {
    const f = fixture(() => json({ error: 'invalid_grant' }, 400), credential({ expiresAt: 0 }))
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow('oauth_reconnect_required')
    expect(await f.manager.status([account])).toMatchObject({ accounts: [{ state: 'reconnect' }] })
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow('revoked')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    expect(f.write).not.toHaveBeenCalled()
  })

  it('does not discard the stored grant on a temporary token endpoint failure', async () => {
    let failed = true
    const f = fixture(url => url.endsWith('/token') ? failed ? json({ error: 'temporarily_unavailable' }, 503) : json({ access_token: 'renewed', expires_in: 3600 }) : json({ historyId: '200' }), credential({ expiresAt: 0 }))
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow('503')
    expect((await f.manager.status([account])).accounts[0]?.state).toBe('connected')
    failed = false
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).resolves.toEqual({ historyId: '200' })
  })

  it('honors Retry-After even when the rate-limit response has no JSON body', async () => {
    const f = fixture(() => new Response('Busy', { status: 429, headers: { 'retry-after': '600' } }), credential())
    const before = Date.now()
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow('gmail_backoff')
    expect(f.retryAt()).toBeGreaterThanOrEqual(before + 600_000)
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow('gmail_backoff')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects stored authorization belonging to a different email or client', async () => {
    const f = fixture(() => json({}), credential({ email: 'another@example.com' }))
    await expect(f.manager.connected(account)).rejects.toThrow('another account')
    expect(f.fetcher).not.toHaveBeenCalled()
  })

  it('uses PKCE, validates state, verifies the selected Gmail identity, and stores tokens only after validation', async () => {
    let verifier = ''
    const f = fixture((url, init) => {
      if (url.endsWith('/token')) {
        const form = new URLSearchParams(String(init?.body))
        verifier = form.get('code_verifier')!
        expect(form.get('grant_type')).toBe('authorization_code')
        return json({ access_token: 'signed-in', refresh_token: 'offline-grant', expires_in: 3600, scope })
      }
      return json({ emailAddress: account.email, historyId: '100' })
    })
    const start = await f.manager.beginConnect(account)
    const auth = new URL(start.authUrl)
    expect(auth.origin).toBe('https://accounts.google.com')
    expect(auth.searchParams.get('scope')).toBe(scope)
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(f.manager.activeOperations).toBe(1)
    const callback = new URL(auth.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'fixture-code')
    callback.searchParams.set('state', 'wrong-state')
    expect((await fetch(callback)).status).toBe(400)
    expect(f.fetcher).not.toHaveBeenCalled()
    callback.searchParams.set('state', auth.searchParams.get('state')!)
    const response = await fetch(callback)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(auth.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(f.value()).toMatchObject({ email: account.email, accessToken: 'signed-in', refreshToken: 'offline-grant' })
    expect(f.onConnected).toHaveBeenCalledTimes(1)
    expect(await f.manager.connected(account)).toBe(true)
    const status = JSON.stringify(await f.manager.status([account]))
    expect(status).not.toContain('signed-in'); expect(status).not.toContain('offline-grant'); expect(status).not.toContain(config.clientSecret)
  })

  it.each(['wrong account', 'missing scope', 'denied'])('keeps %s sign-in out of the credential store', async kind => {
    const f = fixture(url => url.endsWith('/token') ? json({ access_token: 'signed-in', refresh_token: 'offline-grant', expires_in: 3600, ...(kind !== 'missing scope' ? { scope } : {}) }) : json({ emailAddress: 'another@example.com' }))
    const auth = new URL((await f.manager.beginConnect(account)).authUrl)
    const callback = new URL(auth.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', auth.searchParams.get('state')!)
    callback.searchParams.set(kind === 'denied' ? 'error' : 'code', kind === 'denied' ? 'access_denied' : 'fixture-code')
    expect((await fetch(callback)).status).toBe(400)
    expect(f.write).not.toHaveBeenCalled()
    expect(f.onConnected).not.toHaveBeenCalled()
  })

  it('never substitutes connector sync for a revoked direct authorization', async () => {
    const f = fixture(() => json({ error: 'invalid_grant' }, 400), credential({ expiresAt: 0 }))
    await expect(f.manager.get(account, 'profile', new AbortController().signal)).rejects.toThrow()
    await expect(f.manager.connected(account)).rejects.toThrow('revoked')
  })
})
