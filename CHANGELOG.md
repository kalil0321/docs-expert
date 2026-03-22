# Changelog

## [0.1.0] - 2026-03-22

### Added
- CLI to query any documentation site's AI assistant
- Auto-detect provider from any docs URL
- 8 providers supported: Mintlify, GitBook, Fern, ReadMe, Inkeep, Vercel, Stripe, Claude/Anthropic
- TypeScript library with `ask`, `askStream`, and `createClient` APIs
- Provider detection cache (`~/.config/docs-expert/provider-cache.json`)
- Streaming support with real-time progress
- `--json` flag for raw JSON output
- Interactive mode (prompts for URL and question)
- Markdown rendering in terminal
