import { useRef, useState } from 'react';
import { LIMITS, SIMULATE_MODES, type Attachment, type Mode, type SimulateMode } from '../../shared/types';
import { ACCEPT, formatBytes, readFileForComposer } from '../lib/files';

export interface ComposerValue {
  text: string;
  mode: Mode;
  count: number;
  attachment?: Attachment;
  simulate?: SimulateMode;
}

const EXAMPLES = [
  { label: 'Topic: TCP vs UDP', text: 'TCP vs UDP' },
  {
    label: 'Notes: French Revolution',
    text: `French Revolution (1789–1799)
- Causes: fiscal crisis from war debt, Enlightenment ideas, food shortages, rigid Estates system.
- 1789: Estates-General convened; Third Estate forms National Assembly; Tennis Court Oath; storming of the Bastille (14 July).
- Declaration of the Rights of Man and of the Citizen (Aug 1789).
- 1792: monarchy abolished, First Republic declared. 1793: Louis XVI executed.
- Reign of Terror (1793–94) led by Robespierre and the Committee of Public Safety; ended with his execution (Thermidor).
- Directory (1795–99), ended by Napoleon's coup of 18 Brumaire (1799).`,
  },
  { label: 'Topic: Photosynthesis', text: 'Photosynthesis for a high-school biology exam' },
];

const MODES: { value: Mode; label: string }[] = [
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'both', label: 'Both' },
];

// Failure simulator is opt-in via ?debug so reviewers can exercise error paths.
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

interface Props {
  busy: boolean;
  onSubmit: (value: ComposerValue) => void;
}

interface AttachedFile {
  attachment: Attachment;
  size: number;
}

type FileStatus = { kind: 'idle' } | { kind: 'reading'; name: string } | { kind: 'error'; message: string } | { kind: 'info'; message: string };

const PaperclipIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export function Composer({ busy, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('both');
  const [count, setCount] = useState(8);
  const [simulate, setSimulate] = useState<SimulateMode | ''>('');
  const [attached, setAttached] = useState<AttachedFile | null>(null);
  const [fileStatus, setFileStatus] = useState<FileStatus>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Same stale-result guard as requests: only the most recent pick may land.
  const readSeq = useRef(0);

  const trimmed = text.trim();
  const tooLong = text.length > LIMITS.textMax;
  const reading = fileStatus.kind === 'reading';
  const hasMaterial = trimmed.length >= LIMITS.textMin || !!attached;
  const canSubmit = hasMaterial && !tooLong && !reading;

  const submit = () => {
    if (canSubmit) {
      onSubmit({ text: trimmed, mode, count, attachment: attached?.attachment, simulate: simulate || undefined });
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const id = ++readSeq.current;
    setFileStatus({ kind: 'reading', name: file.name });
    try {
      const result = await readFileForComposer(file);
      if (id !== readSeq.current) return;
      if (result.kind === 'text') {
        setText(result.text);
        setFileStatus(
          result.truncated
            ? { kind: 'info', message: `Loaded “${file.name}” — trimmed to the first ${LIMITS.textMax.toLocaleString()} characters.` }
            : { kind: 'info', message: `Loaded text from “${file.name}”. You can edit it before generating.` },
        );
      } else {
        setAttached({ attachment: result.attachment, size: result.size });
        setFileStatus({ kind: 'idle' });
      }
    } catch (e) {
      if (id !== readSeq.current) return;
      setFileStatus({ kind: 'error', message: (e as Error).message });
    }
  };

  const removeAttachment = () => {
    readSeq.current++;
    setAttached(null);
    setFileStatus({ kind: 'idle' });
  };

  return (
    <form
      className="panel composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="notes" className="label">
        Paste notes, type a topic, or attach a file
      </label>
      <div
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
      >
        <textarea
          id="notes"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            attached
              ? 'Optional: what to focus on, e.g. “only the section on mitosis”'
              : 'e.g. “The Krebs cycle” or paste a page of lecture notes…'
          }
          rows={7}
          aria-invalid={tooLong}
          aria-describedby="notes-help"
        />
        {dragging && <div className="drop-hint">Drop to attach</div>}
      </div>

      {attached && (
        <div className="attachment-chip">
          <span aria-hidden>{attached.attachment.mimeType === 'application/pdf' ? '📄' : '🖼️'}</span>
          <span className="attachment-name" title={attached.attachment.name}>
            {attached.attachment.name}
          </span>
          <span className="muted small">{formatBytes(attached.size)}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={removeAttachment} aria-label={`Remove ${attached.attachment.name}`}>
            ✕
          </button>
        </div>
      )}

      <div id="notes-help" className="help">
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInput.current?.click()}
          disabled={reading}
          aria-label="Attach a file from your device"
          title="Attach a PDF, image, or text file"
        >
          <PaperclipIcon />
          <span>{reading ? 'Reading…' : attached ? 'Replace file' : 'Attach file'}</span>
        </button>
        <span className={tooLong ? 'bad-text' : ''}>
          {tooLong ? 'Too long — trim your notes. ' : ''}
          {text.length.toLocaleString()} / {LIMITS.textMax.toLocaleString()}
        </span>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = ''; // allow re-picking the same file
        }}
      />

      {fileStatus.kind === 'error' && (
        <p className="file-status bad-text" role="alert">
          {fileStatus.message}
        </p>
      )}
      {fileStatus.kind === 'info' && (
        <p className="file-status muted" role="status">
          {fileStatus.message}
        </p>
      )}

      {!text && !attached && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex.label} type="button" className="chip" onClick={() => setText(ex.text)}>
              {ex.label}
            </button>
          ))}
        </div>
      )}

      <div className="composer-row">
        <div className="segmented" role="radiogroup" aria-label="What to generate">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              className={mode === m.value ? 'is-active' : ''}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="count">
          <span>
            {count} {mode === 'both' ? 'of each' : 'items'}
          </span>
          <input
            type="range"
            min={LIMITS.countMin}
            max={LIMITS.countMax}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-label="Number of items"
          />
        </label>
      </div>

      {DEBUG && (
        <label className="debug">
          <span>Simulate failure</span>
          <select value={simulate} onChange={(e) => setSimulate(e.target.value as SimulateMode | '')}>
            <option value="">Off (real model)</option>
            {SIMULATE_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={!canSubmit}>
        {busy ? 'Generating… (submit again to replace)' : 'Generate study set'}
      </button>
      <p className="muted small center">Ctrl/⌘ + Enter to generate · drop a file on the box to attach it</p>
    </form>
  );
}
