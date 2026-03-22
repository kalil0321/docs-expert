import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

const BASE_URL = "https://ai.stripe.com";
const DOCS_URL = "https://docs.stripe.com";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Origin": DOCS_URL,
  "Referer": `${DOCS_URL}/`,
  "User-Agent": USER_AGENT,
};

interface ThreadResponse {
  thread_id: string;
  conversation_id: string;
  answerable?: boolean;
  sources?: Array<{ title?: string; url?: string }>;
}

interface PollResponse {
  content?: string;
  is_complete?: boolean;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Stripe AI error (${res.status}): ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function createThread(
  question: string,
  clientId: string,
): Promise<ThreadResponse> {
  // Fetch page content for context (best-effort)
  let pageContent = "";
  try {
    const res = await fetch(`${DOCS_URL}/.md`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.ok) pageContent = await res.text();
  } catch { /* ignore */ }

  return post<ThreadResponse>(`${BASE_URL}/assistant/thread`, {
    question,
    message_metadata: { question_type: "chat" },
    client: "docs",
    client_id: clientId,
    question_metadata: {
      stripe_doc: {
        url: "/",
        title: "Stripe Documentation",
        prefs: {},
        content: pageContent,
      },
    },
  });
}

async function* pollResponse(
  conversationId: string,
  clientId: string,
  pollInterval = 500,
  maxPolls = 120,
): AsyncGenerator<string> {
  let offset = 0;

  for (let i = 0; i < maxPolls; i++) {
    const data = await post<PollResponse>(
      `${BASE_URL}/smart-docs/get-streaming-ask-summary-state`,
      {
        conversation_id: conversationId,
        offset,
        client: "docs",
        client_id: clientId,
      },
    );

    if (data.content) {
      offset += data.content.length;
      yield data.content;
    }

    if (data.is_complete) return;

    await sleep(pollInterval);
  }
}

function toSearchResults(
  sources: Array<{ title?: string; url?: string }> | undefined,
): SearchResult[] {
  if (!sources) return [];
  return sources.map((s) => {
    const url = s.url ?? "";
    const href = url.startsWith("http") ? url : `${DOCS_URL}${url}`;
    return { content: "", path: url, title: s.title ?? "", href };
  });
}

export async function askStripeDocs(
  question: string,
): Promise<DocsExpertResponse> {
  const clientId = crypto.randomUUID();
  const thread = await createThread(question, clientId);

  if (thread.answerable === false) {
    return {
      content: "The AI assistant determined this question is not answerable from Stripe docs.",
      messageId: thread.thread_id,
      searchResults: toSearchResults(thread.sources),
      suggestions: [],
      usage: null,
    };
  }

  const textParts: string[] = [];
  for await (const chunk of pollResponse(thread.conversation_id, clientId)) {
    textParts.push(chunk);
  }

  return {
    content: textParts.join(""),
    messageId: thread.thread_id,
    searchResults: toSearchResults(thread.sources),
    suggestions: [],
    usage: null,
  };
}

export async function* askStripeDocsStream(
  question: string,
): AsyncGenerator<StreamEvent> {
  const clientId = crypto.randomUUID();
  const thread = await createThread(question, clientId);
  const sources = toSearchResults(thread.sources);

  if (sources.length) {
    yield { type: "searchResults", results: sources };
  }

  if (thread.answerable === false) {
    const content = "The AI assistant determined this question is not answerable from Stripe docs.";
    yield { type: "text", text: content };
    yield {
      type: "done",
      response: {
        content,
        messageId: thread.thread_id,
        searchResults: sources,
        suggestions: [],
        usage: null,
      },
    };
    return;
  }

  const textParts: string[] = [];
  for await (const chunk of pollResponse(thread.conversation_id, clientId)) {
    textParts.push(chunk);
    yield { type: "text", text: chunk };
  }

  yield {
    type: "done",
    response: {
      content: textParts.join(""),
      messageId: thread.thread_id,
      searchResults: sources,
      suggestions: [],
      usage: null,
    },
  };
}
