from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from .config import Settings

log = logging.getLogger("vocivo.brain")

# The only step in a call that leaves Vocivo's own hardware. Telephony, speech
# recognition and the voice are all self-hosted; this is one request per turn to
# a language model, and it carries the conversation and nothing else.

Action = Literal["speak", "transfer", "message", "hangup"]

# The languages the admin offers for a receptionist, as the model should hear them.
LANGUAGE_NAMES = {"en": "English", "ar": "Arabic", "fr": "French", "es": "Spanish", "it": "Italian", "pt": "Portuguese"}


@dataclass(frozen=True)
class TransferTarget:
    extension: str
    label: str


@dataclass(frozen=True)
class Assistant:
    """The tenant's receptionist, as configured in the Vocivo admin."""

    name: str = "Reception"
    greeting: str = "Thanks for calling. How can I help?"
    instructions: str = ""
    voice: str = "af_heart"
    language: str = "en"
    transfer_enabled: bool = False
    fallback_extension: str = ""
    targets: tuple[TransferTarget, ...] = ()
    #: False after hours: the API then also sends no transfer targets, so the
    #: receptionist takes messages rather than putting callers through to nobody.
    office_open: bool = True

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> "Assistant":
        targets = tuple(
            TransferTarget(extension=str(entry.get("extension", "")), label=str(entry.get("label") or entry.get("name") or ""))
            for entry in payload.get("targets", [])
            if entry.get("extension")
        )
        return cls(
            name=str(payload.get("name") or cls.name),
            greeting=str(payload.get("greeting") or cls.greeting),
            instructions=str(payload.get("instructions") or ""),
            voice=str(payload.get("voice") or cls.voice),
            language=str(payload.get("language") or cls.language),
            transfer_enabled=bool(payload.get("transferEnabled")),
            fallback_extension=str(payload.get("fallbackExtension") or ""),
            targets=targets,
            office_open=payload.get("officeOpen", True) is not False,
        )


@dataclass
class Decision:
    action: Action = "speak"
    say: str = ""
    extension: str = ""
    note: str = ""


@dataclass
class Turn:
    role: Literal["caller", "assistant"]
    text: str


@dataclass
class Conversation:
    assistant: Assistant
    caller_number: str = ""
    turns: list[Turn] = field(default_factory=list)

    def add(self, role: Literal["caller", "assistant"], text: str) -> None:
        if text.strip():
            self.turns.append(Turn(role=role, text=text.strip()))

    def transcript(self) -> str:
        return "\n".join(f"{'Caller' if turn.role == 'caller' else 'Reception'}: {turn.text}" for turn in self.turns)


def system_prompt(assistant: Assistant) -> str:
    """
    The receptionist's brief.

    Written for the ear rather than the page: this text is spoken down a phone
    line, and the two mistakes that make a voice agent unbearable are talking
    too long and refusing to hand over to a person.
    """
    lines = [
        f"You are {assistant.name}, answering the phone for this business.",
        "",
        "You are speaking out loud on a phone call. Keep every reply to one or two short sentences.",
        "Never use bullet points, headings, emoji or markdown — everything you write is read aloud.",
        "Say numbers the way a person says them out loud.",
        "Sound like a calm, unhurried person at a front desk: acknowledge what the caller said in a few words before answering, and never rush them.",
        "If the caller seems to be mid-thought, or you only caught part of what they said, ask a short question rather than guessing.",
        "If you did not understand the caller, say so plainly and ask them to repeat it.",
    ]
    language = LANGUAGE_NAMES.get((assistant.language or "en").lower()[:2])
    if language and not assistant.language.lower().startswith("en"):
        lines.append(f"Speak {language}: the business set its receptionist to {language}, and the caller expects it.")
    if assistant.instructions.strip():
        lines += ["", "What this business wants you to know:", assistant.instructions.strip()]
    if assistant.transfer_enabled and assistant.targets:
        lines += ["", "You can put the caller through to:"]
        lines += [f"- {target.label or target.extension} (extension {target.extension})" for target in assistant.targets]
        lines += [
            "",
            "Transfer as soon as the caller asks for a person or for something you cannot settle yourself.",
            "Say who you are putting them through to before you transfer.",
        ]
    else:
        lines += ["", "You cannot transfer this call. Take a message instead when the caller needs a person."]
    if not assistant.office_open:
        lines += [
            "",
            "The office is closed right now. Say so when it matters, answer what you can, and take a message for anything that needs a person.",
        ]
    lines += [
        "",
        "Take a message when the caller wants a call back, or when nobody is available.",
        "End the call once the caller's business is done and they have said goodbye.",
    ]
    return "\n".join(lines)


