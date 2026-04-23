# n8n-nodes-memori

[![npm version](https://img.shields.io/npm/v/n8n-nodes-memori.svg)](https://www.npmjs.com/package/n8n-nodes-memori)
[![CI](https://github.com/the-automagicians/memori-ai-model/actions/workflows/ci.yml/badge.svg)](https://github.com/the-automagicians/memori-ai-model/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [n8n](https://n8n.io) community node that exposes a **Memori Chat Model** sub-node for the AI Agent.

[Memori](https://github.com/GibsonAI/memori) is an open-source, self-hosted memory layer for LLMs. When fronted as an OpenAI-compatible proxy it partitions knowledge per **entity** (end-user), **process** (application) and **session** — but only if the client attaches those identifiers on every request. n8n's built-in OpenAI Chat Model has no UI for that, so this package ships a drop-in replacement that does.

## What it does

Behaves like the built-in OpenAI Chat Model sub-node, plus three required fields — **Entity ID**, **Process ID**, **Session ID** — which are injected into every outgoing chat completion request as a top-level `memori_attribution` object.

### Request shape

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "..." }
  ],
  "temperature": 0.7,
  "stream": false,
  "memori_attribution": {
    "entity_id":  "<userId>",
    "process_id": "my_n8n_agent",
    "session_id": "<sessionId>"
  }
}
```

Your Memori proxy reads `memori_attribution`, records/retrieves memory for that partition, and forwards the (possibly memory-augmented) request to the upstream model.

## Install

In self-hosted n8n: **Settings → Community Nodes → Install** → enter `n8n-nodes-memori` → **Install**.

> **Note:** This package depends on `@langchain/openai`, which makes it ineligible for n8n Cloud's community-node verification. It targets **self-hosted** n8n.

## Configure

1. Create a **Memori API** credential (installed by this package). Fill:
   - **API Key** — whatever your Memori instance expects on `Authorization: Bearer <key>`
   - **Base URL** — e.g. `http://memori.internal:8012/v1` (must include the `/v1` — or whatever path your Memori build serves)
2. Add an **AI Agent** node. Click the language-model socket and pick **Memori Chat Model**.
3. Fill the fields:

| Field         | Example                                                | Notes                                                 |
|---------------|--------------------------------------------------------|-------------------------------------------------------|
| Model         | `gpt-4o-mini`                                          | Whatever alias your Memori server accepts             |
| Entity ID     | `={{$json.userId}}`                                    | Usually the end-user. Expressions supported.          |
| Process ID    | `my_n8n_agent`                                         | Logical app/process name. Static per workflow is fine.|
| Session ID    | `={{ $json.sessionId ?? $json.userId + '_web' }}`      | Conversation identifier. Expressions supported.       |

Optional fields under **Options**: Base URL override, Sampling Temperature, Maximum Number of Tokens, Timeout, Max Retries.

## Streaming

The node doesn't hard-code `stream`. Whether `stream: true` is sent to Memori depends on how the AI Agent invokes the model:

- **Chat Trigger with Response Mode = "Streaming"** → the AI Agent calls `model.stream(...)`, OpenAI SDK flips to `stream: true`, Memori streams SSE back, n8n forwards tokens to the client. ✅
- **Webhook → AI Agent → Respond to Webhook** (default) → non-streaming; agent collects the full completion and returns it in one shot.

## How it works

The three attribution values are passed into LangChain.js `ChatOpenAI` via `modelKwargs`, which serializes them as top-level keys in the JSON body sent to the OpenAI-compatible endpoint. No HTTP-layer interception, no custom SDK fork.

```ts
new ChatOpenAI({
  apiKey, model, configuration: { baseURL },
  modelKwargs: {
    memori_attribution: { entity_id, process_id, session_id },
  },
});
```

A small `fetch` wrapper strips LangChain-injected defaults (`top_p`, `n`, `presence_penalty`, `frequency_penalty`) from outgoing bodies and recomputes `Content-Length`, so the node works cleanly against both OpenAI-backed and Anthropic-backed models routed through Memori (otherwise Anthropic rejects `temperature` + `top_p` together).

Relevant discussion in the n8n community: <https://community.n8n.io/t/openai-chat-model-support-for-extra-body-option-please/65574>.

## Development

```bash
git clone https://github.com/the-automagicians/memori-ai-model.git
cd memori-ai-model
npm install

npm run dev          # spins up a local n8n with the node pre-installed + live reload
npm run build        # one-shot TypeScript build + asset copy (@n8n/node-cli)
npm run build:watch  # incremental TypeScript rebuild
npm run lint
npm run lint:fix
```

`npm run dev` is the fastest inner loop: it starts a sub-process n8n at `http://localhost:5678` with the node auto-installed into `~/.n8n-node-cli`, and rebuilds on save.

### Repo layout

```
credentials/
  MemoriApi.credentials.ts   # Memori API credential type
  memori.svg
nodes/
  LmChatMemori/
    LmChatMemori.node.ts     # the sub-node
    memori.svg
.github/workflows/
  ci.yml                     # lint + build on PRs and main
  publish.yml                # publishes to npm on v*.*.* tags
```

### Release process

1. Bump `version` in `package.json`.
2. Commit, `git tag -a vX.Y.Z -m "..."`, push the commit **and** the tag.
3. `publish.yml` runs lint + build, then `npm publish --provenance`.

Publishing uses npm Trusted Publishing (OIDC) when configured on the package page; otherwise falls back to `NPM_TOKEN`.

## Limitations

- **Self-hosted n8n only.** Depends on `@langchain/openai`, so the package cannot be verified for n8n Cloud.
- **Top-level body injection only.** If Memori's contract ever changes from `memori_attribution` in the body to a custom HTTP header, switch to `configuration.defaultHeaders` instead of `modelKwargs`.
- **No Responses API or built-in tools** (code interpreter, web search, etc.). Kept minimal by design.

## License

MIT © the-automagicians
