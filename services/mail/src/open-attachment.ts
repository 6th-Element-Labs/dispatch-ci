import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'

export interface OpenAttachmentInput {
  readonly messageId: string
  readonly attachmentId: string
  readonly filename: string
  readonly payload: unknown
  readonly cacheDir: string
  readonly openPath: (path: string) => Promise<void>
}

export interface OpenedAttachment {
  readonly path: string
  readonly filename: string
}

export function defaultAttachmentCacheDir(): string {
  if (process.env.DISPATCH_ATTACHMENT_CACHE) return process.env.DISPATCH_ATTACHMENT_CACHE
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'Dispatch', 'attachments')
  return join(homedir(), '.cache', 'dispatch', 'attachments')
}

export function defaultOpenPath(path: string): Promise<void> {
  const { command, args } = nativeOpenCommand(path)
  return new Promise((resolveOpen, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolveOpen()
      else reject(new Error(`The default app failed to open ${path} (exit ${code ?? 'null'})`))
    })
  })
}

export function nativeOpenCommand(path: string): { command: string; args: string[] } {
  if (process.platform === 'darwin') return { command: 'open', args: [path] }
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', path] }
  return { command: 'xdg-open', args: [path] }
}

export async function openAttachmentFile(input: OpenAttachmentInput): Promise<OpenedAttachment> {
  const filename = safeAttachmentName(input.filename)
  const bytes = attachmentBytes(input.payload)
  const directory = join(input.cacheDir, safeId(input.messageId), safeId(input.attachmentId))
  const path = join(directory, filename)
  if (!resolve(path).startsWith(resolve(input.cacheDir) + sep)) {
    throw new Error('Attachment filename is missing or unsafe')
  }
  await mkdir(directory, { recursive: true })
  await writeFile(path, bytes)
  await input.openPath(path)
  return { path, filename }
}

function safeAttachmentName(filename: string): string {
  const base = basename(filename.replaceAll('\\', '/'))
  const cleaned = base.replaceAll(/[\0\r\n]/g, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Attachment filename is missing or unsafe')
  }
  return cleaned
}

function safeId(value: string): string {
  const cleaned = value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '')
  return cleaned || 'attachment'
}

function attachmentBytes(payload: unknown): Buffer {
  const record = asRecord(payload)
  const content = asRecord(record?.structuredContent) ?? record
  const encoded = String(content?.base64_url_content ?? content?.data ?? '').replaceAll(/\s/g, '')
  if (!encoded) throw new Error('Gmail attachment response did not contain downloadable bytes')
  return Buffer.from(encoded.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
