import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

/**
 * ReadMe docs AI provider.
 *
 * ReadMe-powered docs expose a public Ask AI endpoint at:
 *   POST {docsUrl}/{subdomain}/chatgpt/ask
 *
 * No authentication required. Response is plain markdown (non-streaming).
 */

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function detectSubdomain(docsUrl: string): Promise<string> {
  const res = await fetch(docsUrl, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ReadMe site (${res.status}): ${res.statusText}`,
    );
  }

  const html = await res.text();

  const match =
    html.match(/"subdomain"\s*:\s*"([^"]+)"/) ??
    html.match(/data-subdomain="([^"]+)"/) ??
    html.match(/subdomain&quot;:&quot;([^&]+)&quot;/);

  return match?.[1] ?? "main";
}

function extractSourceLinks(markdown: string): SearchResult[] {
  const sources: SearchResult[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(markdown)) !== null) {
    sources.push({
      content: "",
      path: match[2],
      title: match[1],
      href: match[2],
    });
  }
  return sources;
}

export async function askReadMeDocs(
  docsUrl: string,
  question: string,
): Promise<DocsExpertResponse> {
  const url = docsUrl.replace(/\/+$/, "");
  const subdomain = await detectSubdomain(url);
  const apiUrl = `${url}/${subdomain}/chatgpt/ask`;

  const conversationId = `askAI-${subdomain}-${crypto.randomUUID()}`;
  const messageId = `${Date.now()}-${crypto.randomUUID().slice(0, 7)}`;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      messages: [{ id: messageId, role: "user", content: question }],
      conversation_id: conversationId,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `ReadMe API error (${res.status}): ${res.statusText}`,
    );
  }

  const content = await res.text();
  const sources = extractSourceLinks(content);

  return {
    content,
    messageId: "",
    searchResults: sources,
    suggestions: [],
    usage: null,
  };
}

export async function* askReadMeDocsStream(
  docsUrl: string,
  question: string,
): AsyncGenerator<StreamEvent> {
  // ReadMe returns full response (non-streaming), so yield all at once
  const response = await askReadMeDocs(docsUrl, question);

  if (response.searchResults.length) {
    yield { type: "searchResults", results: response.searchResults };
  }

  yield { type: "text", text: response.content };

  yield { type: "done", response };
}
