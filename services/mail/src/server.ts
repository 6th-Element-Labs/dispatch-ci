import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { DemoMailProvider } from './demo-provider.js'
import { GmailConnectorProvider } from './gmail-provider.js'

const provider = new DemoMailProvider()

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://127.0.0.1:8410',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

export function createMailServer(gmail = new GmailConnectorProvider()) {
  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') return writeJson(response, 204, {})
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && url.pathname === '/health') {
      return writeJson(response, 200, { service: 'dispatch-mail', status: 'healthy' })
    }
    if (request.method === 'GET' && url.pathname === '/ready') {
      return writeJson(response, 200, { service: 'dispatch-mail', status: 'ready', provider: 'demo' })
    }
    if (request.method === 'GET' && url.pathname === '/v1/messages') {
      const accountId = url.searchParams.get('account')
      if (accountId) {
        try {
          return writeJson(response, 200, { source: 'gmail', messages: await gmail.listMessages(accountId) })
        } catch (error) {
          return writeJson(response, 502, { error: 'gmail_list_failed', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      return writeJson(response, 200, { source: 'demo', messages: provider.listMessages() })
    }
    if (request.method === 'GET' && url.pathname === '/v1/accounts') {
      try {
        return writeJson(response, 200, { accounts: await gmail.accounts() })
      } catch (error) {
        return writeJson(response, 502, { error: 'gmail_accounts_failed', detail: error instanceof Error ? error.message : String(error) })
      }
    }
    const messageMatch = /^\/v1\/messages\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && messageMatch?.[1]) {
      const accountId = url.searchParams.get('account')
      if (accountId) {
        try {
          return writeJson(response, 200, { message: await gmail.readMessage(accountId, decodeURIComponent(messageMatch[1])) })
        } catch (error) {
          return writeJson(response, 502, { error: 'gmail_read_failed', detail: error instanceof Error ? error.message : String(error) })
        }
      }
      const message = provider.readMessage(decodeURIComponent(messageMatch[1]))
      return message ? writeJson(response, 200, { message }) : writeJson(response, 404, { error: 'message_not_found' })
    }
    if (request.method === 'POST' && url.pathname === '/v1/drafts') {
      try {
        const body = await readJson(request)
        const messageId = typeof body === 'object' && body !== null && 'messageId' in body ? String(body.messageId) : ''
        const draft = provider.createDraft(messageId)
        return draft ? writeJson(response, 201, { draft }) : writeJson(response, 404, { error: 'message_not_found' })
      } catch {
        return writeJson(response, 400, { error: 'invalid_json' })
      }
    }
    return writeJson(response, 404, { error: 'not_found' })
  })
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  const port = Number(process.env.DISPATCH_MAIL_PORT ?? 8411)
  createMailServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`dispatch-mail ready on http://127.0.0.1:${port}\n`)
  })
}
