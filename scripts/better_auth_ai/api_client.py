"""
Better Auth Docs AI Chat API Client

Reverse-engineered API client for the Better Auth documentation AI assistant.
Uses the Vercel AI SDK UI message stream protocol (SSE) to communicate with
the chat endpoint at https://better-auth.com/api/docs/chat.

No authentication required - the API is publicly accessible.
"""

import json
import uuid
import requests
from typing import Generator, Optional


BASE_URL = "https://better-auth.com"
CHAT_ENDPOINT = f"{BASE_URL}/api/docs/chat"

# Default headers matching the browser request
DEFAULT_HEADERS = {
    "accept": "*/*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "origin": BASE_URL,
    "referer": f"{BASE_URL}/docs/introduction",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/145.0.0.0 Safari/537.36"
    ),
    "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}


def _generate_message_id() -> str:
    """Generate a random 16-character message ID (matching Vercel AI SDK format)."""
    return uuid.uuid4().hex[:16]


class Message:
    """Represents a chat message in the conversation."""

    def __init__(self, role: str, text: str, message_id: Optional[str] = None):
        self.role = role
        self.text = text
        self.id = message_id or _generate_message_id()

    def to_dict(self) -> dict:
        """Convert to the Vercel AI SDK message format."""
        return {
            "parts": [{"type": "text", "text": self.text}],
            "id": self.id,
            "role": self.role,
        }


class BetterAuthDocsChat:
    """
    Client for the Better Auth documentation AI chat assistant.

    This uses the Vercel AI SDK UI message stream protocol to send questions
    and receive streamed responses about Better Auth documentation.

    Example:
        >>> chat = BetterAuthDocsChat()
        >>> response = chat.ask("How do I set up email and password auth?")
        >>> print(response)
    """

    def __init__(self, chat_id: str = "ai-chat"):
        """
        Initialize the chat client.

        Args:
            chat_id: The chat session identifier (default: "ai-chat").
        """
        self.chat_id = chat_id
        self.messages: list[Message] = []
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def _build_payload(self) -> dict:
        """Build the request payload from current conversation history."""
        return {
            "id": self.chat_id,
            "messages": [msg.to_dict() for msg in self.messages],
            "trigger": "submit-message",
        }

    def ask_stream(self, question: str) -> Generator[dict, None, None]:
        """
        Send a question and yield parsed SSE events as they stream in.

        This maintains conversation history, so follow-up questions
        will include prior context.

        Args:
            question: The question to ask about Better Auth docs.

        Yields:
            dict: Parsed SSE event data. Common event types:
                - {"type": "start"} - Stream started
                - {"type": "text", "text": "..."} - Text chunk
                - {"type": "source", ...} - Source reference
                - {"type": "error", "errorText": "..."} - Error
                - "[DONE]" marker signals end of stream

        Raises:
            requests.RequestException: If the HTTP request fails.
        """
        # Add the user message to conversation history
        user_msg = Message(role="user", text=question)
        self.messages.append(user_msg)

        payload = self._build_payload()

        response = self.session.post(
            CHAT_ENDPOINT,
            json=payload,
            stream=True,
            timeout=60,
        )
        response.raise_for_status()

        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue

            # SSE format: "data: {json}" or "data: [DONE]"
            if line.startswith("data: "):
                data_str = line[6:]  # Remove "data: " prefix

                if data_str == "[DONE]":
                    yield {"type": "done"}
                    break

                try:
                    event = json.loads(data_str)
                    yield event
                except json.JSONDecodeError:
                    yield {"type": "raw", "data": data_str}

    def ask(self, question: str) -> str:
        """
        Send a question and return the complete text response.

        This is a convenience method that collects all streamed text chunks
        into a single string. Maintains conversation history for follow-ups.

        Args:
            question: The question to ask about Better Auth docs.

        Returns:
            str: The complete AI response text.

        Raises:
            requests.RequestException: If the HTTP request fails.
            RuntimeError: If the API returns an error.
        """
        full_text = ""
        sources = []

        for event in self.ask_stream(question):
            event_type = event.get("type", "")

            if event_type == "text":
                chunk = event.get("text", "")
                full_text += chunk

            elif event_type == "error":
                error_text = event.get("errorText", "Unknown error")
                raise RuntimeError(f"API error: {error_text}")

            elif event_type == "source":
                sources.append(event)

            elif event_type == "done":
                break

        # Store the assistant response in conversation history
        if full_text:
            assistant_msg = Message(role="assistant", text=full_text)
            self.messages.append(assistant_msg)

        return full_text

    def ask_with_sources(self, question: str) -> dict:
        """
        Send a question and return both the response text and source references.

        Args:
            question: The question to ask about Better Auth docs.

        Returns:
            dict: {"text": str, "sources": list[dict]}

        Raises:
            requests.RequestException: If the HTTP request fails.
            RuntimeError: If the API returns an error.
        """
        full_text = ""
        sources = []

        for event in self.ask_stream(question):
            event_type = event.get("type", "")

            if event_type == "text":
                full_text += event.get("text", "")
            elif event_type == "error":
                raise RuntimeError(f"API error: {event.get('errorText', 'Unknown')}")
            elif event_type == "source":
                sources.append(event)
            elif event_type == "done":
                break

        if full_text:
            assistant_msg = Message(role="assistant", text=full_text)
            self.messages.append(assistant_msg)

        return {"text": full_text, "sources": sources}

    def clear_history(self) -> None:
        """Clear conversation history to start a fresh chat."""
        self.messages.clear()

    @property
    def history(self) -> list[dict]:
        """Get the conversation history as a list of dicts."""
        return [{"role": m.role, "text": m.text, "id": m.id} for m in self.messages]


