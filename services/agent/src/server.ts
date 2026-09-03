import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { CodexProcess } from './codex-process.js'
import type { RpcMessage } from './json-line-rpc.js'

interface AgentRuntime {
  ready(): Promise<void>
  lastError(): string | null
  request(method: string, params?: unknown): Promise<unknown>
  subscribe(listener: (message: RpcMessage) => void): () => void
  close(): void
}

function headers(contentType = 'application/json; charset=utf-8') {
  return {
    'content-type': contentType,
    'access-control-allow-origin': 'http://127.0.0.1:8410',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, headers())
  response.end(JSON.stringify(value))
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  if (chunks.length === 0) return {}
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be an object')
  return value as Record<string, unknown>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function installedApps(value: unknown): readonly Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return []
  const container = value as { apps?: unknown; data?: unknown }
  const apps = container.apps ?? container.data
  return Array.isArray(apps) ? apps.filter((app): app is Record<string, unknown> => Boolean(app) && typeof app === 'object') : []
}

async function readApps(runtime: AgentRuntime): Promise<unknown> {
  try {
    return await runtime.request('app/installed', { forceRefresh: false })
  } catch (error) {
    if (!errorMessage(error).includes('unknown variant `app/installed`')) throw error
    return runtime.request('app/list', { cursor: null, limit: 20, forceRefetch: false })
  }
}

export function createAgentServer(runtime: AgentRuntime) {
  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') return json(response, 204, {})
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')

    if (request.method === 'GET' && url.pathname === '/health') {
      return json(response, 200, { service: 'dispatch-agent', status: 'healthy', appServerError: runtime.lastError() })
    }
    if (request.method === 'GET' && url.pathname === '/ready') {
      try {
        await runtime.ready()
        return json(response, 200, { service: 'dispatch-agent', status: 'ready', harness: 'codex-app-server' })
      } catch (error) {
        return json(response, 503, { service: 'dispatch-agent', status: 'not_ready', error: errorMessage(error) })
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/account') {
      try {
        return json(response, 200, await runtime.request('account/read', { refreshToken: false }))
      } catch (error) {
        return json(response, 502, { error: 'app_server_request_failed', detail: errorMessage(error) })
      }
    }
    if (request.method === 'GET' && url.pathname === '/v1/apps') {
      try {
        const result = await readApps(runtime)
        const data = installedApps(result).map((app) => ({
          id: String(app.id ?? ''),
          name: String(app.runtimeName ?? app.name ?? app.id ?? ''),
          isAccessible: Boolean(app.callable ?? app.isAccessible),
          isEnabled: Boolean(app.enabled ?? app.isEnabled),
          callable: Boolean(app.callable ?? (app.isAccessible && app.isEnabled)),
        }))
        return json(response, 200, { data })
      } catch (error) {
        return json(response, 502, { error: 'app_server_request_failed', detail: errorMessage(error) })
      }
    }
    if (request.method === 'POST' && url.pathname === '/v1/threads') {
      try {
        return json(response, 201, await runtime.request('thread/start', {
          cwd: process.cwd(),
          approvalPolicy: 'on-request',
          sandboxPolicy: { type: 'readOnly', access: { type: 'restricted', includePlatformDefaults: true, readableRoots: [] } },
          serviceName: 'dispatch-agent',
        }))
      } catch (error) {
        return json(response, 502, { error: 'app_server_request_failed', detail: errorMessage(error) })
      }
    }

    const turnMatch = /^\/v1\/threads\/([^/]+)\/turns$/.exec(url.pathname)
    if (request.method === 'POST' && turnMatch?.[1]) {
      try {
        const payload = await body(request)
        const text = typeof payload.text === 'string' ? payload.text.trim() : ''
        if (!text) return json(response, 400, { error: 'text_required' })
        const input: Array<Record<string, unknown>> = []
        const mailContext = payload.mailContext
        const context = mailContext && typeof mailContext === 'object'
          ? `\n\nSelected email context supplied by Dispatch UI: ${JSON.stringify(mailContext)}`
          : ''
        input.push({ type: 'text', text: `${text}${context}` })
        if (typeof payload.appId === 'string' && payload.appId) {
          input.push({ type: 'mention', name: 'Gmail', path: `app://${payload.appId}` })
        }
        return json(response, 202, await runtime.request('turn/start', {
          threadId: decodeURIComponent(turnMatch[1]),
          input,
          approvalPolicy: 'on-request',
        }))
      } catch (error) {
        return json(response, 502, { error: 'app_server_request_failed', detail: errorMessage(error) })
      }
    }

    if (request.method === 'GET' && url.pathname === '/v1/events') {
      const threadId = url.searchParams.get('threadId')
      if (!threadId) return json(response, 400, { error: 'threadId_required' })
      response.writeHead(200, {
        ...headers('text/event-stream; charset=utf-8'),
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.write(': connected\n\n')
      const unsubscribe = runtime.subscribe((message) => {
        const params = message.params as { threadId?: string } | undefined
        if (params?.threadId && params.threadId !== threadId) return
        response.write(`data: ${JSON.stringify(message)}\n\n`)
      })
      request.on('close', unsubscribe)
      return
    }

    return json(response, 404, { error: 'not_found' })
  })
}

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url)
if (isEntrypoint) {
  const runtime = new CodexProcess()
  const server = createAgentServer(runtime)
  const port = Number(process.env.DISPATCH_AGENT_PORT ?? 8412)
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`dispatch-agent listening on http://127.0.0.1:${port}\n`)
  })
  const close = () => {
    server.close()
    runtime.close()
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}
