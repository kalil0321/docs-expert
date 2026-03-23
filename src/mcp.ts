#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ask } from "./providers/mintlify/client.js";
import { askClaudeDocs, askInkeepDocs } from "./providers/claude.js";
import { askStripeDocs } from "./providers/stripe.js";
import { askGitBookDocs } from "./providers/gitbook.js";
import { askFernDocs } from "./providers/fern.js";
import { askReadMeDocs } from "./providers/readme.js";
import { askVercelDocs } from "./providers/vercel.js";
import { askBetterAuthDocs } from "./providers/better-auth.js";
import { resolveProvider } from "./provider-detect.js";
import type { ProviderName } from "./provider-detect.js";
import type { DocsExpertResponse } from "./types.js";

const server = new McpServer({
  name: "docs-expert",
  version: "0.2.0",
});

function formatResponse(response: DocsExpertResponse): string {
  const parts: string[] = [response.content];

  if (response.searchResults.length > 0) {
    parts.push("\n\n---\n**Sources:**");
    for (const r of response.searchResults) {
      parts.push(`- [${r.title}](${r.href})`);
    }
  }

  if (response.suggestions.length > 0) {
    parts.push("\n**Suggested follow-ups:**");
    for (const s of response.suggestions) {
      parts.push(`- ${s}`);
    }
  }

  return parts.join("\n");
}

function askByProvider(
  provider: ProviderName,
  url: string,
  question: string,
): Promise<DocsExpertResponse> {
  switch (provider) {
    case "mintlify":
      return ask(url, question);
    case "fern":
      return askFernDocs(url, question);
    case "gitbook":
      return askGitBookDocs(url, question);
    case "readme":
      return askReadMeDocs(url, question);
    case "inkeep":
      return askInkeepDocs(url, question);
  }
}

// Main tool: auto-detect provider and query any docs site
server.tool(
  "ask_docs",
  "Query any documentation site's AI assistant. Auto-detects the provider (Mintlify, GitBook, Fern, ReadMe, Inkeep) from the URL. No API keys needed.",
  {
    url: z.string().url().describe("The documentation site URL (e.g. https://docs.metronome.com)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const { provider } = await resolveProvider(url);
    const response = await askByProvider(provider, url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Claude/Anthropic docs
server.tool(
  "ask_claude_docs",
  "Query Claude/Anthropic documentation (Agent SDK, API docs, etc.)",
  {
    question: z.string().describe("The question to ask about Claude/Anthropic docs"),
  },
  async ({ question }) => {
    const response = await askClaudeDocs(question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Stripe docs
server.tool(
  "ask_stripe_docs",
  "Query Stripe documentation (payments, subscriptions, Connect, etc.)",
  {
    question: z.string().describe("The question to ask about Stripe docs"),
  },
  async ({ question }) => {
    const response = await askStripeDocs(question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Vercel docs
server.tool(
  "ask_vercel_docs",
  "Query Vercel documentation (deployments, Next.js, serverless functions, etc.)",
  {
    question: z.string().describe("The question to ask about Vercel docs"),
  },
  async ({ question }) => {
    const response = await askVercelDocs(question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Mintlify docs (any Mintlify-powered site)
server.tool(
  "ask_mintlify_docs",
  "Query any Mintlify-powered documentation site (e.g. Metronome, Notte, Turso, etc.)",
  {
    url: z.string().url().describe("The Mintlify docs site URL (e.g. https://docs.metronome.com)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const response = await ask(url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Fern docs (any Fern-powered site)
server.tool(
  "ask_fern_docs",
  "Query any Fern-powered documentation site (e.g. OpenRouter, Square, ElevenLabs, etc.)",
  {
    url: z.string().url().describe("The Fern docs site URL (e.g. https://openrouter.ai/docs)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const response = await askFernDocs(url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// GitBook docs (any GitBook-powered site)
server.tool(
  "ask_gitbook_docs",
  "Query any GitBook-powered documentation site",
  {
    url: z.string().url().describe("The GitBook docs site URL (e.g. https://docs.gitbook.com)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const response = await askGitBookDocs(url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// ReadMe docs (any ReadMe-powered site)
server.tool(
  "ask_readme_docs",
  "Query any ReadMe-powered documentation site",
  {
    url: z.string().url().describe("The ReadMe docs site URL (e.g. https://docs.readme.com)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const response = await askReadMeDocs(url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Inkeep docs (any Inkeep-powered site)
server.tool(
  "ask_inkeep_docs",
  "Query any Inkeep-powered documentation site (e.g. Clerk). Auto-detects API key from page.",
  {
    url: z.string().url().describe("The Inkeep docs site URL (e.g. https://clerk.com/docs)"),
    question: z.string().describe("The question to ask about the documentation"),
  },
  async ({ url, question }) => {
    const response = await askInkeepDocs(url, question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

// Better Auth docs
server.tool(
  "ask_better_auth_docs",
  "Query Better Auth documentation (authentication, sessions, plugins, etc.)",
  {
    question: z.string().describe("The question to ask about Better Auth docs"),
  },
  async ({ question }) => {
    const response = await askBetterAuthDocs(question);
    return { content: [{ type: "text" as const, text: formatResponse(response) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("docs-expert MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
