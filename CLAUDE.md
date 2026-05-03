# CLAUDE.md

Instructions for Claude Code agents working in this repo.

## What this is

`n8n-nodes-memori-community` — an n8n community-node package that ships a **Memori Chat Model** sub-node for the AI Agent. Published to npm; users install it via **Settings → Community Nodes** in self-hosted n8n.

The node wraps LangChain.js `ChatOpenAI` and injects a top-level `memori_attribution` object into every outgoing chat completion body so a self-hosted Memori proxy can partition memory per **entity** / **process** / **session**.

## Working tree

```
credentials/MemoriApi.credentials.ts   # "Memori API" credential type
nodes/LmChatMemori/LmChatMemori.node.ts # the sub-node (supplyData returns ChatOpenAI)
.github/workflows/ci.yml                # lint + build on PRs / main
.github/workflows/publish.yml           # OIDC Trusted Publishing on v*.*.* tags
```

## Common commands

```bash
npm install
npm run dev        # local n8n at :5678 with live-reload — fastest inner loop
npm run build      # one-shot TypeScript + asset copy (@n8n/node-cli)
npm run build:watch
npm run lint
npm run lint:fix
npm pack           # produces a tarball for manual install on a remote n8n
```

## Non-obvious conventions (don't regress these)

### 1. Never set `NODE_AUTH_TOKEN` in `publish.yml`

Not even to empty string. Any value — including `''` — makes npm CLI treat it as token auth and skip the OIDC / Trusted Publishing fallback, surfacing as `ENEEDAUTH` or a misleading `404`. The publish step must have **no** `env:` block.

setup-node's placeholder value is benign (npm ignores it when Trusted Publisher is configured). Explicitly setting the var is what breaks things.

### 2. `package.json` `repository.url` must be bare `https://…/repo.git`

Do **not** use the `git+https://…` prefix. The provenance validator checks this against the GitHub repo URL and mismatches return `422 Error verifying sigstore provenance bundle`.

### 3. Attribution is sent on TWO channels

Both must be present; don't remove either:
- **Body** — `modelKwargs.memori_attribution = { entity_id, process_id, session_id }` → serialized as a top-level JSON key. Our self-hosted Memori proxy reads this.
- **Headers** — `configuration.defaultHeaders['X-Memori-{Entity,Process,Session}-Id']`. Our self-hosted proxy also reads these.

This contract is **specific to our self-hosted Memori proxy**, not the public Memori product. See "Memori Cloud compatibility" below.

### 4. Custom fetch wrapper in `LmChatMemori.node.ts` is load-bearing

It does three things; don't simplify:
- **Strips** `top_p`, `n`, `presence_penalty`, `frequency_penalty` from outgoing bodies. LangChain injects these defaults; Anthropic-routed models (Claude Sonnet etc.) reject `temperature + top_p`.
- **Recomputes `Content-Length`** by deleting the stale header. Without this, undici aborts with "Connection error" because the OpenAI SDK stamps Content-Length on the original body and mutating invalidates it.
- Passes the Response through unmodified (so SSE streaming works).

### 5. Credential type is `memoriApi`, not `openAiApi`

The lint rule `@n8n/community-nodes/no-credential-reuse` forbids reusing credential types from other packages. We define our own `MemoriApi` credential even though its shape mirrors the OpenAI one.

### 6. Don't import n8n internal packages

These look useful but are not resolvable from community nodes:
- `@n8n/ai-utilities` (for `N8nLlmTracing`, `makeN8nLlmFailedAttemptHandler`, etc.)
- `@n8n/di`, `@n8n/config`

The built-in OpenAI Chat Model node uses them; we explicitly don't.

### 7. `prepublishOnly` gates direct `npm publish`

`n8n-node prerelease` (set as `prepublishOnly`) refuses raw `npm publish` with `Run npm run release to publish the package`. The publish workflow calls `npm run release` — not `npm publish` directly.

### 8. Cloud-support is disabled

We depend on `@langchain/openai`, which disqualifies us from n8n Cloud verification. `eslint.config.mjs` uses `configWithoutCloudSupport`; `package.json` has `n8n.strict: false`. Don't re-enable cloud-support (`npx n8n-node cloud-support enable`) — it'll flag the LangChain dep and the credential as errors.

### 9. `Enable Thinking` toggle injects `chat_template_kwargs.enable_thinking` unconditionally

Added in 0.2.0. The boolean (default `false`) is **always** serialized as `chat_template_kwargs: { enable_thinking: <bool> }` on the request body via `modelKwargs` — not only when ON. Verified safe via Memori proxy: it strips the field when forwarding to OpenAI routes (proven against `gpt-4.1-mini` 2026-04-29), and vLLM/SGLang templates that don't reference `enable_thinking` ignore it. Don't make injection conditional without a reason — always-send keeps the body shape predictable and avoids workflow-version skew.

The Memori proxy currently strips upstream `reasoning` / `reasoning_content` from responses, so end users won't see the chain-of-thought even with the toggle on (token-count delta proves vLLM is doing the work). That's a proxy-side concern, not a node bug.

### 10. `Incognito` field is `options` (False / True dropdown), not `boolean`, by design

