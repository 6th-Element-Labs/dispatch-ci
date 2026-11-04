import { randomUUID } from 'node:crypto'

type Runtime = { request(method: string, params?: unknown): Promise<unknown> }
type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
export type ProvidedFile = { file_id: string; download_url: string; file_name: string; mime_type?: string }

/** Matches Codex 0.166 codex-api/src/files.rs; authorization stays in memory.
 * Direct App Server MCP calls omit the native turn handler's file preprocessing.
 * This adapter implements only that missing transport, without an agent turn.
 */
export class CodexFileUploader {
  constructor(readonly runtime: Runtime, readonly fetcher: typeof fetch = fetch) {}

  async upload(files: readonly RecordValue[]): Promise<ProvidedFile[]> {
    const prepared = files.map(file => {
      const name = text(file.filename) || text(file.name)
      const base64 = file.data ?? file.contentBase64
      if (!name || /[\r\n\x00]/.test(name) || typeof base64 !== 'string' || !/^[a-zA-Z0-9+/]*={0,2}$/.test(base64)) {
        throw Object.assign(new Error('Invalid attachment name or file bytes'), { code: 'gmail_invalid_arguments' })
      }
      return { name, bytes: Buffer.from(base64, 'base64') }
    })
    if (prepared.reduce((sum, file) => sum + file.bytes.length, 0) > 25_000_000) throw Object.assign(new Error('Combined attachments exceed 25 MB'), { code: 'gmail_invalid_arguments' })
    if (!prepared.length) return []
    const status = object(await this.runtime.request('getAuthStatus', { includeToken: true, refreshToken: false }))
    const token = text(status.authToken)
    if (!/^chatgpt/i.test(text(status.authMethod)) || !token) throw new Error('Sign in to Codex to upload email attachments.')
    const config = object(object(await this.runtime.request('config/read', { includeLayers: false })).config)
    const base = new URL(text(config.chatgpt_base_url) || 'https://chatgpt.com/backend-api/')
    if (base.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(base.hostname) || base.port || base.username || base.password || base.search || base.hash || base.pathname.replace(/\/$/, '') !== '/backend-api') {
      throw new Error('Codex file uploads require the official ChatGPT backend.')
    }
    const authHeaders: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json', originator: 'dispatch' }
    try {
      const claims = object(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')))
      const accountId = text(object(claims['https://api.openai.com/auth']).chatgpt_account_id)
      if (accountId) authHeaders['ChatGPT-Account-ID'] = accountId
    } catch { /* Native auth can supply an opaque token; the backend remains authoritative. */ }
    const root = base.href.replace(/\/$/, '')
    const signal = AbortSignal.timeout(150_000)
    const jsonRequest = async (path: string, payload: unknown): Promise<RecordValue> => {
      const response = await this.fetcher(root + path, { method: 'POST', headers: authHeaders, body: JSON.stringify(payload), redirect: 'error', signal })
      if (!response.ok) throw new Error(`Codex attachment upload ${path.endsWith('/uploaded') ? 'finalization' : 'allocation'} failed (HTTP ${response.status}).`)
      return object(await response.json())
    }
    const results: ProvidedFile[] = []
    for (const file of prepared) {
      const createRequest = { file_name: file.name, file_size: file.bytes.length, use_case: 'codex' }
      const allocated = await jsonRequest('/files', createRequest)
      const id = text(allocated.file_id)
      if (!/^file[_-][a-zA-Z0-9_-]+$/.test(id)) throw new Error('Codex attachment upload returned an invalid file identity.')
      const uploadUrl = new URL(text(allocated.upload_url))
      if (uploadUrl.protocol !== 'https:' || uploadUrl.username || uploadUrl.password) throw new Error('Codex attachment upload returned an unsafe storage URL.')
      // Never send the Codex bearer token to the blob storage host, nor log signed URLs.
      for (let attempt = 0; ; attempt++) {
        let response: Response
        try {
          response = await this.fetcher(uploadUrl, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-client-request-id': randomUUID(), 'content-length': String(file.bytes.length) },
            body: file.bytes, redirect: 'error', signal })
        } catch {
          if (attempt >= 2 || signal.aborted) throw new Error('Codex attachment byte upload failed. Your file is kept in Dispatch.')
          continue
        }
        if (response.ok) break
        if (attempt >= 2 || ![408, 429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Codex attachment byte upload failed (HTTP ${response.status}).`)
        await response.body?.cancel()
      }
      const deadline = Date.now() + 30_000
      for (;;) {
        const finalized = await jsonRequest(`/files/${encodeURIComponent(id)}/uploaded`, allocated.pdf_c2pa_reservation === true ? { pdf_c2pa_create_request: createRequest } : {})
        if (finalized.status === 'success') {
          const download = new URL(text(finalized.download_url))
          if (download.protocol !== 'https:' || download.username || download.password) throw new Error('Codex attachment upload returned an unsafe download URL.')
          results.push({ file_id: id, download_url: download.href, file_name: file.name, ...(text(finalized.mime_type) ? { mime_type: text(finalized.mime_type) } : {}) })
          break
        }
        if (finalized.status !== 'retry' || Date.now() >= deadline) throw new Error('Codex attachment upload was not finalized. Your file is kept in Dispatch.')
        await new Promise(resolve => setTimeout(resolve, 250))
        signal.throwIfAborted()
      }
    }
    return results
  }
}
