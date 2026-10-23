import { describe, expect, it } from 'vitest'
import { httpThreadParams } from '../src/codex-transport.js'

describe('Codex HTTP transport', () => {
  it('keeps native OpenAI auth and backend capabilities while avoiding WebSocket retries', () => {
    const params = { threadId: 'existing-chat', cwd: '/mail', config: { 'mcp_servers.dispatch_mail': { url: 'http://127.0.0.1:8412/mcp/dispatch-mail' } } }
    const result = httpThreadParams(params, { config: { model_provider: 'openai' } }, '0.164.0')
    expect(result).toMatchObject({ threadId: 'existing-chat', cwd: '/mail', modelProvider: 'dispatch_openai_http', config: {
      ...params.config, model_provider: 'dispatch_openai_http',
      'model_providers.dispatch_openai_http': { name: 'OpenAI', requires_openai_auth: true, supports_websockets: false, supports_standalone_web_search: true, http_headers: { version: '0.164.0' } },
    } })
    expect(params.config).not.toHaveProperty('model_provider')
  })

  it('uses the default OpenAI route when Codex leaves model_provider unset', () => {
    expect(httpThreadParams({}, { config: {} }).config).toHaveProperty('model_provider', 'dispatch_openai_http')
  })

  it('refuses missing effective config rather than replacing an unknown provider', () => {
    expect(() => httpThreadParams({}, {})).toThrow('Codex returned no effective configuration')
  })

  it('preserves configured routing, model selection, permissions and unrelated thread settings', () => {
    const params = { model: 'chosen-model', approvalPolicy: 'never', config: { openai_base_url: 'https://example.test/backend-api/codex' } }
    expect(httpThreadParams(params, { config: { openai_base_url: 'https://other.test' } })).toMatchObject({
      model: 'chosen-model', approvalPolicy: 'never', config: { 'model_providers.dispatch_openai_http': { base_url: params.config.openai_base_url } },
    })
  })

  it.each([
    [{}, { config: { model_provider: 'company-gateway' } }],
    [{ config: { model_provider: 'company-gateway' } }, { config: { model_provider: 'openai' } }],
    [{ modelProvider: 'company-gateway' }, { config: { model_provider: 'openai' } }],
    [{}, { config: { model_provider: 'dispatch_openai_http' } }],
  ])('leaves an explicitly selected custom provider intact: %j', (params, config) => {
    expect(httpThreadParams(params, config)).toBe(params)
  })
})
