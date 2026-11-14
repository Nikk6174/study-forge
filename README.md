# Study Forge

Paste notes, name a topic, or **attach a file** (PDF, a photo of your notes, or a text file), and Gemini turns it into **flashcards** and a **multiple-choice quiz**. Flip through cards, take the quiz, retest only the questions you missed, and refine the set with follow-ups like "make it harder".

It isn't a chatbot. The model returns JSON. The server and the client both validate it, and the app renders it as stateful React components.

---

## Setup

Requires Node 20+ (developed on Node 23).

```bash
npm install
cp .env.example .env        # then put your key in GEMINI_API_KEY
npm run dev                 # http://localhost:5173
```

`npm run dev` runs a single process. A small Vite plugin mounts the real API handler at `/api/generate`, so local dev runs the same code as production.

| Script | |
| --- | --- |
| `npm run dev` | App + API on :5173 |
| `npm test` | Unit tests (normaliser, server pipeline, quiz logic) |
| `npm run build` | Typecheck + production build |

### Environment

| Var | Default | |
| --- | --- | --- |
| `GEMINI_API_KEY` | required | Server-side only. Never prefixed with `VITE_`, so it can't end up in the bundle. |
| `GEMINI_MODELS` | `gemini-flash-lite-latest,gemini-2.5-flash` | Model chain: the first is primary, the rest are fallbacks. |
| `ALLOW_SIMULATE` | `false` | Enables the failure simulator outside local dev. |

### Deploy (Vercel)

`api/generate.ts` is a Vercel serverless function, and `vercel.json` sets `maxDuration: 60`. Import the repo in Vercel, set `GEMINI_API_KEY` in the project's environment variables, and deploy.

### Try the failure paths

Open **`http://localhost:5173/?debug`**. A "Simulate failure" select appears with these options: `malformed`, `wrong_shape`, `partial`, `empty`, `slow`, `upstream_error` and `rate_limit`. The simulated text goes through the **real** parse and validation pipeline. Only the model call is replaced.

To see the stale-response guard, choose `slow`, click Generate, then switch to `partial` and click Generate again. Only the second result appears. The server log shows the first request as `ABORTED`.

---

## Architecture

```
shared/            ← used by BOTH server and browser
  types.ts           StudySet contract + limits
  errors.ts          AppError: one error vocabulary (code + retryable)
  normalize.ts       untrusted JSON → StudySet (the core of "bad output" handling)
server/
  gemini.ts          one REST call → text, or a typed AppError
  prompt.ts          system prompt, response schema, generate/refine/repair prompts
  generate.ts        pipeline: validate → call → parse → repair → fallback, under a deadline
  simulate.ts        dev failure injection
  http.ts            Node req/res adapter (shared by Vite dev + Vercel)
api/generate.ts    Vercel function (3 lines)
src/
  lib/api.ts         fetch wrapper: always returns validated data or throws AppError
  hooks/useGeneration.ts   request lifecycle: abort, stale guard, retry, cancel
  hooks/useSessions.ts     persisted sets + version stack (refine/undo)
  game/engine.ts     pure game rules: XP, combos, levels, streaks, achievements
  game/GameContext   profile state + persistence + feedback queue (toasts, level-up, confetti)
  components/        Composer, FlashcardDeck, Quiz, StudySetView, Dashboard, StatusViews, game/GameUI
```

**Data flow:** `Composer` → `useGeneration.run()` → `POST /api/generate` → `generate()` → Gemini → `normalizeStudySet()` → response → `normalizeStudySet()` runs again in the browser → `useSessions.create()` → `StudySetView` renders `FlashcardDeck` / `Quiz`.

**State is split by lifetime:**

- `useGeneration` holds request state: idle, loading or error.
- `useSessions` holds what you've made. It's persisted, versioned, and validated again on load.
- Deck and quiz progress is local `useReducer` state inside each component. It resets when a new version arrives, using `key={version.id}`.

`App.tsx` only composes these pieces.

---

## Handling bad AI output

The rule is **lenient on the way in, strict on the way out.** Components never check data defensively because nothing unvalidated reaches them.

