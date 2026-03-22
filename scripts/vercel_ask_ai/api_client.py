"""
Vercel Docs AI Chat API Client

Reverse-engineered API client for interacting with the "Ask AI" feature
on https://vercel.com/docs. Uses Server-Sent Events (SSE) streaming.

No authentication required - the API is publicly accessible.
"""

import json
import uuid
import requests
from typing import Generator, Optional


BASE_URL = "https://vercel.com"
AI_CHAT_URL = f"{BASE_URL}/api/ai-chat"
AI_CHAT_TITLE_URL = f"{BASE_URL}/api/ai-chat/title"

DEFAULT_HEADERS = {
    "accept": "*/*",
    "content-type": "application/json",
    "origin": "https://vercel.com",
    "referer": "https://vercel.com/docs",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/134.0.0.0 Safari/537.36"
    ),
}


def _generate_id(length: int = 16) -> str:
    """Generate a random alphanumeric ID similar to Vercel's format."""
    import random
    import string
    chars = string.ascii_letters + string.digits
    return "".join(random.choices(chars, k=length))


def _parse_sse_stream(response: requests.Response) -> Generator[dict, None, None]:
    """Parse a Server-Sent Events stream and yield parsed JSON data events."""
    for line in response.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            data_str = line[6:]  # Remove "data: " prefix
            try:
                yield json.loads(data_str)
            except json.JSONDecodeError:
                continue