Added in 0.3.2 (skipped 0.3.0/0.3.1 — see release-versioning note below). The field type is `options` with values `'false'` / `'true'` (string-typed values, default `'false'`) so the editor renders a dropdown for the common static case while still exposing the cog → **Expression** switch for the user's stated workflow ("paste an expression that resolves at runtime"). A `boolean` toggle would also support expressions via the cog, but rendering as False/True in the dropdown matches the textual values that flow through expressions and proxy headers, removing one mental step.

### 11. Release versioning skips stale tags from the renamed predecessor

The repo previously published as `n8n-nodes-memori`, which carried tags up to `v0.4.0`. After the rename to `n8n-nodes-memori-community` (commit `6a8fb16`) the version was reset to `0.1.0`, and npm history under the new name is `0.1.0 → 0.1.1 → 0.1.2 → 0.2.0 → 0.3.2`. Tags `v0.3.0`, `v0.3.1`, `v0.4.0` exist in `git tag -l` but belong to the old package and don't match anything on the current npm name.

When bumping versions, **don't reuse a tag that already exists for the predecessor** — `git tag -a` will refuse and you'll discover this at release time. Skip past it (e.g. `0.3.2` instead of retagging `0.3.0`) rather than rewriting history. The old tags are kept for forensics; deleting them gains nothing and breaks anyone who already fetched them.

`supplyData` parses leniently to match the proxy's `_is_incognito` contract: `1 | true | yes | on` (case-insensitive, trimmed) is truthy; everything else (including `''`, `'false'`, undefined, `0`) is falsy. The resolved boolean is sent on **both channels** following rule #3:
- Header `X-Memori-Incognito: 'true'|'false'` (always sent — see rule #9).
- Body `modelKwargs.incognito = <bool>` → top-level `incognito` key in JSON.

Memori proxy v10 reads either; `false` / absent / unknown is non-incognito. Do not make either channel conditional without a reason.

## Release process

1. Bump `version` in `package.json`.
2. Commit → `git tag -a vX.Y.Z -m "…"` → push commit **and** tag.
3. `publish.yml` runs automatically: lint + build + `npm publish --provenance` via OIDC. No secrets needed — npm Trusted Publishing is configured for this repo on npmjs.com.

## Deploying to the dev n8n (self-hosted, Docker)

For pre-release testing before publishing to npm:

```bash
npm pack                                   # -> n8n-nodes-memori-community-X.Y.Z.tgz
scp n8n-nodes-memori-community-*.tgz linuxuser@imago-n8n-dev.bengal-major.ts.net:/tmp/
ssh linuxuser@imago-n8n-dev.bengal-major.ts.net '
  docker cp /tmp/n8n-nodes-memori-community-*.tgz n8n:/tmp/
  docker exec -u node -w /home/node/.n8n/nodes n8n npm install /tmp/n8n-nodes-memori-community-*.tgz
  docker restart n8n
'
```

A hard browser refresh is required to pick up new node definitions in the n8n editor.

## Testing the node end-to-end

Minimal direct repro (bypasses n8n UI), runs inside the `n8n` container on the dev host:

```bash
docker exec -u node n8n node -e '
  const { ChatOpenAI } = require("/home/node/.n8n/nodes/node_modules/@langchain/openai");
  // construct ChatOpenAI with the same args supplyData uses, then invoke
'
```

Memori lives on our internal tailnet at `http://gpu-vps.bengal-major.ts.net:8012/v1` (current host as of 2026-04-28; previously `admiral` / `100.119.117.6`). The "Memori account" credential in the dev n8n is the source of truth if this drifts. On that instance, `/v1/models` is unauthenticated while `/v1/chat/completions` validates the bearer token, so the model dropdown populates even when the API key is wrong.

## Memori Cloud compatibility (per memorilabs.ai docs)

This node **only talks to our self-hosted Memori proxy**, not to the public Memori product. The public surface is different in shape:

- **Memori Cloud** (`memorilabs.ai`) is an SDK-wrapper architecture (`Memori().llm.register(client)` + `mem.attribution(...)`), not an OpenAI-compatible chat-completions proxy. There is no public `/v1/chat/completions` endpoint to point a `ChatOpenAI` base URL at.
- **Memori MCP server** at `https://api.memorilabs.ai/mcp/` uses `X-Memori-API-Key` (not `Authorization: Bearer`), `X-Memori-Entity-Id`, `X-Memori-Process-Id`. Session is server-derived as `<entity_id>-<UTC YYYY-MM-DD:HH>` — no `X-Memori-Session-Id` header is accepted.
- **`memori-byodb`** (their self-hosted variant) is also SDK-wrapper based; the OpenAI-compatible proxy contract this node assumes is **our internal proxy**, not part of the documented Memori contract.

Implication: an n8n integration with hosted Memori needs a different node shape (an MCP tool-node, or an SDK pre/post pair). MemoriLabs is building the n8n MCP integration; we are not duplicating that here.

## Useful pointers

- Reference implementation for patterns: `packages/@n8n/nodes-langchain/nodes/llms/LMChatOpenAi/LmChatOpenAi.node.ts` in [n8n-io/n8n](https://github.com/n8n-io/n8n).
- Future rewrite candidate: the `programmatic/custom-chat-model` template (`npx @n8n/node-cli new ... --template programmatic/custom-chat-model`) uses `@n8n/ai-node-sdk` (peerDep) — drops the `@langchain/openai` dep and unlocks n8n Cloud eligibility. Meaningful rewrite; parked for now.
