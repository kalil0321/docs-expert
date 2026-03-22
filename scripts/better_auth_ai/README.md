# Better Auth Docs AI Chat - API Client

Reverse-engineered Python API client for the Better Auth documentation AI assistant ("Ask AI" feature on [better-auth.com](https://better-auth.com/docs/introduction)).

## Discovered API

### Endpoint

```
POST https://better-auth.com/api/docs/chat
```

### Protocol

- **Vercel AI SDK UI Message Stream** (`x-vercel-ai-ui-message-stream: v1`)
- **Response format**: Server-Sent Events (SSE) with `text/event-stream` content type
- **Backend LLM provider**: OpenRouter (inferred from error messages)

### Authentication

**None required.** The API is publicly accessible with no cookies, tokens, or API keys. Standard browser-like headers are sent for compatibility.

### Request Format

```json
{
  "id": "ai-chat",
  "messages": [
    {
      "parts": [{"type": "text", "text": "Your question here"}],
      "id": "random16charId",
      "role": "user"
    }
  ],
  "trigger": "submit-message"
}
```

- `id`: Chat session identifier (always `"ai-chat"`)
- `messages`: Array of all messages in the conversation (for multi-turn context)
- `trigger`: Always `"submit-message"`
- Each message has a random 16-character `id`, a `role` (`"user"` or `"assistant"`), and `parts` array

### Response Format (SSE)

```
data: {"type":"start"}
data: {"type":"text","text":"Better Auth is..."}
data: {"type":"text","text":" a framework-agnostic..."}
data: {"type":"source","url":"...","title":"..."}
data: [DONE]
```

Event types:
- `start` - Stream has begun
- `text` - A text chunk of the response
- `source` - A documentation source reference
- `error` - An error occurred (includes `errorText`)
- `[DONE]` - Stream is complete

## Installation

```bash
pip install requests
```

## Usage

### Simple Question

```python
from api_client import BetterAuthDocsChat

chat = BetterAuthDocsChat()
response = chat.ask("How do I set up email and password authentication?")
print(response)
```

### Streaming Response

```python
from api_client import BetterAuthDocsChat

chat = BetterAuthDocsChat()
for event in chat.ask_stream("What is Better Auth?"):
    if event.get("type") == "text":
        print(event["text"], end="", flush=True)
print()
```

### Multi-turn Conversation

```python
from api_client import BetterAuthDocsChat

chat = BetterAuthDocsChat()

# First question
answer1 = chat.ask("What databases does Better Auth support?")
print(answer1)

# Follow-up (includes conversation context)
answer2 = chat.ask("How do I configure PostgreSQL specifically?")
print(answer2)
```

### Get Response with Sources

```python
from api_client import BetterAuthDocsChat

chat = BetterAuthDocsChat()
result = chat.ask_with_sources("How do I add two-factor authentication?")
print(result["text"])
for source in result["sources"]:
    print(f"  Source: {source}")
```

### One-off Question (No State)

```python
from api_client import ask_single_question

answer = ask_single_question("What is Better Auth?")
print(answer)
```

## Running the Demo

```bash
python api_client.py
```

## Limitations

- **Rate limiting**: The API may be rate-limited (server-side). No rate limit headers were observed, but excessive use may be throttled.
- **Credit-based**: The backend uses OpenRouter, which is credit-based. If the site's credits are exhausted, you'll get an "Insufficient credits" error.
- **No authentication**: Since there's no auth, the API could change or add restrictions at any time.
- **Streaming only**: The API only returns SSE streams; there is no non-streaming mode.
- **Context window**: The API sends the full conversation history with each request, so very long conversations may hit token limits.

## Requirements

- Python 3.9+
- `requests` library