def ask_single_question(question: str) -> str:
    """
    Convenience function to ask a single question without maintaining state.

    Args:
        question: The question to ask about Better Auth docs.

    Returns:
        str: The AI response text.
    """
    chat = BetterAuthDocsChat()
    return chat.ask(question)


def ask_single_question_stream(question: str) -> Generator[dict, None, None]:
    """
    Convenience function to stream a single question response.

    Args:
        question: The question to ask about Better Auth docs.

    Yields:
        dict: Parsed SSE event data.
    """
    chat = BetterAuthDocsChat()
    yield from chat.ask_stream(question)


# ---------------------------------------------------------------------------
# Example usage
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("Better Auth Docs AI Chat - API Client Demo")
    print("=" * 60)

    chat = BetterAuthDocsChat()

    # Example 1: Simple question
    print("\n--- Asking: What is Better Auth? ---\n")
    try:
        # Use streaming to show response as it arrives
        full_response = ""
        for event in chat.ask_stream("What is Better Auth?"):
            etype = event.get("type", "")
            if etype == "text":
                chunk = event.get("text", "")
                print(chunk, end="", flush=True)
                full_response += chunk
            elif etype == "error":
                print(f"\n[ERROR] {event.get('errorText', 'Unknown error')}")
                break
            elif etype == "done":
                break

        # Store assistant response for follow-up context
        if full_response:
            chat.messages.append(Message(role="assistant", text=full_response))

        print("\n")

        # Example 2: Follow-up question (uses conversation history)
        print("--- Follow-up: How do I install it? ---\n")
        full_response = ""
        for event in chat.ask_stream("How do I install it?"):
            etype = event.get("type", "")
            if etype == "text":
                chunk = event.get("text", "")
                print(chunk, end="", flush=True)
                full_response += chunk
            elif etype == "error":
                print(f"\n[ERROR] {event.get('errorText', 'Unknown error')}")
                break
            elif etype == "done":
                break

        print("\n")

    except requests.RequestException as e:
        print(f"\nNetwork error: {e}")
    except Exception as e:
        print(f"\nError: {e}")

    print("=" * 60)
    print("Done!")
