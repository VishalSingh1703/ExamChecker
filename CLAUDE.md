# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # dev server at localhost:5173
npm run build      # tsc type-check + vite production build
npm run preview    # serve the production build locally
```

There are no tests or linting scripts configured.

After every set of changes: run `npm run build` to confirm TypeScript and the Vite build both pass before committing.

## Git workflow

Commit and push to GitHub after every meaningful unit of work — a bug fix, a feature, a refactor. Never leave work uncommitted at the end of a session. This project has no staging environment; GitHub is the source of truth and Vercel redeploys on every push to `main`.

Commit message format:
- `feat:` — new feature or behaviour
- `fix:` — bug fix
- `chore:` — config, deps, tooling
- `docs:` — documentation only

Keep messages concise and specific about *what changed and why*, not just *what files changed*. Always end commits with:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## Deployment

The project is hosted on Vercel and linked to GitHub. Every `git push` to `main` triggers an automatic redeploy. The live URL is **https://exam-checker-virid.vercel.app**.

To deploy manually: `vercel --prod`

Environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) must be set in the Vercel dashboard under Settings → Environment Variables. They are not committed.

## Architecture

**Pure frontend SPA** — no backend, no database. React 18 + Vite + TypeScript + Tailwind CSS (class-based dark mode).

### Data flow

1. **Setup tab** (`ExamSetup`): Teacher loads an answer key JSON → clicks "Save Answer Key" (validates, checks marks sum) → clicks "Start Grading" → dispatches `SET_ANSWER_KEY` to global context.
2. **Grade tab** (`GradingView` → `QuestionGrader`): For each question, teacher uploads a handwritten image → Tesseract.js OCR runs in-browser → extracted text is editable → "Analyze Answer" calls the HF similarity API → marks are calculated → "Save & Next" dispatches `UPDATE_QUESTION_RESULT`. `QuestionGrader` receives `key={question.id}` so it fully remounts (clearing all local state) on each new question.
3. **Report tab** (`ReportView`): Reads results from context, computes totals, shows per-question table with colour-coded rows, supports `window.print()` for PDF export.

### Global state (`src/context/ExamContext.tsx`)

`useReducer`-based context split into two contexts (state + dispatch) to avoid unnecessary re-renders. Access via `useExam()` and `useExamDispatch()`. All session data lives here and is reset by `RESET_SESSION`.

### Services

- **`src/services/ocr.ts`** — Singleton Tesseract.js v5 worker (created once, reused). Progress is reported via a module-level callback variable because the worker is created once but progress needs to be per-call.
- **`src/services/similarity.ts`** — Calls `sentence-transformers/all-MiniLM-L6-v2` on the HF Inference API (no auth key required, but rate-limited). On 503 it retries once after 10 s. On any other error it silently falls back to `keywordOverlapScore()` (Jaccard similarity over stopword-filtered tokens).

### Scoring logic (`src/utils/scoring.ts`)

```
similarity ≥ threshold          → full marks
similarity ≥ threshold × 0.7   → partial marks (linear interpolation)
below                           → 0 marks
```

### Auth (`src/lib/supabase.ts`, `src/components/AuthGate.tsx`)

Supabase client is initialized at module load inside a try/catch. If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing or placeholder values, `supabase` is exported as `null` and the app skips auth entirely (shows a yellow banner). `AuthGate` has five views: `login`, `signup`, `forgot`, `verify-sent`, `reset-sent`.

### Dark mode (`src/App.tsx`)

`useDarkMode` hook lives at the top-level `App` component (not inside `AppInner`) so it survives session-driven remounts. It applies the `dark` class to `document.documentElement` synchronously in the `useState` initializer to avoid flash, and persists the preference in `localStorage`.

### Answer key JSON format

```json
{
  "exam": { "title": "...", "subject": "...", "totalMarks": 30 },
  "questions": [
    { "id": 1, "question": "...", "expectedAnswer": "...", "marks": 10, "threshold": 0.6 }
  ]
}
```

`threshold` is per-question (0.0–1.0). A good default is `0.6`. The Setup screen warns if `sum(question.marks) ≠ exam.totalMarks`.
