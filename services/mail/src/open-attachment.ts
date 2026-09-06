import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  /** Fetches the bytes behind a connector download URL. Defaults to an https-only fetch. */
  readonly download?: (url: string) => Promise<Buffer>
}

/** Connector responses may exceed this before Dispatch refuses to write them to disk. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

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

export async function defaultDownload(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Attachment download failed (${response.status})`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`)
  return bytes
}

/**
 * The Codex Gmail connector answers an attachment read with either inline
 * base64 (`base64_url_content` / `data`) or a signed https `download_url`
 * (top level, under `file_uri`, or in a nested `structuredContent`). Inline
 * bytes win; otherwise the URL is fetched. Anything else is a hard failure.
 */
export async function resolveAttachmentBytes(payload: unknown, download: (url: string) => Promise<Buffer> = defaultDownload): Promise<Buffer> {
  const inline = inlineAttachmentBytes(payload)
  if (inline) return inline
  const url = attachmentDownloadUrl(payload)
  if (!url) throw new Error('Gmail attachment response did not contain downloadable bytes')
  const bytes = await download(url)
  const expected = expectedAttachmentSize(payload)
  if (expected !== undefined && expected !== bytes.length) {
    throw new Error(`Gmail attachment download returned ${bytes.length} bytes, expected ${expected}`)
  }
  return bytes
}

export function attachmentDownloadUrl(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const content = asRecord(record?.structuredContent) ?? record
  const candidates = [content, asRecord(content?.file_uri), asRecord(content?.structuredContent), asRecord(asRecord(content?.structuredContent)?.file_uri)]
  for (const candidate of candidates) {
    const url = candidate?.download_url
    if (typeof url !== 'string' || !url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Gmail attachment download URL is not valid')
    }
    if (parsed.protocol !== 'https:') throw new Error(`Gmail attachment download URL must use https, got ${parsed.protocol}`)
    return url
  }
  return undefined
}

function expectedAttachmentSize(payload: unknown): number | undefined {
  const record = asRecord(payload)
  const content = asRecord(record?.structuredContent) ?? record
  const size = content?.size_bytes ?? asRecord(content?.structuredContent)?.size_bytes
  return typeof size === 'number' && Number.isInteger(size) && size >= 0 ? size : undefined
}

export async function openAttachmentFile(input: OpenAttachmentInput): Promise<OpenedAttachment> {
  const filename = safeAttachmentName(input.filename)
  const bytes = await resolveAttachmentBytes(input.payload, input.download)
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

/** Gmail attachment ids run past 400 characters, longer than a path segment may be, so long ids are shortened to a prefix plus a digest. */
export function safeId(value: string): string {
  const cleaned = value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '')
  if (!cleaned) return 'attachment'
  if (cleaned.length <= MAX_ID_SEGMENT) return cleaned
  return `${cleaned.slice(0, 24)}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`
}

const MAX_ID_SEGMENT = 80

function inlineAttachmentBytes(payload: unknown): Buffer | undefined {
  const record = asRecord(payload)
  const content = asRecord(record?.structuredContent) ?? record
  const encoded = String(content?.base64_url_content ?? content?.data ?? asRecord(content?.attachment)?.data ?? '').replaceAll(/\s/g, '')
  if (!encoded) return undefined
  return Buffer.from(encoded.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
