import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

/**
 * Vercel docs AI provider.
 *
 * Vercel's docs expose a public AI chat endpoint at:
 *   POST https://vercel.com/api/ai-chat
 *
 * No authentication required. Response is SSE with event types:
 *   - text-delta: streamed answer text chunks
 *   - tool-output-available: search results / sources
 *   - start / finish: lifecycle markers
 */

const AI_CHAT_URL = "https://vercel.com/api/ai-chat";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function generateId(length = 16): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

interface SseEvent {
  type: string;
  delta?: string;
  output?: Array<{ title?: string; url?: string }>;
  toolName?: string;
  [key: string]: unknown;
}

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6)) as SseEvent;
  } catch {
    return null;
  }
}

function extractSources(events: SseEvent[]): SearchResult[] {
  const sources: SearchResult[] = [];
  for (const e of events) {
    if (e.type === "tool-output-available" && e.output) {
      for (const item of e.output) {
        if (item.url) {
          sources.push({
            content: "",
            path: item.url,
            title: item.title ?? "",
            href: item.url,
          });
        }
      }
    }
  }
  return sources;
}

export async function askVercelDocs(
  question: string,
): Promise<DocsExpertResponse> {
  const res = await fetch(AI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://vercel.com",
      "Referer": "https://vercel.com/docs",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      id: generateId(),
      currentRoute: "/docs",
      messages: [
        {
          id: generateId(),
          role: "user",
          parts: [{ type: "text", text: question }],
        },
      ],
      trigger: "submit-message",
    }),
  });

  if (!res.ok) {
    throw new Error(`Vercel API error (${res.status}): ${res.statusText}`);
  }

  const text = await res.text();
  const textParts: string[] = [];
  const allEvents: SseEvent[] = [];

  for (const line of text.split("\n")) {
    const event = parseSseLine(line);
    if (!event) continue;
    allEvents.push(event);
    if (event.type === "text-delta" && event.delta) {
      textParts.push(event.delta);
    }
  }

  return {
    content: textParts.join(""),
    messageId: "",
    searchResults: extractSources(allEvents),
    suggestions: [],
    usage: null,
  };
}

export async function* askVercelDocsStream(
  question: string,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(AI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://vercel.com",
      "Referer": "https://vercel.com/docs",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      id: generateId(),
      currentRoute: "/docs",
      messages: [
        {
          id: generateId(),
          role: "user",
          parts: [{ type: "text", text: question }],
        },
      ],
      trigger: "submit-message",
    }),
  });

  if (!res.ok) {
    throw new Error(`Vercel API error (${res.status}): ${res.statusText}`);
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

        if (event.type === "text-delta" && event.delta) {
          textParts.push(event.delta);
          yield { type: "text", text: event.delta };
        }

        if (event.type === "tool-output-available" && event.output) {
          const newSources: SearchResult[] = [];
          for (const item of event.output) {
            if (item.url) {
              const source: SearchResult = {
                content: "",
                path: item.url,
                title: item.title ?? "",
                href: item.url,
              };
              sources.push(source);
              newSources.push(source);
            }
          }
          if (newSources.length) {
            yield { type: "searchResults", results: newSources };
          }
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
