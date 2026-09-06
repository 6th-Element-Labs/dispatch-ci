# Codex pane chrome cleanup

Date: 2026-09-07
Status: approved by Steve on 2026-09-07 (layout A, Mail + Codex dots, sections 1–3)
Slice: presentation only, `services/web`

## Problem

The third pane spends a header on a Codex title, a sparkle mark, a model badge, a Connected badge, and a “Working with …” strip. The prompt footer repeats Gmail status as words. That chrome steals chat height and leaves white space.

The top bar already has a pane toggle for the third column. The selected email already sits in the middle pane. Those facts do not need to be restated as titles.

## Goal

Give the chat the full pane height. Keep model choice and two status signals on one footer row. Failures stay visible without printing status words in the pane.

## Decisions

### Layout

- Remove the Codex pane header. That removes the sparkle mark, the visible Codex title, the Connected badge, the “Working with …” strip, and the header progress bar.
- The chat list fills that space.
- Suggestion chips stay above the prompt.
- The prompt footer is one row, left to right: Gmail dot, Codex dot, model picker, then Stop and Send on the right.
- The model picker replaces the “Gmail available” / “No Gmail connector” words.
- The model menu opens upward so it stays inside the window.
- A thin progress bar sits on the prompt card only while Codex works. It is not a second header.

### Status dots

- **Gmail dot:** green when the Gmail connector is available. Red when there is no Gmail connector or the Gmail check fails.
- **Codex dot:** green for Connected, Working, and Interrupted. Red for Connecting, Reconnecting, Failed, and Needs attention.
- Each dot keeps the current words in `title` and `aria-label`. The Codex dot stays `aria-live`.
- Codex wait text (“Waiting for Codex App Server”, “Restarting Codex App Server”, and agent connect errors) belongs on the Codex dot only. It must not overwrite the Gmail dot.
- “Working with …” is gone. The selected email stays in the reader. No context chip or context strip.

### Accessibility

- The aside keeps `aria-label="Codex"` so the pane still has a name for the screen reader.
- The top-bar pane button keeps its Codex label.
- Visible “Codex” text is not required in the pane.

## Architecture

```text
services/web only
  main.ts   header gone; footer row owns model + dots
  styles.css  stream grows; model menu opens up
  ui.spec.ts  assert titles / aria-labels, not header words
```

Rules:

1. Mail and agent services do not change.
2. One Codex pane still switches with the selected conversation.
3. The model catalog, effort list, and turn payload stay as they are. Only the picker moves.
4. `data-connector` remains the Gmail dot. `data-agent-status` remains the Codex dot. Those nodes have no visible words. CSS draws the color. The words live in `title` and `aria-label`.
5. `data-context` is removed. Tests that read “Working with …” are deleted or rewritten.
6. Fail in the open: a red dot plus the status words in `title` / `aria-label` is enough. Do not hide Failed or Reconnecting behind a silent green dot.

## Data flow

1. Gmail connector check writes only the Gmail dot state and its label.
2. Agent SSE and reconnect write only the Codex dot state, its label, and the prompt progress bar.
3. Model catalog render still fills `[data-model-toggle]` and `[data-model-menu]`. Those nodes live in the prompt footer.
4. Select conversation still binds the Codex thread. It does not paint a “Working with” line.

## Error handling

- Gmail down: Gmail dot red. Codex can still be green.
- Codex down or reconnecting: Codex dot red. Gmail can still be green.
- Both down: two red dots.
- Working: Codex dot green, progress bar visible on the prompt card.

## Testing

Browser tests in `services/web/tests/ui.spec.ts`:

- Do not require a visible “Codex” heading, “Working with …”, or “Gmail available” as body text.
- Assert the Gmail dot `title` or `aria-label` for available and missing connector.
- Assert the Codex dot `title` or `aria-label` for Reconnecting and Connected.
- Assert the model picker is inside the agent footer, not a pane header.
- Assert a missing Gmail connector turns the Gmail dot red (class or computed style).

Do not claim native `Dispatch.app` proof from Playwright. A native rebuild is out of this slice unless Steve asks after web tests pass.

## Non-goals

- Live Gmail search
- The empty-thread resume / “not materialized yet” bind replacement
- Mail or agent service changes
- A second Codex pane
- Moving the model picker into the top bar
- Dark mode

## Files

- `services/web/src/main.ts`
- `services/web/src/styles.css`
- `services/web/tests/ui.spec.ts`
