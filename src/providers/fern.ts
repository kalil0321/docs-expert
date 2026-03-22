import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

/**
 * Fern docs AI provider.
 *
 * Fern-powered docs expose a public chat endpoint at:
 *   POST {docsUrl}/api/fern-docs/search/v2/chat
 *
 * No authentication required. Response is SSE with event types:
 *   - data-sources: search results / citations
 *   - text-delta: streamed answer text chunks
 *   - text-end / finish-step / finish: completion markers
 */

const USER_AGENT = "ai-sdk/5.0.120 runtime/node";

function buildBody(docsUrl: string, question: string) {
  return {
    url: docsUrl,
    conversationId: crypto.randomUUID(),
    queryId: crypto.randomUUID(),
    id: crypto.randomUUID().slice(0, 16),
    filters: [],
    source: "CHAT",
    documentUrls: [],
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: question }],
        id: crypto.randomUUID().slice(0, 16),
      },
    ],
    trigger: "submit-message",
  };
}

function extractHost(docsUrl: string): string {
  try {
    return new URL(docsUrl).hostname;
  } catch {
    return docsUrl.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function resolveApiUrl(docsUrl: string): string {
  const url = docsUrl.replace(/\/+$/, "");
  const parsed = new URL(url);
  return `${parsed.origin}/docs/api/fern-docs/search/v2/chat`;
}

interface SseEvent {
  type: string;
  data?: unknown;
  id?: string;
  delta?: string;
}

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const raw = line.slice(6);
  try {
    return JSON.parse(raw) as SseEvent;
  } catch {
    return null;
  }
}

export async function askFernDocs(
  docsUrl: string,
  question: string,
): Promise<DocsExpertResponse> {
  const host = extractHost(docsUrl);
  const apiUrl = resolveApiUrl(docsUrl);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "x-fern-host": host,
    },
    body: JSON.stringify(buildBody(docsUrl, question)),
  });

  if (!res.ok) {
    throw new Error(`Fern API error (${res.status}): ${res.statusText}`);
  }

  const text = await res.text();
  const textParts: string[] = [];
  const sources: SearchResult[] = [];

  for (const line of text.split("\n")) {
    const event = parseSseLine(line);
    if (!event) continue;

    if (event.type === "data-sources") {
      const items = event.data as Array<{ title: string; url: string }>;
      for (const item of items) {
        sources.push({
          content: "",
          path: item.url,
          title: item.title,
          href: item.url,
        });
      }
    }

    if (event.type === "text-delta" && event.delta) {
      textParts.push(event.delta);
    }
  }

  return {
    content: textParts.join(""),
    messageId: "",
    searchResults: sources,
    suggestions: [],
    usage: null,
  };
}

export async function* askFernDocsStream(
  docsUrl: string,
  question: string,
): AsyncGenerator<StreamEvent> {
  const host = extractHost(docsUrl);
  const apiUrl = resolveApiUrl(docsUrl);

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "x-fern-host": host,
    },
    body: JSON.stringify(buildBody(docsUrl, question)),
  });

  if (!res.ok) {
    throw new Error(`Fern API error (${res.status}): ${res.statusText}`);
  }

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  const sources: SearchResult[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event) continue;

        if (event.type === "data-sources") {
          const items = event.data as Array<{ title: string; url: string }>;
          const newSources: SearchResult[] = [];
          for (const item of items) {
            const source: SearchResult = {
              content: "",
              path: item.url,
              title: item.title,
              href: item.url,
            };
            sources.push(source);
            newSources.push(source);
          }
          if (newSources.length) {
            yield { type: "searchResults", results: newSources };
          }
        }

        if (event.type === "text-delta" && event.delta) {
          textParts.push(event.delta);
          yield { type: "text", text: event.delta };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: "done",
    response: {
      content: textParts.join(""),
      messageId: "",
      searchResults: sources,
      suggestions: [],
      usage: null,
    },
  };
}
