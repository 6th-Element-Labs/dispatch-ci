import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeOpenCommand, openAttachmentFile } from '../src/open-attachment.js'

async function cacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dispatch-attachment-'))
}

describe('nativeOpenCommand', () => {
  it('uses the OS default app for the file path', () => {
    const command = nativeOpenCommand('/tmp/arrival.pdf')
    if (process.platform === 'darwin') expect(command).toEqual({ command: 'open', args: ['/tmp/arrival.pdf'] })
    else if (process.platform === 'win32') expect(command).toEqual({ command: 'cmd', args: ['/c', 'start', '', '/tmp/arrival.pdf'] })
    else expect(command).toEqual({ command: 'xdg-open', args: ['/tmp/arrival.pdf'] })
  })
})

describe('openAttachmentFile', () => {
  it('writes the attachment under its safe filename and opens that path', async () => {
    const opened: string[] = []
    const cache = await cacheDir()
    const result = await openAttachmentFile({
      messageId: 'msg/1',
      attachmentId: 'att/9',
      filename: 'Opua arrival instructions.pdf',
      payload: { data: Buffer.from('%PDF-1.1 demo').toString('base64') },
      cacheDir: cache,
      openPath: async (path) => { opened.push(path) },
    })

    expect(result.filename).toBe('Opua arrival instructions.pdf')
    expect(result.path).toBe(join(cache, 'msg-1', 'att-9', 'Opua arrival instructions.pdf'))
    expect(opened).toEqual([result.path])
    await expect(readFile(result.path, 'utf8')).resolves.toBe('%PDF-1.1 demo')
  })

  it('decodes URL-safe base64 from structuredContent', async () => {
    const cache = await cacheDir()
    const bytes = Buffer.from('hello+/world')
    const result = await openAttachmentFile({
      messageId: 'm1',
      attachmentId: 'a1',
      filename: 'note.txt',
      payload: { structuredContent: { base64_url_content: bytes.toString('base64url') } },
      cacheDir: cache,
      openPath: async () => undefined,
    })
    await expect(readFile(result.path)).resolves.toEqual(bytes)
  })

  it('rejects a missing attachment payload', async () => {
    await expect(openAttachmentFile({
      messageId: 'm1',
      attachmentId: 'a1',
      filename: 'note.pdf',
      payload: {},
      cacheDir: await cacheDir(),
      openPath: async () => undefined,
    })).rejects.toThrow('Gmail attachment response did not contain downloadable bytes')
  })

  it('keeps a traversal filename inside the cache directory', async () => {
    const cache = await cacheDir()
    const result = await openAttachmentFile({
      messageId: 'm1',
      attachmentId: 'a1',
      filename: '../../etc/passwd',
      payload: { data: Buffer.from('x').toString('base64') },
      cacheDir: cache,
      openPath: async () => undefined,
    })
    expect(result.filename).toBe('passwd')
    expect(result.path).toBe(join(cache, 'm1', 'a1', 'passwd'))
  })

  it('rejects an empty or dot filename', async () => {
    const cache = await cacheDir()
    for (const filename of ['', '.', '..', '/']) {
      await expect(openAttachmentFile({
        messageId: 'm1',
        attachmentId: 'a1',
        filename,
        payload: { data: Buffer.from('x').toString('base64') },
        cacheDir: cache,
        openPath: async () => undefined,
      })).rejects.toThrow('Attachment filename is missing or unsafe')
    }
  })

  it('does not hide a failed default-app open', async () => {
    await expect(openAttachmentFile({
      messageId: 'm1',
      attachmentId: 'a1',
      filename: 'note.pdf',
      payload: { data: Buffer.from('x').toString('base64') },
      cacheDir: await cacheDir(),
      openPath: async () => { throw new Error('Preview is not available') },
    })).rejects.toThrow('Preview is not available')
  })
})
