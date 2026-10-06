# Mail performance repair — 7 October 2026

Opening a thread awaited Gmail even when Dispatch already held a complete saved copy. Routine folder lists, badge counts and new reply seeding also projected every indexed message. Send waited for all draft saves in its account.

Dispatch now opens a complete copy through the Mail service and checks Gmail in the background. A copy missing any newly indexed message requires a live read. Accepted read/folder actions override cached labels. The response distinguishes `cached`, `live` and offline/failure `downloaded` copies. Refreshes cannot replace another email or an active editor; unchanged confirmation preserves scroll and message expansion. Explicit authoritative and offline reads retain their API behavior.

Folder filtering runs in SQLite before row projection. Counts group account and thread IDs in SQLite. A reply seed looks up its exact message. Send prioritizes its own queued revision and proceeds as soon as that revision is verified, while retaining durable intent, conflict detection and ambiguity protection.

## Evidence

Before changes, three opened real threads took 1.68–3.77 seconds for live reads. Two saved reads took 1.4–2.1 milliseconds; one coincided with service blocking and took 2.64 seconds. These are individual observations, not a latency distribution.

On this Mac (Node 25), 20 measured iterations after five warmups over 20,000 synthetic messages reduced median Inbox-list plus badge-count work from 91.16 ms to 3.43 ms, and p95 from 94.52 ms to 3.80 ms. Both versions returned 100 Inbox threads and counts `{inbox:100,drafts:10,spam:10}`. This measures index work, not complete UI latency or Gmail delivery.

Reproduce with `node --import ./services/mail/node_modules/tsx/dist/loader.mjs services/mail/scripts/benchmark-index.ts`. Run the same script against the baseline and updated GmailIndex. The script creates an isolated in-memory synthetic store.

Regression coverage includes cached opening while Gmail is blocked, newly indexed-message coverage, accepted Trash/read labels, account/count parity, Send priority with an unrelated blocked save, active editor preservation, selection races, reselecting during a coalesced refresh and preserving expanded messages.

First-time uncached reading and Gmail delivery still depend on the provider. Cached display is not evidence of delivery. Confirm delivery in Sent.