def tool_definitions(assistant: Assistant) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = [
        {
            "name": "take_message",
            "description": "Record a message for the business. Use when the caller wants someone to call them back.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "What the caller wants passed on, in their own words where possible."},
                    "say": {"type": "string", "description": "What to say to the caller as you take it."},
                },
                "required": ["message", "say"],
            },
        },
        {
            "name": "end_call",
            "description": "Say goodbye and hang up. Only once the caller's business is finished.",
            "input_schema": {
                "type": "object",
                "properties": {"say": {"type": "string", "description": "The last thing the caller hears."}},
                "required": ["say"],
            },
        },
    ]
    if assistant.transfer_enabled and assistant.targets:
        tools.insert(0, {
            "name": "transfer_call",
            "description": "Put the caller through to a person.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "extension": {
                        "type": "string",
                        "enum": [target.extension for target in assistant.targets],
                        "description": "The extension to transfer to.",
                    },
                    "say": {"type": "string", "description": "What to say before transferring, e.g. 'Putting you through to Sam now.'"},
                },
                "required": ["extension", "say"],
            },
        })
    return tools


def decision_from_response(payload: dict[str, Any], assistant: Assistant) -> Decision:
    """
    Turns one model response into something the call can act on.

    Deliberately forgiving in one direction and strict in the other: any text
    the model produced is spoken even when it also called a tool, but a
    transfer to an extension that is not on the tenant's list is refused
    outright rather than dialled.
    """
    spoken: list[str] = []
    decision = Decision()
    allowed = {target.extension for target in assistant.targets}

    for block in payload.get("content", []):
        if block.get("type") == "text":
            spoken.append(str(block.get("text", "")).strip())
            continue
        if block.get("type") != "tool_use":
            continue
        arguments = block.get("input") or {}
        name = block.get("name")
        said = str(arguments.get("say", "")).strip()
        if said:
            spoken.append(said)
        if name == "transfer_call":
            extension = str(arguments.get("extension", "")).strip()
            if assistant.transfer_enabled and extension in allowed:
                decision.action = "transfer"
                decision.extension = extension
            else:
                # A hallucinated extension would dial a stranger, or nobody.
                log.warning("refusing a transfer to %r, which is not a configured target", extension)
                spoken.append("Sorry, I can't put you through to that. Let me take a message instead.")
                decision.action = "speak"
        elif name == "take_message":
            decision.action = "message"
            decision.note = str(arguments.get("message", "")).strip()
        elif name == "end_call":
            decision.action = "hangup"

    decision.say = " ".join(part for part in spoken if part).strip()
    if not decision.say and decision.action == "speak":
        decision.say = "Sorry, I didn't catch that. Could you say it again?"
    return decision


class Brain:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))

    async def close(self) -> None:
        await self._client.aclose()

    async def respond(self, conversation: Conversation) -> Decision:
        assistant = conversation.assistant
        messages = [
            {"role": "user" if turn.role == "caller" else "assistant", "content": turn.text}
            for turn in conversation.turns
        ]
        if not messages or messages[0]["role"] != "user":
            # The API requires the first turn to be the caller's. A greeting we
            # spoke before hearing anything is context, not a turn.
            messages.insert(0, {"role": "user", "content": "(the caller has not said anything yet)"})
        try:
            headers = {
                "x-api-key": self._settings.llm_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            if self._settings.llm_workspace_id:
                headers["anthropic-workspace-id"] = self._settings.llm_workspace_id
            response = await self._client.post(
                f"{self._settings.llm_base_url}/v1/messages",
                headers=headers,
                content=json.dumps({
                    "model": self._settings.llm_model,
                    "max_tokens": self._settings.llm_max_tokens,
                    "system": system_prompt(assistant),
                    "tools": tool_definitions(assistant),
                    "messages": messages,
                }),
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            # The caller is on the line: fall back to a person rather than to an
            # apology loop. The response body says *why* — a rejected request
            # is worth reading, a status code alone was not.
            detail = ""
            if isinstance(error, httpx.HTTPStatusError):
                detail = error.response.text[:400]
            log.error("the language model did not answer (%s): %s %s", self._settings.llm_model, error, detail)
            # A temporary provider failure is not the caller's request to end
            # or transfer this conversation. Let the next turn retry normally.
            transient = not isinstance(error, httpx.HTTPStatusError) or error.response.status_code in {408, 429} or error.response.status_code >= 500
            if transient:
                return Decision(say="Sorry, I lost that for a moment. Could you repeat that, please?")
            allowed = {target.extension for target in assistant.targets}
            if assistant.office_open and assistant.transfer_enabled and assistant.fallback_extension in allowed:
                return Decision(action="transfer", extension=assistant.fallback_extension, say="One moment, I'll put you through.")
            return Decision(say="Sorry, I'm having trouble responding right now. Please tell me your name and the message for the team.")
        return decision_from_response(response.json(), assistant)
