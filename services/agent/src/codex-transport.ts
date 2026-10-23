const HTTP_PROVIDER = 'dispatch_openai_http'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Select HTTP for the built-in OpenAI route without rewriting the user's Codex config. */
export function httpThreadParams(params: unknown, effectiveConfig: unknown, version?: string | null): Record<string, unknown> {
  const input = record(params)
  if (!effectiveConfig || typeof effectiveConfig !== 'object' || !('config' in effectiveConfig)
    || !effectiveConfig.config || typeof effectiveConfig.config !== 'object' || Array.isArray(effectiveConfig.config)) {
    throw new Error('Codex returned no effective configuration; the chat transport was not changed.')
  }
  const config = record(record(effectiveConfig).config)
  const overrides = record(input.config)
  const selected = input.modelProvider ?? overrides.model_provider ?? config.model_provider ?? 'openai'
  if (selected !== 'openai') return input

  const provider: Record<string, unknown> = {
    // Codex uses this name to retain its native auth, model catalog and backend routes.
    name: 'OpenAI',
    wire_api: 'responses',
    requires_openai_auth: true,
    supports_websockets: false,
    supports_standalone_web_search: true,
    env_http_headers: { 'OpenAI-Organization': 'OPENAI_ORGANIZATION', 'OpenAI-Project': 'OPENAI_PROJECT' },
  }
  if (version) provider.http_headers = { version }
  const baseUrl = overrides.openai_base_url ?? config.openai_base_url
  if (typeof baseUrl === 'string' && baseUrl) provider.base_url = baseUrl
  return {
    ...input,
    // Resume prefers the stored provider over config.model_provider unless selected here.
    modelProvider: HTTP_PROVIDER,
    config: { ...overrides, model_provider: HTTP_PROVIDER, [`model_providers.${HTTP_PROVIDER}`]: provider },
  }
}
