# Codex model picker

Date: 2026-09-06
Status: approved by Steve on 2026-09-06 ("lets do that"), no reset credits exposed
Slices: `services/agent` (catalog and rate-limit adapter), `services/web` (picker)

## Problem

Dispatch pins every Codex turn to `gpt-5.6-sol` at medium effort in
`services/agent/src/server.ts`. When the ChatGPT `codex` usage bucket is exhausted
every turn fails with `usageLimitExceeded`, although the same account still has a
separate reserve bucket. The Sol desktop client exposes that reserve as
"Luna Reserve". Dispatch cannot reach it.

## Verified protocol facts (codex-cli 0.144.5)

- `model/list` with `includeHidden: true` returns `gpt-reserve` (display name
  GPT-Reserve, `hidden: true`, efforts low..max). It is a distinct model id, not
  a service tier.
- `account/rateLimits/read` returns `rateLimitsByLimitId`. Buckets seen:
  `codex` (Sol, Luna, Terra, 5.5, 5.4-mini), `codex_bengalfox` (5.3 Codex
  Spark), `base_model_inference` (gpt-reserve). The catalog does not name a
  model's bucket, so the mapping is fixed in the agent service.
- `turn/start` accepts `model` and `effort` per turn. A turn on `gpt-reserve`
  at max completed while Sol and Luna failed with `usageLimitExceeded`.
- `account/rateLimits/updated` is a thread-less notification and already flows
  through the agent's event stream.

## Decisions

### Agent service

- `GET /v1/models` returns the catalog joined with rate limits:
  `{ models: [{ id, label, efforts, exhausted, resetsAt }], defaults: { model, effort } }`.
  Hidden models are excluded except `gpt-reserve`, which is labelled
  "Luna Reserve". `codex-auto-review` is never listed.
- `exhausted` is true when the model's bucket reports
  `rateLimitReachedType === 'rate_limit_reached'` or `primary.usedPercent >= 100`.
  `resetsAt` is the bucket's primary reset epoch seconds, or null.
- Rate-limit read failures do not hide the catalog: the response carries
  `rateLimitsError` and every model reports `exhausted: null`.
- `POST /v1/threads/:id/turns` forwards `model` and `effort` from the payload
  when both are non-empty strings, otherwise the Dispatch defaults. The
  app-server is the authority on validity; an unknown model fails the turn and
  the failure is shown in the stream.
- Reset credits are not read, listed, or redeemed. No `account/rateLimitResetCredit/*`
  call exists in Dispatch.

### Web

- The static "GPT-5.6 Sol · Medium" badge in the Codex header becomes a
  button with a popover. The button text stays `<label> · <Effort>` so the
  current selection is always visible.
- The popover lists models as radio rows. Exhausted rows are disabled and show
  "Limit reached · resets <local time>". Under the list, a segmented effort row
  shows only the selected model's supported efforts.
- Selection persists in `localStorage` (`dispatch.codex.model`,
  `dispatch.codex.effort`) and is sent with every turn. Changing the selection
  applies to the next turn of the current thread; no thread restart.
- Selection is never changed automatically. When the selected model is
  exhausted, the header button turns yellow and the popover's summary line says
  so; the user picks another model.
- The list refreshes when the popover opens, on `account/rateLimits/updated`,
  and after a turn fails with `usageLimitExceeded`.
- If the agent is not ready the button still shows the stored or default label
  and the popover says "Codex not connected".

## Tests

- Agent: `/v1/models` joins catalog and limits, labels reserve, hides
  auto-review, marks the exhausted bucket, tolerates a rate-limit read failure;
  turns forward the chosen model and effort and keep the defaults otherwise.
- Web (Playwright): with a mocked `/v1/models`, the popover lists Sol as
  exhausted and Luna Reserve as available, picking Luna Reserve at max updates
  the header label, and the next turn payload carries `model: 'gpt-reserve'`,
  `effort: 'max'`.
