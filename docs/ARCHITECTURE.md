# Dispatch service architecture

Status: accepted foundation direction

## Decision

Dispatch uses small, independently runnable services. The repository is a delivery container, not a runtime monolith.

```text
Browser or Tauri WebKit
        |
        +---- dispatch-mail :8411
        |         owns message and draft projections
        |
        +---- dispatch-agent :8412
                  owns codex app-server lifecycle
                            |
                            +---- codex app-server over JSONL stdio
                                      |
                                      +---- installed apps/connectors
```

## Boundaries

### Web

`dispatch-web` owns presentation state only. It does not infer mail priority, synthesize agent results, hold credentials, spawn processes, or read provider storage.

### Mail

`dispatch-mail` owns browser-facing message and draft view models. It calls the agent service's typed, read-only Gmail adapter, retrieves each connector account, merges their bounded projections by source time, and converts Gmail headers and MIME parts into safe view models. An explicit in-memory demo provider remains available when no connector account is present. Gmail writes are not enabled.

### Agent

`dispatch-agent` is the only service that starts and communicates with Codex App Server. It exposes a small HTTP and server-sent-event adapter for account state, installed apps, threads, turns, and streamed items. It does not implement a model loop.

## SimpleMark reuse

The foundation reuses SimpleMark's established choices rather than its product domain:

- Vite and strict TypeScript.
- WebKit-compatible HTML and CSS.
- restrained native-window visual language;
- rendered-document typography;
- explicit light and dark themes;
- sanitization before rendering provider HTML;
- thin platform composition;
- browser acceptance tests;
- private canonical repository plus public verification sandbox.

The source reference inspected for this bootstrap was SimpleMark `8a38e012089dd5b81a71a176056134d0a6d68dda`.

## Local transport

Browser development uses localhost HTTP and SSE. The macOS shell will start the same services as bundled sidecars and use loopback or Unix-domain transport. Codex App Server remains on its supported local `stdio` transport.

## Failure behavior

- Mail failure leaves the mail panel in a visible failed state.
- Agent failure leaves email readable and shows Codex as unavailable.
- App Server restart does not fabricate successful turns.
- Demo mail is visibly labeled and never presented as Gmail evidence.
