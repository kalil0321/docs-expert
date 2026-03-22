# Vercel Docs AI Chat API Client

Reverse-engineered Python client for the **"Ask AI"** feature on [vercel.com/docs](https://vercel.com/docs).

## Discovered APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/ai-chat` | POST | Main AI chat endpoint. Streams responses via SSE (Server-Sent Events). |
| `/api/ai-chat/title` | POST | Generates a short title for a given query. |

## Authentication

**No authentication required.** The API is publicly accessible — no API keys, tokens, or login needed. Requests only need standard browser-like headers (`origin`, `referer`, `content-type`).

Cookies are set automatically by the browser but are **not required** for the API to function.

## Installation

```bash
pip install requests
```

## Quick Start

### One-shot question

```python
from api_client import ask_vercel_docs

answer = ask_vercel_docs("What is Vercel Edge Middleware?")
print(answer)
```

### Streaming response

```python
from api_client import ask_vercel_docs_stream

for event in ask_vercel_docs_stream("How do I deploy a Next.js app?"):
    if event.get("type") == "text-delta":
        print(event["delta"], end="", flush=True)
```

### Multi-turn conversation

```python
from api_client import VercelDocsAI

client = VercelDocsAI()
answer1 = client.ask("What is Vercel KV?")
answer2 = client.ask("How do I set it up?")  # Follows up with context
```

### Generate a chat title

```python
from api_client import VercelDocsAI

client = VercelDocsAI()
title = client.generate_title("How do environment variables work?")
print(title)  # e.g. "How do Vercel environment variables work?"
```

## API Details

### `POST /api/ai-chat`

Main conversational endpoint. Sends a chat history and streams back an AI response.

**Request body:**

```json
{
  "id": "GcfHmZ7BH2qcXO2D",
  "currentRoute": "/docs",
  "trigger": "submit-message",
  "messages": [
    {
      "id": "mKNbz3qKyTL9ItcX",
      "role": "user",
      "parts": [{"type": "text", "text": "What is Vercel?"}]
    }
  ]
}
```

**Response:** Server-Sent Events (SSE) stream with these event types:

| Event Type | Description |
|---|---|
| `start` | Stream started |
| `start-step` | New processing step |
| `tool-input-start` | AI is calling a tool (knowledge base search) |
| `tool-input-delta` | Incremental tool input |
| `tool-input-available` | Full tool input available |
| `tool-output-available` | Tool results (documentation sources) |
| `text-start` | Text generation started |
| `text-delta` | Incremental text chunk |
| `finish-step` | Step completed |
| `finish` | Stream finished |

### `POST /api/ai-chat/title`

Generates a concise title for a chat query.

**Request body:**

```json
{"query": "What is Vercel Edge Middleware?"}
```

**Response:**

```json
{"title": "What is Vercel Edge Middleware?"}
```

## Class Reference

### `VercelDocsAI`

Full-featured client supporting multi-turn conversations.

- `__init__(current_route="/docs")` — Initialize with optional page context
- `ask(question, stream=False)` — Ask a question; returns text or event generator
- `generate_title(query)` — Generate a title for a query
- `reset()` — Clear conversation history

### Convenience Functions

- `ask_vercel_docs(question)` — One-shot question, returns text
- `ask_vercel_docs_stream(question)` — One-shot question, returns SSE event generator

## Limitations

- **Rate limiting:** The API may rate-limit requests if used excessively (no specific limits documented).
- **No authentication bypass:** This is a public API; behavior may change without notice.
- **Knowledge scope:** The AI only answers questions about Vercel documentation, Next.js, and related topics.
- **SSE format:** Responses are streamed — the client must handle chunked transfer encoding.
- **Context window:** Very long multi-turn conversations may hit token limits.

## Requirements

- Python 3.10+
- `requests` library
