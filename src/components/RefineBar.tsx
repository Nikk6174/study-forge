import { useState } from 'react';
import { LIMITS } from '../../shared/types';

const SUGGESTIONS = ['Make it harder', 'Add 5 more questions', 'Simpler language', 'Focus on dates and names'];

export function RefineBar({ busy, onRefine }: { busy: boolean; onRefine: (instruction: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (instruction: string) => {
    const v = instruction.trim();
    if (!v || busy) return;
    onRefine(v);
    setValue('');
  };

  return (
    <form
      className="refine"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <label htmlFor="refine" className="label">
        Refine this set
      </label>
      <div className="refine-row">
        <input
          id="refine"
          value={value}
          maxLength={LIMITS.instructionMax}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. “Replace the easy cards with harder ones”"
          disabled={busy}
        />
        <button className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? 'Refining…' : 'Apply'}
        </button>
      </div>
      <div className="examples">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" disabled={busy} onClick={() => submit(s)}>
            {s}
          </button>
        ))}
      </div>
    </form>
  );
}
