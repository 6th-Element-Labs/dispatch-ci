import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { JsonLineRpc, type RpcMessage } from './json-line-rpc.js'

export class CodexProcess {
  readonly #process: ChildProcessWithoutNullStreams
  readonly #rpc: JsonLineRpc
  readonly #ready: Promise<void>
  #lastError: string | null = null

  constructor(command = process.env.DISPATCH_CODEX_COMMAND ?? 'codex') {
    this.#process = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.#rpc = new JsonLineRpc(this.#process.stdin)
    const lines = readline.createInterface({ input: this.#process.stdout })
    lines.on('line', (line) => this.#rpc.acceptLine(line))
    this.#process.stderr.on('data', (chunk) => {
      this.#lastError = String(chunk).trim().slice(-1000)
    })
    this.#process.on('exit', (code, signal) => {
      const reason = new Error(`Codex App Server exited (${code ?? signal ?? 'unknown'})`)
      this.#lastError = reason.message
      this.#rpc.rejectAll(reason)
    })
    this.#ready = this.#initialize()
  }

  async #initialize(): Promise<void> {
    await this.#rpc.request('initialize', {
      clientInfo: { name: 'dispatch', title: 'Dispatch', version: '0.1.0' },
      capabilities: { mcpServerOpenaiFormElicitation: true },
    })
    this.#rpc.notify('initialized', {})
  }

  async ready(): Promise<void> {
    await this.#ready
  }

  lastError(): string | null {
    return this.#lastError
  }

  subscribe(listener: (message: RpcMessage) => void): () => void {
    return this.#rpc.subscribe(listener)
  }

  async request(method: string, params: unknown = {}): Promise<unknown> {
    await this.ready()
    return this.#rpc.request(method, params)
  }

  close(): void {
    this.#process.kill('SIGTERM')
  }
}