| Failure | What happens |
| --- | --- |
| **Malformed JSON** (fences, prose around it, truncated) | `extractJson` tries the raw text, then a fenced block, then the outermost `{…}`/`[…]`. If none of them parse, the server sends **one repair turn** to the same model with the exact parse error. If the repair also fails, it falls back to the next model. If everything fails, the user sees `BAD_OUTPUT` and a Retry button. |
| **Wrong shape** | Common drift is accepted: `cards`/`quiz` keys, `question`/`answer`, `term`/`definition`, `choices`, a single wrapper object, or a bare array. Anything else counts as `BAD_OUTPUT` and goes through repair and fallback as above. |
| **Semantically wrong items** | Each item is validated **separately** with zod. The correct answer can arrive as an index, a letter (`"B"`, `"c)"`), a numeric string or the option text, and it's resolved to an index. Items with an out-of-range answer, duplicate options, fewer than 2 or more than 6 options, empty text, or a duplicated question are **dropped, not fatal**. The user sees a warning: "Skipped 2 malformed items" and "Asked for 8, got 6". |
| **Empty / nonsense input** | The schema has a `notice` field so the model can say *why* there's nothing to study, and the UI shows that reason. Empty results are **not** retried, because empty is a legitimate answer. |
| **Slow** | Each model call has a 25s timeout, and the whole request has a 45s budget. The client times out at 55s, so the server's typed error normally arrives first. After 10s the UI says it's slow and offers Cancel. |
| **Failed** (429, 5xx, network, blocked) | These map to typed codes. 429, 5xx and timeouts fall back to the next model. Safety blocks and a bad API key don't fall back. The UI shows a specific title and message, plus Retry only when `retryable` is true. |
| **Stale responses** | Each new request aborts the previous one. A sequence number also drops any late response. When the browser disconnects, the server aborts the upstream Gemini call too. A refinement result always goes to the session that requested it, even if you've switched sessions meanwhile. |
| **Bad uploads** | The browser rejects unsupported types, empty files and files over 3 MB, and the server checks type, size and base64 encoding again. If a file is unreadable or has nothing to study (a blank photo, say), the model returns an explanatory `notice`, which the UI shows. A file stays attached through a repair turn, so the repair still sees it. |
| **Corrupt localStorage** | Every saved set goes back through the normaliser on load. Broken sessions are skipped. |
| **Render bug** | A top-level `ErrorBoundary` shows a Reload button instead of a blank page. |

Gemini's `responseSchema` (structured output) is enabled. It makes the right shape *likely* but doesn't guarantee valid content: an answer index can still be out of range, and options can repeat. That's why the normaliser still runs.

The client re-validates the server response because the network is a trust boundary too (proxies, an HTML 504 page, an older server version). The normaliser is idempotent, so running it twice is safe and cheap.

Models also tend to put the correct answer in the same slot. The quiz reshuffles options on every attempt, except True/False, which keeps its natural order.

---

## Features

