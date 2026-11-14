/**
 * The contract between the model, the server and the UI.
 *
 * Everything the UI renders has passed through `normalizeStudySet`, so
 * components can rely on these invariants without defensive checks:
 *  - every id is unique within its list
 *  - every string is trimmed and non-empty
 *  - every question has 2–6 distinct options and a valid correctIndex
 */

export type Mode = 'flashcards' | 'quiz' | 'both';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface StudySet {
  title: string;
  flashcards: Flashcard[];
  questions: QuizQuestion[];
}

/** A PDF or image sent to the model as-is (text files are read into `text` client-side). */
export interface Attachment {
  name: string;
  mimeType: AttachmentMimeType;
  /** Base64 without the data: URL prefix. */
  data: string;
}

export const ATTACHMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export interface GenerateRequest {
  /** Notes or topic. May be empty when an attachment is provided, or when refining. */
  text: string;
  mode: Mode;
  count: number;
  /** Present for follow-up edits: the model edits `set` instead of starting over. */
  refine?: { set: StudySet; instruction: string };
  /** Only used for generation; refinement works from the existing set. */
  attachment?: Attachment;
  /** Dev-only failure injection, see server/simulate.ts. */
  simulate?: SimulateMode;
}

export interface GenerateResponse {
  set: StudySet;
  /** Non-fatal problems we repaired or dropped (shown to the user, not hidden). */
  warnings: string[];
  meta: { model: string; attempts: number; ms: number; repaired: boolean };
}

export const SIMULATE_MODES = [
  'malformed',
  'wrong_shape',
  'partial',
  'empty',
  'slow',
  'upstream_error',
  'rate_limit',
] as const;
export type SimulateMode = (typeof SIMULATE_MODES)[number];

export const LIMITS = {
  textMin: 3,
  textMax: 15_000,
  countMin: 3,
  countMax: 25,
  instructionMax: 400,
  optionsMin: 2,
  optionsMax: 6,
  fieldMax: 600,
  /** 3 MB raw ≈ 4 MB base64 – keeps the request under Vercel's 4.5 MB body limit. */
  attachmentMaxBytes: 3 * 1024 * 1024,
  /** Plain-text files larger than this aren't worth reading into the textarea. */
  textFileMaxBytes: 1024 * 1024,
} as const;
