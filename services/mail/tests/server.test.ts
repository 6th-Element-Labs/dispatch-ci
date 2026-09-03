import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createMailServer } from '../src/server.js'

const servers: ReturnType<typeof createMailServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function start() {
  const server = createMailServer()
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${port}`
}

describe('dispatch-mail', () => {
  it('exposes health, readiness, and explicit demo projections', async () => {
    const base = await start()
    expect((await fetch(`${base}/health`)).status).toBe(200)
    const ready = await (await fetch(`${base}/ready`)).json()
    expect(ready).toMatchObject({ status: 'ready', provider: 'demo' })
    const list = await (await fetch(`${base}/v1/messages`)).json()
    expect(list.source).toBe('demo')
    expect(list.messages).toHaveLength(3)
  })

  it('creates a draft owned by the mail service', async () => {
    const base = await start()
    const response = await fetch(`${base}/v1/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 'demo-message-opua' }),
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.draft).toMatchObject({ state: 'draft', inReplyToMessageId: 'demo-message-opua' })
  })
})