class VercelDocsAI:
    """Client for the Vercel Docs AI Chat API.

    This client interacts with the "Ask AI" feature on Vercel's documentation
    site. It supports multi-turn conversations and streams responses via SSE.

    Example:
        >>> client = VercelDocsAI()
        >>> response = client.ask("How do I deploy a Next.js app?")
        >>> print(response)
    """

    def __init__(self, current_route: str = "/docs"):
        """Initialize the Vercel Docs AI client.

        Args:
            current_route: The docs page route context for the AI.
                          Defaults to "/docs" (main docs page).
        """
        self.current_route = current_route
        self.chat_id = _generate_id()
        self.messages: list[dict] = []
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def ask(
        self,
        question: str,
        stream: bool = False,
    ) -> str | Generator[dict, None, None]:
        """Ask a question to the Vercel Docs AI.

        Args:
            question: The question to ask.
            stream: If True, returns a generator yielding SSE events.
                   If False, returns the complete text response.

        Returns:
            Complete text response string, or generator of SSE events if stream=True.
        """
        # Create user message
        user_message = {
            "id": _generate_id(),
            "role": "user",
            "parts": [{"type": "text", "text": question}],
        }

        # Build request payload
        payload = {
            "id": self.chat_id,
            "currentRoute": self.current_route,
            "messages": self.messages + [user_message],
            "trigger": "submit-message",
        }

        response = self.session.post(
            AI_CHAT_URL,
            json=payload,
            stream=True,
            timeout=60,
        )
        response.raise_for_status()

        if stream:
            return self._stream_events(response, user_message, question)
        else:
            return self._collect_response(response, user_message, question)

    def _stream_events(
        self,
        response: requests.Response,
        user_message: dict,
        question: str,
    ) -> Generator[dict, None, None]:
        """Stream SSE events from the response.

        Yields dicts with event data. Key event types:
        - {"type": "text-delta", "delta": "..."} - Text chunk
        - {"type": "tool-input-available", ...} - Tool call with input
        - {"type": "tool-output-available", ...} - Tool result with sources
        - {"type": "start"} / {"type": "finish"} - Stream lifecycle
        """
        full_text = ""
        assistant_parts = []
        current_tool_calls = {}

        for event in _parse_sse_stream(response):
            yield event
            event_type = event.get("type", "")

            if event_type == "text-delta":
                full_text += event.get("delta", "")
            elif event_type == "step-start":
                assistant_parts.append({"type": "step-start"})
            elif event_type == "tool-output-available":
                tool_call_id = event.get("toolCallId", "")
                tool_name = event.get("toolName", "askKnowledgeBase")
                tool_input = current_tool_calls.get(tool_call_id, {})
                assistant_parts.append({
                    "type": f"tool-{tool_name}",
                    "toolCallId": tool_call_id,
                    "state": "output-available",
                    "input": tool_input,
                    "output": event.get("output", []),
                })
            elif event_type == "tool-input-available":
                tool_call_id = event.get("toolCallId", "")
                current_tool_calls[tool_call_id] = event.get("input", {})

        # Store messages for multi-turn conversation
        if full_text:
            assistant_parts.append({"type": "text", "text": full_text})

        self.messages.append(user_message)
        self.messages.append({
            "id": _generate_id(),
            "role": "assistant",
            "parts": assistant_parts,
        })

    def _collect_response(
        self,
        response: requests.Response,
        user_message: dict,
        question: str,
    ) -> str:
        """Collect the full streamed response into a single text string."""
        full_text = ""
        assistant_parts = []
        current_tool_calls = {}

        for event in _parse_sse_stream(response):
            event_type = event.get("type", "")

            if event_type == "text-delta":
                full_text += event.get("delta", "")
            elif event_type == "step-start":
                assistant_parts.append({"type": "step-start"})
            elif event_type == "tool-output-available":
                tool_call_id = event.get("toolCallId", "")
                tool_name = event.get("toolName", "askKnowledgeBase")
                tool_input = current_tool_calls.get(tool_call_id, {})
                assistant_parts.append({
                    "type": f"tool-{tool_name}",
                    "toolCallId": tool_call_id,
                    "state": "output-available",
                    "input": tool_input,
                    "output": event.get("output", []),
                })
            elif event_type == "tool-input-available":
                tool_call_id = event.get("toolCallId", "")
                current_tool_calls[tool_call_id] = event.get("input", {})

        # Store messages for multi-turn conversation
        if full_text:
            assistant_parts.append({"type": "text", "text": full_text})

        self.messages.append(user_message)
        self.messages.append({
            "id": _generate_id(),
            "role": "assistant",
            "parts": assistant_parts,
        })

        return full_text

    def generate_title(self, query: str) -> str:
        """Generate a chat title for a given query.

        Args:
            query: The question to generate a title for.

        Returns:
            Generated title string.
        """
        payload = {"query": query}
        response = self.session.post(
            AI_CHAT_TITLE_URL,
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("title", "")

    def reset(self) -> None:
        """Reset the conversation, clearing all message history."""
        self.chat_id = _generate_id()
        self.messages = []


def ask_vercel_docs(
    question: str,
    current_route: str = "/docs",
) -> str:
    """Simple one-shot function to ask the Vercel Docs AI a question.

    Args:
        question: The question to ask.
        current_route: The docs page route context.

    Returns:
        The AI's text response.

    Example:
        >>> answer = ask_vercel_docs("What is Vercel Edge Middleware?")
        >>> print(answer)
    """
    client = VercelDocsAI(current_route=current_route)
    return client.ask(question)


def ask_vercel_docs_stream(
    question: str,
    current_route: str = "/docs",
) -> Generator[dict, None, None]:
    """Stream a response from the Vercel Docs AI.

    Args:
        question: The question to ask.
        current_route: The docs page route context.

    Yields:
        SSE event dicts with type and data fields.

    Example:
        >>> for event in ask_vercel_docs_stream("What is ISR?"):
        ...     if event.get("type") == "text-delta":
        ...         print(event["delta"], end="", flush=True)
    """
    client = VercelDocsAI(current_route=current_route)
    return client.ask(question, stream=True)


if __name__ == "__main__":
    print("=" * 60)
    print("Vercel Docs AI Chat - API Client Demo")
    print("=" * 60)

    # --- Demo 1: Simple one-shot question ---
    print("\n[Demo 1] One-shot question:")
    print("-" * 40)
    question = "What is Vercel Edge Middleware?"
    print(f"Q: {question}\n")

    answer = ask_vercel_docs(question)
    print(f"A: {answer}\n")

    # --- Demo 2: Streaming response ---
    print("\n[Demo 2] Streaming response:")
    print("-" * 40)
    question2 = "How do I use environment variables in Vercel?"
    print(f"Q: {question2}\n")
    print("A: ", end="")

    for event in ask_vercel_docs_stream(question2):
        if event.get("type") == "text-delta":
            print(event["delta"], end="", flush=True)
        elif event.get("type") == "tool-output-available":
            sources = event.get("output", [])
            if sources:
                print(f"\n  [Used {len(sources)} sources]", end="")
    print("\n")

    # --- Demo 3: Multi-turn conversation ---
    print("\n[Demo 3] Multi-turn conversation:")
    print("-" * 40)
    client = VercelDocsAI()

    q1 = "What is Vercel KV?"
    print(f"Q1: {q1}")
    a1 = client.ask(q1)
    print(f"A1: {a1[:200]}...\n")

    q2 = "How do I set it up in my Next.js project?"
    print(f"Q2: {q2}")
    a2 = client.ask(q2)
    print(f"A2: {a2[:200]}...\n")

    # --- Demo 4: Title generation ---
    print("\n[Demo 4] Title generation:")
    print("-" * 40)
    title = client.generate_title("What is Vercel Edge Middleware?")
    print(f"Generated title: {title}")

    print("\n" + "=" * 60)
    print("All demos completed successfully!")
    print("=" * 60)
