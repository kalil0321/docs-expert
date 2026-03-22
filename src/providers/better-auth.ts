import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

/**
 * Better Auth docs AI provider.
 *
 * Better Auth's docs expose a public AI chat endpoint at:
 *   POST https://better-auth.com/api/docs/chat
 *
 * No authentication required. Uses Vercel AI SDK UI message stream protocol (SSE).
 * Event types: start, text, source, error, [DONE]
 */

const CHAT_URL = "https://better-auth.com/api/docs/chat";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface SseEvent {
  type: string;
  text?: string;
  title?: string;
  url?: string;
  errorText?: string;
  [key: string]: unknown;
}

function parseSseLine(line: string): SseEvent | null {
  if (!line.startsWith("data: ")) return null;
  const raw = line.slice(6);
  if (raw === "[DONE]") return { type: "done" };
  try {
    return JSON.parse(raw) as SseEvent;
  } catch {
    return null;
  }
}

export async function askBetterAuthDocs(
  question: string,
): Promise<DocsExpertResponse> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://better-auth.com",
      "Referer": "https://better-auth.com/docs/introduction",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      id: "ai-chat",
      messages: [
        {
          parts: [{ type: "text", text: question }],
          id: crypto.randomUUID().slice(0, 16),
          role: "user",
        },
      ],
      trigger: "submit-message",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Better Auth API error (${res.status}): ${res.statusText}`,
    );
  }

  const text = await res.text();
  const textParts: string[] = [];
  const sources: SearchResult[] = [];

  for (const line of text.split("\n")) {
    const event = parseSseLine(line);
    if (!event) continue;

    if (event.type === "text" && event.text) {
      textParts.push(event.text);
    }
    if (event.type === "source" && event.url) {
      sources.push({
        content: "",
        path: event.url,
        title: event.title ?? "",
        href: event.url,
      });
    }
    if (event.type === "error") {
      throw new Error(event.errorText ?? "Unknown error from Better Auth AI");
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

export async function* askBetterAuthDocsStream(
  question: string,
): AsyncGenerator<StreamEvent> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://better-auth.com",
      "Referer": "https://better-auth.com/docs/introduction",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      id: "ai-chat",
      messages: [
        {
          parts: [{ type: "text", text: question }],
          id: crypto.randomUUID().slice(0, 16),
          role: "user",
        },
      ],
      trigger: "submit-message",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Better Auth API error (${res.status}): ${res.statusText}`,
    );
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

        if (event.type === "text" && event.text) {
          textParts.push(event.text);
          yield { type: "text", text: event.text };
        }

        if (event.type === "source" && event.url) {
          const source: SearchResult = {
            content: "",
            path: event.url,
            title: event.title ?? "",
            href: event.url,
          };
          sources.push(source);
          yield { type: "searchResults", results: [source] };
        }

        if (event.type === "error") {
          throw new Error(
            event.errorText ?? "Unknown error from Better Auth AI",
          );
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
