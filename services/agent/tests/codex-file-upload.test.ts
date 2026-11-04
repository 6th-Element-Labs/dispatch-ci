import { expect, it, vi } from 'vitest'
import { CodexFileUploader } from '../src/codex-file-upload.js'

const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace-test' } })).toString('base64url')}.signature`
function runtime(base = 'https://chatgpt.com/backend-api/') {
  return { request: vi.fn(async (method: string) => method === 'getAuthStatus' ? { authMethod: 'chatgpt', authToken: token } : { config: { chatgpt_base_url: base } }) }
}
const file = { filename: 'résumé.pdf', data: Buffer.from('exact test bytes').toString('base64') }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

it('uses native in-memory authorization and the official allocate/PUT/finalize protocol, including PDF provenance', async () => {
  const native = runtime()
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ file_id: 'file_pdf', upload_url: 'https://storage.example.com/bytes?sig=private', pdf_c2pa_reservation: true }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(json({ status: 'success', download_url: 'https://files.example.com/download?sig=private' }))
  expect(await new CodexFileUploader(native, fetcher).upload([file])).toEqual([{ file_id: 'file_pdf', download_url: 'https://files.example.com/download?sig=private', file_name: file.filename }])
  expect(native.request).toHaveBeenCalledWith('getAuthStatus', { includeToken: true, refreshToken: false })
  const [allocation, put, finalize] = fetcher.mock.calls
  expect(allocation![0]).toBe('https://chatgpt.com/backend-api/files')
  expect(JSON.parse(allocation![1]!.body as string)).toEqual({ file_name: file.filename, file_size: 16, use_case: 'codex' })
  expect(allocation![1]!.headers).toMatchObject({ authorization: `Bearer ${token}`, 'ChatGPT-Account-ID': 'workspace-test' })
  expect(put![1]!.body).toEqual(Buffer.from('exact test bytes'))
  expect(put![1]!.headers).not.toHaveProperty('authorization')
  expect(put![1]!.headers).not.toHaveProperty('ChatGPT-Account-ID')
  expect(put![1]!.redirect).toBe('error')
  expect(JSON.parse(finalize![1]!.body as string)).toEqual({ pdf_c2pa_create_request: { file_name: file.filename, file_size: 16, use_case: 'codex' } })
})

it('keeps one allocated identity for idempotent byte-transfer retries and waits for readiness', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ file_id: 'file_same', upload_url: 'https://storage.example.com/bytes' }))
    .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(json({ status: 'retry' })).mockResolvedValueOnce(json({ status: 'success', download_url: 'https://files.example.com/download' }))
  expect(await new CodexFileUploader(runtime(), fetcher).upload([file])).toHaveLength(1)
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/files'))).toHaveLength(1)
  expect(fetcher.mock.calls.filter(([, request]) => request?.method === 'PUT')).toHaveLength(2)
})

it('rejects oversized/malformed files before authorization or remote allocation', async () => {
  const native = runtime(), fetcher = vi.fn<typeof fetch>()
  const uploader = new CodexFileUploader(native, fetcher)
  await expect(uploader.upload([{ filename: 'bad.txt', data: '%invalid%' }])).rejects.toThrow('file bytes')
  await expect(uploader.upload([{ filename: 'huge.bin', data: Buffer.alloc(25_000_001).toString('base64') }])).rejects.toThrow('25 MB')
  expect(native.request).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
})

it('does not export credentials to a configured third-party backend or unencrypted blob target', async () => {
  const fetcher = vi.fn<typeof fetch>()
  await expect(new CodexFileUploader(runtime('https://untrusted.example/backend-api'), fetcher).upload([file])).rejects.toThrow('official ChatGPT')
  expect(fetcher).not.toHaveBeenCalled()
  fetcher.mockResolvedValueOnce(json({ file_id: 'file_bad', upload_url: 'http://storage.example.com/bytes' }))
  await expect(new CodexFileUploader(runtime(), fetcher).upload([file])).rejects.toThrow('unsafe storage URL')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('redacts signed URLs and bearer credentials from transfer errors and never invents a completed upload', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ file_id: 'file_bad', upload_url: 'https://storage.example.com/bytes?secret=SIGNED' }))
    .mockRejectedValue(new Error(`request failed with SIGNED and ${token}`))
  const error = await new CodexFileUploader(runtime(), fetcher).upload([file]).catch(error => error)
  expect(String(error)).toContain('byte upload failed')
  expect(String(error)).not.toMatch(/SIGNED|signature|secret=/)
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/uploaded'))).toBe(false)
})
