# Viva voice service

The spoken half of ExamChecker's VIVA mode. It takes the practice paper the
browser has already generated, reads each question aloud with **Murf**,
transcribes the student's spoken answer with **Sarvam**, and streams the
transcript back — one question at a time, never going backwards.

Ported from Guardian (`Guardian-Server/app/telephony/`): same Pipecat 1.6.0,
same Sarvam STT, same Murf TTS, same Silero VAD. The telephony layer is gone —
a browser websocket replaces Twilio Media Streams.

It holds **no Gemini key**. Question generation and grading stay in the browser
exactly where they already are; this service only does voice.

## Run it

```bash
cd python
uv venv --python 3.12
uv pip install -r requirements.txt
cp .env.example .env        # then fill in SARVAM_API_KEY and MURF_API_KEY
./.venv/bin/python run.py
```

Start it from `python/` — python-dotenv searches upward from the working
directory, so launching elsewhere silently skips `.env`.

```bash
curl localhost:8080/health
# {"status":"ok","voice_configured":true,"language":"en-IN"}
```

`voice_configured` is there so the frontend can hide the Viva option rather
than open a websocket that immediately dies.

Then point the SPA at it:

```bash
VITE_VIVA_WS_URL=ws://localhost:8080/ws/viva npm start
```

## Tests

```bash
./.venv/bin/python -m tests.test_viva_session
```

Seven tests drive the orchestrator through a full paper with no network calls:
the ask → listen → capture → advance loop, the mic gate, a thinking pause not
capturing early, the backwards-jump rejection, repeat preserving the answer,
completion, and the question cap.

## Layout

```
app/
├── main.py            create_app(): CORS, router wiring
├── config.py          every env key, declared once
└── viva/
    ├── models.py      the wire contract (mirrored in TypeScript)
    ├── router.py      GET /health, WS /ws/viva
    ├── service.py     the Pipecat pipeline
    └── session.py     InputAudioGate + VivaOrchestrator
```

## The pipeline

```
transport.input()          browser mic, PCM 16 kHz, protobuf-framed
  → RTVIProcessor          control messages, both directions
  → InputAudioGate         drops mic audio unless the student should be answering
  → VADProcessor           Silero; VADUser{Started,Stopped}SpeakingFrame
  → SarvamSTTService       saarika:v2.5, its own VAD signals off
  → VivaOrchestrator       the state machine; emits TTSSpeakFrame
  → MurfTTSService         falcon-2, PCM 24 kHz
  → transport.output()     browser speaker
```

There is **no LLM**. Guardian needs one because its conversation is open-ended;
a viva reads a fixed, ordered paper, so `VivaOrchestrator` is the entire turn
logic. That is also what makes the flow irreversible by construction rather
than by hiding a button in the UI.

### Why the mic gate matters

Murf's voice leaving the laptop speaker and re-entering the microphone would be
transcribed as the student's answer. Two guards: the browser's own
`echoCancellation`, and `InputAudioGate` dropping every `InputAudioRawFrame`
unless the state is `listening`. Guardian wrote this class and never wired it
into a pipeline; here it is load-bearing.

## Wire contract

Both directions are custom RTVI messages over the same websocket that carries
audio — there is no second connection. The TypeScript mirror belongs at
`src/features/practice/viva/vivaProtocol.ts`; edit the two together.

### client → server

| Type | Payload | Notes |
|---|---|---|
| `viva:start` | `{questions: [{id, text, marks}], language?}` | The whole paper, sent once. `id` is the frontend's `Question.id`. |
| `viva:next` | `{index}` | Commit the current answer and advance. **Rejected if `index` is behind the server's cursor.** |
| `viva:repeat` | `{index}` | Re-read the current question without clearing what was said. |
| `viva:end` | `{}` | Student finished early. |

### server → client

Every message is a flat object with a `t` discriminator.

| `t` | Fields | Meaning |
|---|---|---|
| `ready` | — | Pipeline up, waiting for the paper. |
| `question` | `index, questionId, text, marks, total` | About to speak this question. |
| `speaking` | `index` | The examiner has started reading it aloud. |
| `listening` | `index` | Audio finished playing; the mic is open. |
| `transcript` | `index, text` | **Cumulative** answer so far — replace, don't append. |
| `captured` | `index, text` | Silence threshold crossed; the answer stands. |
| `complete` | — | Every question answered. |
| `error` | `message` | Refused paper, backwards jump, or a malformed request. |

A typical question looks like:

```
question → speaking → listening → transcript × N → captured
                                                     ↓ viva:next
                                                  question …
```

**`transcript` is cumulative.** `saarika:v2.5` emits one final per utterance and
no interim frames, so an answer grows chunk by chunk rather than word by word,
and each message carries the whole answer rather than a delta.

## Notes for the frontend

- Request the mic with `echoCancellation: true`.
- Nothing is spoken until `viva:start` arrives, so send the paper as soon as
  `ready` lands.
- `captured` is the cue to enable the Next button. Nothing advances on its own.
- On the last question, `viva:next` returns `complete` instead of `question`.
- A dropped socket loses the session but not the answers — those live in
  `typedAnswers` in `PracticeContext`, which is persisted.

## Two Guardian bugs deliberately not carried over

1. **`multi_native_locale`, not `locale`.** `MurfTTSService.InputParams` has no
   `locale` field. Guardian builds `res["locale"]` and passes `locale=`;
   pydantic drops the unknown key, so its configured language never reaches
   Murf at all.
2. **The VAD sample rate.** Guardian pins `SileroVADAnalyzer(sample_rate=8000)`
   while its serializer feeds the pipeline at 16 kHz, and
   `VADAnalyzer.set_sample_rate` honours the constructor value first — so its
   VAD analyses at the wrong rate. Here `sample_rate` is left off so the
   `StartFrame` sets it.

## Not deployable to Vercel

This needs a long-lived websocket, which Vercel's functions cannot hold. It is
local-only for now. Before hosting it anywhere public (Render / Railway / Fly),
add: `wss://`, a tightened `VIVA_ALLOWED_ORIGINS`, and some form of handshake
auth — right now anyone who can reach the port can spend your Sarvam and Murf
credits.
