# n8n-nodes-memori

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
  "memori_attribution": {
    "entity_id":  "<userId>",
    "process_id": "my_n8n_agent",
    "session_id": "<sessionId>"
  }
}
```

Your Memori proxy reads `memori_attribution`, records/retrieves memory for that partition, and forwards the (possibly memory-augmented) request to the upstream model.

## Install

### Self-hosted n8n (via Settings UI, after the package is published to npm)

**Settings → Community Nodes → Install** → `n8n-nodes-memori`.

### From a local tarball (before it's on npm, or for testing a fork)

```bash
git clone https://github.com/the-automagicians/memori-ai-model.git
cd memori-ai-model
npm install
npm run build
npm pack                          # produces n8n-nodes-memori-<version>.tgz
```

Then on the n8n host (Docker example):

```bash
# copy the tarball in and install into the container's /home/node/.n8n/nodes
docker cp n8n-nodes-memori-*.tgz n8n:/tmp/
docker exec -u node -w /home/node/.n8n/nodes n8n \
  npm install /tmp/n8n-nodes-memori-*.tgz
docker restart n8n
```

> **Note:** This package depends on `@langchain/openai`, which makes it ineligible for n8n Cloud's community-node verification. It targets **self-hosted** n8n.

## Configure

1. Create a **Memori API** credential (this package installs the credential type). Fill:
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

Optional fields live under **Options**: Base URL override, Sampling Temperature, Maximum Number of Tokens, Timeout, Max Retries.

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

Relevant discussion of the same pattern in the n8n community: <https://community.n8n.io/t/openai-chat-model-support-for-extra-body-option-please/65574>.

## Development

```bash
npm install
npm run build        # one-shot TypeScript build + asset copy via @n8n/node-cli
npm run build:watch  # incremental TypeScript rebuild
npm run lint         # n8n-node lint
npm run lint:fix
```

Repo layout:

```
credentials/
  MemoriApi.credentials.ts   # registers the "Memori API" credential type
  memori.svg
nodes/
  LmChatMemori/
    LmChatMemori.node.ts     # the sub-node
    memori.svg
```

## Limitations

- **Self-hosted n8n only.** Depends on `@langchain/openai`, so the package cannot be verified for n8n Cloud.
- **Top-level body injection only.** If Memori's contract ever changes from `memori_attribution` in the body to a custom HTTP header, the node will need updating (easy change — add to `configuration.defaultHeaders` instead of `modelKwargs`).
- **No streaming tool-call validation** or Responses API support. Kept minimal by design. Open an issue if you need them.

## License

MIT © the-automagicians
