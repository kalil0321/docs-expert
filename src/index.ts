export { ask, askStream, createClient } from "./providers/mintlify/client.js";
export { askClaudeDocs, askClaudeDocsStream, askInkeepDocs, askInkeepDocsStream } from "./providers/claude.js";
export { askStripeDocs, askStripeDocsStream } from "./providers/stripe.js";
export { askGitBookDocs, askGitBookDocsStream } from "./providers/gitbook.js";
export { askFernDocs, askFernDocsStream } from "./providers/fern.js";
export { askReadMeDocs, askReadMeDocsStream } from "./providers/readme.js";
export { askVercelDocs, askVercelDocsStream } from "./providers/vercel.js";
export { askBetterAuthDocs, askBetterAuthDocsStream } from "./providers/better-auth.js";
export { detectProvider, resolveProvider } from "./provider-detect.js";
export type { ProviderName } from "./provider-detect.js";
export type {
  DocsExpertOptions,
  DocsExpertResponse,
  Message,
  SearchResult,
  StreamEvent,
} from "./types.js";
