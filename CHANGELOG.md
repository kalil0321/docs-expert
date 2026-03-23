# Changelog

## [0.2.0] - 2026-03-23

### Added
- MCP server (`docs-expert-mcp`) with 10 tools for all providers
- `askMintlifyDocs` / `askMintlifyDocsStream` named exports for consistency
- MCP section in README with Claude Desktop and Claude Code config examples

### Changed
- Redesigned CLI UI: structured separators (`// ANSWER`, `// SOURCES`), arc spinner, numbered sources
- Redesigned SVG banners with dot grid background, crosshairs, and provider badges
- Mintlify suggestions now resolve to full URLs instead of bare paths

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
