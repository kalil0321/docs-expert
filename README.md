<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/kalil0321/docs-expert/main/.github/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/kalil0321/docs-expert/main/.github/banner-light.svg">
    <img alt="docs-expert" src="https://raw.githubusercontent.com/kalil0321/docs-expert/main/.github/banner-dark.svg" width="600">
  </picture>
</p>

<p align="center">
  <strong>Query any documentation site's AI assistant from the terminal</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/docs-expert"><img src="https://img.shields.io/npm/v/docs-expert?color=8b5cf6&label=npm" alt="npm"></a>
  <a href="https://github.com/kalil0321/docs-expert"><img src="https://img.shields.io/badge/license-MIT-8b5cf6" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-8b5cf6" alt="node"></a>
  <a href="https://github.com/kalil0321/docs-expert/actions/workflows/ci.yml"><img src="https://github.com/kalil0321/docs-expert/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/kalil0321/docs-expert"><img src="https://raw.githubusercontent.com/kalil0321/docs-expert/main/.github/badges/coverage.svg" alt="coverage"></a>
</p>

---

CLI + TypeScript library that taps into the **AI assistants already embedded** in documentation platforms. No API keys, no scraping, no token costs — just answers from the source.

Supports **9 providers** out of the box:

| Provider | Flag | Sites |
|----------|------|-------|
| Auto-detect | `<url> <question>` | Automatically detects the provider (Mintlify, GitBook, Fern, ReadMe, Inkeep) |
| [Claude/Anthropic](https://docs.anthropic.com) | `--claude` | Claude Agent SDK, API docs |
| [Stripe](https://docs.stripe.com) | `--stripe` | Stripe docs |
| [Vercel](https://vercel.com/docs) | `--vercel` | Vercel docs |
| [Better Auth](https://better-auth.com) | `--better-auth` | Better Auth docs |
| [GitBook](https://gitbook.com) | `--gitbook <url>` | Any GitBook-powered site |
| [Fern](https://buildwithfern.com) | `--fern <url>` | 150+ sites (OpenRouter, Square, ElevenLabs, ...) |
| [ReadMe](https://readme.com) | `--readme <url>` | Any ReadMe-powered site |
| [Inkeep](https://inkeep.com) | `--inkeep <url>` | Any Inkeep-powered site (Clerk, ...) — auto-detects API key |

```
  ◆ docs-expert v0.1.0
  query any documentation site's AI assistant

  ✓ Done.

  ── Answer ──────────────────────────────────────────────

  Metronome is a billing platform that transforms your
  customers' usage into precise, tailored invoices...

  ── Sources ─────────────────────────────────────────────

  ◆ How Metronome works
    https://docs.metronome.com/guides/get-started/how-metronome-works
```

## Install

```bash
npm install -g docs-expert
```

## CLI

```bash
# Auto-detect provider and query (works with any supported site)
docs-expert https://docs.metronome.com "What is Metronome?"
docs-expert https://clerk.com/docs "How do I protect API routes?"
docs-expert https://openrouter.ai/docs "What models are available?"

# Query Claude/Anthropic docs
docs-expert --claude "How do I use the Agent SDK?"

# Query Stripe docs
docs-expert --stripe "How do I create a payment intent?"

# Query Vercel docs
docs-expert --vercel "How do I deploy a Next.js app?"

# Query Better Auth docs
docs-expert --better-auth "How do I set up email and password auth?"

# Query any GitBook site
docs-expert --gitbook https://docs.gitbook.com "How do I create a space?"

# Query any Fern site
docs-expert --fern https://openrouter.ai/docs "What models are available?"

# Query any ReadMe site
docs-expert --readme https://docs.readme.com "How do I set up API docs?"

# Query any Inkeep-powered site (auto-detects API key)
docs-expert --inkeep https://clerk.com/docs "How do I protect API routes?"

# JSON output
docs-expert --claude --json "What is the Agent SDK?"

# Interactive mode
docs-expert
```

## Library

```typescript
import { ask, askStream, askClaudeDocs, askStripeDocs, askFernDocs, askVercelDocs, resolveProvider } from "docs-expert";

// Auto-detect provider
const { provider } = await resolveProvider("https://clerk.com/docs");
// provider === "inkeep"

// Mintlify (any site)
const response = await ask("https://docs.metronome.com", "What is Metronome?");
console.log(response.content);
console.log(response.searchResults);

// Claude docs
const claude = await askClaudeDocs("How do I use tools?");

// Stripe docs
const stripe = await askStripeDocs("What is a payment intent?");

// Fern docs (any site)
const fern = await askFernDocs("https://openrouter.ai/docs", "What models are available?");

// Vercel docs
const vercel = await askVercelDocs("How do I deploy?");
```

### Streaming

```typescript
import { askStream } from "docs-expert";

for await (const event of askStream("https://docs.notte.cc", "What is Notte?")) {
  if (event.type === "text") process.stdout.write(event.text);
  else if (event.type === "done") console.log("\nSources:", event.response.searchResults);
}
```

### Stateful client (multi-turn)

```typescript
import { createClient } from "docs-expert";

const client = createClient("https://docs.metronome.com");
const r1 = await client.ask("What is Metronome?");
const r2 = await client.ask("How do I set up billing?"); // has conversation context
client.clearHistory();
```

## How it works

docs-expert reverse-engineers the AI assistants that documentation platforms embed in their sites. Each provider has its own API pattern:

- **Mintlify** — SSE streaming via `leaves.mintlify.com`, auto-detects subdomain from page HTML
- **Inkeep** (Claude, Clerk, etc.) — SHA-256 challenge-response auth, OpenAI-compatible chat completions API
- **Stripe** — Polling-based API at `ai.stripe.com`, creates threads and polls for responses
- **GitBook** — Next.js Server Actions with RSC streaming, dynamically discovers action hash from JS bundles
- **Fern** — SSE streaming at `/api/fern-docs/search/v2/chat`, zero auth
- **ReadMe** — Non-streaming JSON at `/{subdomain}/chatgpt/ask`, zero auth
- **Vercel** — SSE streaming at `/api/ai-chat`, Vercel AI SDK protocol
- **Better Auth** — SSE streaming at `/api/docs/chat`, Vercel AI SDK protocol

No API keys required. No scraping. No LLM costs. Just the built-in AI that's already there.

## Disclaimer

> **This package is not affiliated with, endorsed by, or associated with any of the documentation platforms it supports.**
>
> `docs-expert` interacts with publicly accessible AI assistant endpoints — the same ones used by the chat widgets embedded on documentation sites. No authentication is bypassed, no private data is accessed, and no rate limiting is circumvented.
>
> This is an independent open-source project built for developer convenience. Use it responsibly and in accordance with the terms of service of the documentation sites you query. The authors assume no liability for misuse.

## License

MIT — see [LICENSE](./LICENSE) for details.

---