- **Gamified study loop:** you earn XP for effort ("still learning" still pays) and more for accuracy. Chaining correct quiz answers builds a combo, up to a 3× multiplier. There are levels with titles (Novice → Legend), a daily streak, and 9 achievements. Level-ups, perfect rounds and unlocked achievements trigger confetti. Nothing ever takes XP away: wrong answers only reset the combo. The rules live in [`src/game/engine.ts`](src/game/engine.ts) as pure functions, with tests. [`GameContext`](src/game/GameContext.tsx) applies them, saves the profile to localStorage (checked again on load), and queues the feedback. The deck and quiz only call `record(event)`.
- **Design:** dark-first "night arcade" look with a light mode. One violet→cyan brand gradient is the identity, and semantic colours carry game meaning (mint = correct, coral = wrong, gold = XP, orange = streak) and are never used as decoration. Display type is Bricolage Grotesque and UI type is Inter, both self-hosted through `@fontsource` with no third-party requests. Glass panels sit over slowly drifting gradient light. Flashcards tilt toward the mouse, and every animation respects `prefers-reduced-motion`.
- **Upload from device:** use the paperclip button or drag a file onto the textarea. Text files (`.txt`, `.md`, `.csv`, `.json`) are read in the browser and put into the textarea so you can edit them. PDFs and images (PNG, JPG, WebP, HEIC) are sent to Gemini as `inlineData`, so on a phone you can photograph your notes. Files over 3 MB, empty files and unsupported types are rejected in the browser with a specific message, and the server checks type, size and base64 again. If you pick files quickly in a row, only the last one is kept.
- Flashcards: 3D flip, "Got it / Still learning", end-of-deck summary, **review only missed cards**, shuffle. Keys: `Space` flips, `←`/`→` move between cards, `1`/`2` mark. Swipe on touch screens.
- Quiz: immediate feedback with an explanation, results with your answer next to the correct one, **retest only wrong answers**. Keys: `1–6` or `A–F` to answer, `Enter` for next.
- **Refinement loop:** follow-ups edit the existing set (unchanged items keep their ids) instead of regenerating it. Each refinement is a new version, with **Undo**. The current set stays usable while a refinement runs.
- Saved sessions in localStorage, dark mode (system default plus a toggle), mobile layout, `prefers-reduced-motion`, and accessible labels, roles and focus handling.

## Tests

`npm test` runs 45 tests:

- the normaliser: every drift and failure case above;
- the server pipeline with a scripted fake `fetch`: repair turn, fallback on 5xx/429/timeout, no retry on empty, safety block, bad key, client abort, input validation, simulator, and attachments (sent as `inlineData`, kept on the repair turn, invalid ones rejected before any model call);
- quiz shuffling;
- game rules: XP and combo maths, the level curve, streaks across month boundaries, achievement unlocks, and recovering a corrupt saved profile.

---

## AI usage note

- **In the product:** Gemini through its REST `generateContent` endpoint, with `responseMimeType: application/json` and a `responseSchema`. I deliberately didn't use an SDK. There's a single endpoint, and making the HTTP call myself makes each failure explicit: timeout, abort, status codes, `promptFeedback.blockReason`, `finishReason` (`SAFETY` / `MAX_TOKENS`), and filtering out thinking-model "thought" parts. The user's notes are wrapped in delimiters, and the system prompt treats them as data rather than instructions, which gives basic prompt-injection resistance.
- **Model choice was measured, not assumed.** During development, `gemini-flash-latest` (a thinking model) took **over 3 minutes** for two flashcards, and its `minimal` thinking level is rejected. `gemini-flash-lite-latest` answered in about 2–3s, so it's the primary model, with `gemini-2.5-flash` as the fallback.
- **In building it:** I used an AI coding assistant (Claude) to write and test the code. I reviewed the design decisions (contract-first shared normaliser, repair-then-fallback, abort plus sequence guard, version stack) and can explain them.

## Known limitations

- **No streaming.** With the lite model, responses take about 2–4s, so streaming partial JSON would add complexity for little benefit. It would matter more with a slower model.
- **Refinement returns the whole set.** The model sends back the full updated set rather than a patch. Unchanged items keep their ids, but study progress still resets when a new version arrives.
- **Repair only covers structure.** A factually wrong answer the model got wrong in the first place isn't caught. Grounding comes from the prompt alone.
- **No rate limiting on `/api/generate`.** A public deployment should add one (for example Vercel KV or Upstash) to protect the key's quota.
- Sessions live only in this browser's localStorage. There's no sync or export.
- Very long notes are capped at 15k characters. There's no chunking.
- Attachments are capped at 3 MB, which keeps requests under Vercel's 4.5 MB body limit. Bigger PDFs would need upload to Gemini's Files API.
- Attached files aren't saved with the session (localStorage only holds about 5 MB). Refining a file-based set therefore works from the generated cards and questions rather than re-reading the file.
- Scanned PDFs and handwriting depend entirely on Gemini's vision, and quality varies.
- The Vercel function hasn't been verified on a live deploy here. Locally, the same handler runs through the Vite plugin.

## Time spent

About 3–4 hours, including measuring model latency and testing in the browser. *(Adjust to your actual time.)*
