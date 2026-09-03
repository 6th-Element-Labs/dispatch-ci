import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { JsonLineRpc, type RpcMessage } from './json-line-rpc.js'

export class CodexProcess {
  readonly #command: string
  readonly #listeners = new Set<(message: RpcMessage) => void>()
  #process: ChildProcessWithoutNullStreams | undefined
  #rpc: JsonLineRpc | undefined
  #ready: Promise<void>
  #lastError: string | null = null
  #restartTimer: NodeJS.Timeout | undefined
  #closed = false
  #startedOnce = false

  constructor(command = process.env.DISPATCH_CODEX_COMMAND ?? 'codex') {
    this.#command = command
    this.#ready = this.#launch()
  }

  async #launch(): Promise<void> {
    const process = spawn(this.#command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const rpc = new JsonLineRpc(process.stdin)
    this.#process = process
    this.#rpc = rpc
    rpc.subscribe((message) => this.#listeners.forEach((listener) => listener(message)))
    const lines = readline.createInterface({ input: process.stdout })
    lines.on('line', (line) => rpc.acceptLine(line))
    process.stderr.on('data', (chunk) => {
      this.#lastError = String(chunk).trim().slice(-1000)
    })
    process.on('exit', (code, signal) => {
      const reason = new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`)
      this.#lastError = reason.message
      rpc.rejectAll(reason)
      if (this.#process !== process || this.#closed) return
      this.#listeners.forEach((listener) => listener({ method: 'dispatch/appServerDisconnected', params: { reason: reason.message } }))
      this.#ready = new Promise<void>((resolve, reject) => {
        this.#restartTimer = setTimeout(() => {
          this.#restartTimer = undefined
          this.#launch().then(resolve, reject)
        }, 500)
      })
    })
    await rpc.request('initialize', {
      clientInfo: { name: 'dispatch', title: 'Dispatch', version: '0.1.0' },
      capabilities: { mcpServerOpenaiFormElicitation: true },
    })
    rpc.notify('initialized', {})
    this.#lastError = null
    const reconnected = this.#startedOnce
    this.#startedOnce = true
    if (reconnected) this.#listeners.forEach((listener) => listener({ method: 'dispatch/appServerReconnected', params: {} }))
  }

  async ready(): Promise<void> {
    await this.#ready
  }

  lastError(): string | null {
    return this.#lastError
  }

  subscribe(listener: (message: RpcMessage) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    await this.ready()
    if (!this.#rpc) throw new Error('Codex App Server transport is unavailable')
    return this.#rpc.request(method, params)
  }

  respond(id: number | string, result: unknown): void {
    if (!this.#rpc) throw new Error('Codex App Server transport is unavailable')
    this.#rpc.respond(id, result)
  }

  close(): void {
    this.#closed = true
    if (this.#restartTimer) clearTimeout(this.#restartTimer)
    this.#process?.kill('SIGTERM')
  }
}
