"""Wire contract between the browser and the viva orchestrator.

Both directions travel as custom RTVI messages over the same websocket that
carries audio, so there is no second connection to keep alive.

The TypeScript mirror of this file lives at
``src/features/practice/viva/vivaProtocol.ts``. Edit the two together.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

# ── client → server ──────────────────────────────────────────────────────────

CLIENT_START = "viva:start"
CLIENT_NEXT = "viva:next"
CLIENT_REPEAT = "viva:repeat"
CLIENT_END = "viva:end"


class VivaQuestion(BaseModel):
    """One question from the already-generated practice paper.

    ``id`` is the frontend's ``Question.id`` (1-based, index + 1). It is echoed
    back on every message so the client never has to infer which answer box a
    transcript belongs to.
    """

    id: int
    text: str
    marks: int = 0


class StartPayload(BaseModel):
    """Payload of ``viva:start`` — the whole paper, sent once."""

    questions: list[VivaQuestion] = Field(default_factory=list)
    language: str | None = None


class IndexPayload(BaseModel):
    """Payload of ``viva:next`` and ``viva:repeat``.

    ``index`` is the question the client believes it is on. The server compares
    it against its own cursor and rejects anything that would move backwards.
    """

    index: int


# ── server → client ──────────────────────────────────────────────────────────
#
# Every message is a flat object with a ``t`` discriminator. Sent through
# RTVIProcessor.send_server_message(), which the pipecat JS client surfaces on
# its onServerMessage callback.

ServerMessageType = Literal[
    "ready",       # pipeline up, waiting for the paper
    "question",    # about to speak question <index>
    "speaking",    # examiner has started reading it aloud
    "listening",   # audio finished playing, mic gate open
    "transcript",  # cumulative transcript for the current question
    "captured",    # silence threshold crossed; the answer stands
    "complete",    # every question answered
    "error",
]


def msg(t: ServerMessageType, **fields: Any) -> dict[str, Any]:
    """Build a server message. Keeps the discriminator key in one place."""
    return {"t": t, **fields}
