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

## Follow-up from the installed build

Saved-thread responses measured 1.15–13.45 ms across nine reads of the same three emails. Inbox lists measured 123–169 ms, Archive 127–133 ms, and Drafts 331–480 ms. The remaining Drafts delay came from queue queries decoding all historic saved jobs, including attachment bytes, when selecting pending jobs, cleanup and aliases.

Queue lookups now use SQLite expression indexes to select state/account/remote identity before payload decoding. Existing saved drafts and attachment bytes stay intact; unfinished cancellations and retryable errors retain their prior behavior. Across 120 synthetic saved drafts with 256 KB attachments, median pending/cleanup lookup work fell from 108.41 ms to 0.01 ms (p95 132.54 ms to 0.02 ms), with identical results. Migration and restart tests preserve the original three-column store and draft data.

Prefetch follows the selected row and warms its next three neighbors, with previous rows used at the end of the list. It no longer stops warming useful rows after navigating past the first few emails.
