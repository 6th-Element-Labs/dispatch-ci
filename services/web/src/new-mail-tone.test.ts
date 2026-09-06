import { describe, expect, it, vi } from 'vitest'
import { arrivedUnreadIds, playNewMailTone, triadNotes } from './new-mail-tone.js'
import type { ConversationSummary } from './contracts.js'

function conversation(id: string, unread: boolean): ConversationSummary {
  return {
    id, threadId: id, latestMessageId: `${id}-m`, sender: { name: 'Ana', address: 'ana@example.com', initials: 'A' },
    subject: 'Berth', receivedAt: 'now', receivedLabel: 'Sep 4', receivedFullLabel: 'September 4', preview: '', unread, messageCount: 1,
  }
}

describe('new mail tone', () => {
  it('is an ascending C-E-G triad spaced 90ms apart', () => {
    const notes = triadNotes()
    expect(notes.map((note) => Math.round(note.frequency))).toEqual([1047, 1319, 1568])
    expect(notes.map((note) => note.startOffset)).toEqual([0, 0.09, 0.18])
    expect(Math.max(...notes.map((note) => note.startOffset + note.duration))).toBeLessThan(0.7)
  })

  it('reports only unread conversations missing from the previous live list', () => {
    const previous = new Set(['a', 'b'])
    expect(arrivedUnreadIds(previous, [conversation('c', true), conversation('a', true), conversation('d', false)])).toEqual(['c'])
  })

  it('never chimes without a confirmed live baseline', () => {
    expect(arrivedUnreadIds(undefined, [conversation('c', true)])).toEqual([])
  })

  it('schedules three bells per note and reports when audio is blocked', async () => {
    const started: number[] = []
    const oscillator = () => ({
      type: 'sine', frequency: { value: 0 }, connect: vi.fn(), start: (at: number) => started.push(at), stop: vi.fn(),
    })
    const gain = () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() })
    const running = {
      currentTime: 10, destination: {} as AudioNode, state: 'running' as AudioContextState, resume: vi.fn(async () => {}),
      createOscillator: oscillator as unknown as () => OscillatorNode, createGain: gain as unknown as () => GainNode,
    }
    await expect(playNewMailTone(running)).resolves.toBe(true)
    expect(started).toHaveLength(9)
    expect(started.slice(0, 3)).toEqual([10, 10, 10])

    const suspended = { ...running, state: 'suspended' as AudioContextState, resume: vi.fn(async () => {}) }
    await expect(playNewMailTone(suspended)).resolves.toBe(false)
    expect(suspended.resume).toHaveBeenCalledOnce()
  })
})
