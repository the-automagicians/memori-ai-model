# n8n-nodes-memori-community

[![npm version](https://img.shields.io/npm/v/n8n-nodes-memori-community.svg)](https://www.npmjs.com/package/n8n-nodes-memori-community)
[![CI](https://github.com/the-automagicians/memori-ai-model/actions/workflows/ci.yml/badge.svg)](https://github.com/the-automagicians/memori-ai-model/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [n8n](https://n8n.io) community node that exposes a **Memori Chat Model** sub-node for the AI Agent.

[Memori](https://github.com/MemoriLabs/Memori) is an open-source memory layer for LLMs. When fronted as an OpenAI-compatible proxy it partitions knowledge per **entity** (end-user), **process** (application) and **session** — but only if the client attaches those identifiers on every request. n8n's built-in OpenAI Chat Model has no UI for that, so this package ships a drop-in replacement that does.

## What it does

Behaves like the built-in OpenAI Chat Model sub-node, plus three required fields — **Entity ID**, **Process ID**, **Session ID** — which are injected into every outgoing chat completion request as a top-level `memori_attribution` object.

### Request shape

Outgoing requests carry the attribution in **both** the body (as `memori_attribution`) **and** as HTTP headers (`X-Memori-*`), so a self-hosted Memori build can read whichever channel it prefers:

```http
POST /v1/chat/completions HTTP/1.1
Authorization: Bearer <key>
Content-Type: application/json
X-Memori-Entity-Id: <userId>
X-Memori-Process-Id: my_n8n_agent
X-Memori-Session-Id: <sessionId>

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

Your Memori proxy reads attribution from whichever channel it prefers, records/retrieves memory for that partition, and forwards the (possibly memory-augmented) request to the upstream model.

## Prerequisites

You need a **self-hosted Memori instance with the OpenAI-compatibility layer enabled**. This node is only the client side — it sends `memori_attribution`-stamped requests to an OpenAI-compatible endpoint, but the endpoint itself is yours to run.

Your Memori build must expose at least:

- `POST /v1/chat/completions` — OpenAI-compatible chat completions (with `Authorization: Bearer <key>` auth, and acceptance of the top-level `memori_attribution` object).
- `GET /v1/models` — the model-list endpoint used to populate the Model dropdown at edit time.

For the OpenAPI schema Memori actually serves, hit `/docs` on your running instance (e.g. `http://<your-memori-host>:8012/docs`).

> **Not a target: hosted Memori Cloud.** The public Memori product at [memorilabs.ai](https://memorilabs.ai/docs/) is an SDK-wrapper architecture (`Memori().llm.register(client)`), plus an MCP server at `https://api.memorilabs.ai/mcp/` that uses `X-Memori-API-Key` auth. It does not expose the OpenAI-compatible chat-completions proxy this node points at. MemoriLabs is building the official n8n MCP integration for that path.

## Install

In self-hosted n8n: **Settings → Community Nodes → Install** → enter `n8n-nodes-memori-community` → **Install**.

> **Note:** This package depends on `@langchain/openai`, which makes it ineligible for n8n Cloud's community-node verification. It targets **self-hosted** n8n.

## Configure

1. Create a **Memori API** credential (installed by this package). Fill:
   - **API Key** — whatever your Memori instance expects on `Authorization: Bearer <key>`
   - **Base URL** — must point at the OpenAI-compatible root on your Memori instance and include the version segment, e.g. `https://<your-memori-host>/v1`.
2. Add an **AI Agent** node. Click the language-model socket and pick **Memori Chat Model**.
3. Fill the fields:

| Field         | Example                                                | Notes                                                 |
|---------------|--------------------------------------------------------|-------------------------------------------------------|
| Model         | pick from dropdown                                     | Loaded live from `{baseUrl}/models`. Switch to **ID** mode for aliases not in the list. |
| Entity ID     | `={{$json.userId}}`                                    | Usually the end-user. Expressions supported.          |
| Process ID    | `my_n8n_agent`                                         | Logical app/process name. Static per workflow is fine.|
| Session ID    | `={{ $json.sessionId ?? $json.userId + '_web' }}`      | Conversation identifier. Expressions supported.       |

Optional fields under **Options**: Base URL override, Sampling Temperature, Maximum Number of Tokens, Timeout, Max Retries.

## Streaming

The node doesn't hard-code `stream`. Whether `stream: true` is sent to Memori depends on how the AI Agent invokes the model:

- **Chat Trigger with Response Mode = "Streaming"** → the AI Agent calls `model.stream(...)`, OpenAI SDK flips to `stream: true`, Memori streams SSE back, n8n forwards tokens to the client. ✅
- **Webhook → AI Agent → Respond to Webhook** (default) → non-streaming; agent collects the full completion and returns it in one shot.

## How it works

The three attribution values ride on two channels so a self-hosted Memori build can read whichever it prefers:

- **Body** — `modelKwargs.memori_attribution` on LangChain.js `ChatOpenAI` serializes as a top-level key in the JSON body.
- **Headers** — `configuration.defaultHeaders` adds `X-Memori-Entity-Id` / `X-Memori-Process-Id` / `X-Memori-Session-Id` to every request.

```ts
new ChatOpenAI({
  apiKey, model,
  configuration: {
    baseURL,
    defaultHeaders: {
      'X-Memori-Entity-Id': entityId,
      'X-Memori-Process-Id': processId,
      'X-Memori-Session-Id': sessionId,
    },
  },
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
- **Body + headers only** — no query-param or payload-envelope support. If a future Memori contract adds more signals, extend `configuration.defaultHeaders` / `modelKwargs` in `supplyData`.
- **No Responses API or built-in tools** (code interpreter, web search, etc.). Kept minimal by design.

## License

MIT © the-automagicians
