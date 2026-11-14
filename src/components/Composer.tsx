import { useState } from 'react';
import { LIMITS, SIMULATE_MODES, type Mode, type SimulateMode } from '../../shared/types';

export interface ComposerValue {
  text: string;
  mode: Mode;
  count: number;
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

export function Composer({ busy, onSubmit }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('both');
  const [count, setCount] = useState(8);
  const [simulate, setSimulate] = useState<SimulateMode | ''>('');

  const trimmed = text.trim();
  const tooLong = text.length > LIMITS.textMax;
  const canSubmit = trimmed.length >= LIMITS.textMin && !tooLong;

  const submit = () => {
    if (canSubmit) onSubmit({ text: trimmed, mode, count, simulate: simulate || undefined });
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
        Paste your notes or type a topic
      </label>
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
        placeholder="e.g. “The Krebs cycle” or paste a page of lecture notes…"
        rows={7}
        aria-invalid={tooLong}
        aria-describedby="notes-help"
      />
      <div id="notes-help" className={`help ${tooLong ? 'bad-text' : ''}`}>
        <span>{tooLong ? 'Too long — trim your notes.' : 'Ctrl/⌘ + Enter to generate'}</span>
        <span>
          {text.length.toLocaleString()} / {LIMITS.textMax.toLocaleString()}
        </span>
      </div>

      {!text && (
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
    </form>
  );
}
