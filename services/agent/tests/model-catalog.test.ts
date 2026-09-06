import { describe, expect, it } from 'vitest'
import { DISPATCH_DEFAULTS, readModelCatalog } from '../src/model-catalog.js'

const catalog = {
  data: [
    { id: 'gpt-reserve', model: 'gpt-reserve', displayName: 'GPT-Reserve', hidden: true, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'max' }] },
    { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', hidden: false, isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'ultra' }] },
    { id: 'gpt-5.3-codex-spark', model: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3-Codex-Spark', hidden: false, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
    { id: 'codex-auto-review', model: 'codex-auto-review', displayName: 'Codex Auto Review', hidden: true, isDefault: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
  ],
}

const limits = {
  rateLimits: { limitId: 'codex', primary: { usedPercent: 100, resetsAt: 1788754468 }, rateLimitReachedType: 'rate_limit_reached' },
  rateLimitsByLimitId: {
    codex: { limitId: 'codex', primary: { usedPercent: 100, resetsAt: 1788754468 }, rateLimitReachedType: 'rate_limit_reached' },
    codex_bengalfox: { limitId: 'codex_bengalfox', primary: { usedPercent: 40, resetsAt: 1788675977 }, rateLimitReachedType: null },
    base_model_inference: { limitId: 'base_model_inference', limitName: 'gpt-reserve', primary: { usedPercent: 0, resetsAt: 1789252467 }, rateLimitReachedType: null },
  },
  rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'RateLimitResetCredit_x' }] },
}

describe('readModelCatalog', () => {
  it('joins the catalog with rate-limit buckets and labels the reserve model', () => {
    const result = readModelCatalog(catalog, limits)
    expect(result.defaults).toEqual(DISPATCH_DEFAULTS)
    expect(result.rateLimitsError).toBeNull()
    expect(result.models).toEqual([
      { id: 'gpt-reserve', label: 'Luna Reserve', efforts: ['low', 'max'], exhausted: false, resetsAt: 1789252467 },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', efforts: ['medium', 'ultra'], exhausted: true, resetsAt: 1788754468 },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', efforts: ['low'], exhausted: false, resetsAt: 1788675977 },
    ])
  })

  it('never surfaces reset credits', () => {
    expect(JSON.stringify(readModelCatalog(catalog, limits))).not.toContain('RateLimitResetCredit')
  })

  it('marks a bucket exhausted at 100 percent even without a reached marker', () => {
    const result = readModelCatalog(catalog, { rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 100, resetsAt: null }, rateLimitReachedType: null } } })
    expect(result.models.find((model) => model.id === 'gpt-5.6-sol')).toMatchObject({ exhausted: true, resetsAt: null })
    expect(result.models.find((model) => model.id === 'gpt-reserve')).toMatchObject({ exhausted: null })
  })

  it('keeps the catalog visible when the rate-limit read failed', () => {
    const result = readModelCatalog(catalog, new Error('account/rateLimits/read timed out'))
    expect(result.rateLimitsError).toBe('account/rateLimits/read timed out')
    expect(result.models.map((model) => model.exhausted)).toEqual([null, null, null])
  })

  it('rejects a catalog without models', () => {
    expect(() => readModelCatalog({ data: [] }, limits)).toThrow('Codex App Server returned no models')
  })
})
