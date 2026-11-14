import { useCallback, useRef, useState } from 'react';
import { Composer, type ComposerValue } from './components/Composer';
import { RefineBar } from './components/RefineBar';
import { SessionList } from './components/SessionList';
import { EmptyState, ErrorState, LoadingState, Warnings } from './components/StatusViews';
import { StudySetView } from './components/StudySetView';
import { useGeneration } from './hooks/useGeneration';
import { useSessions } from './hooks/useSessions';
import { useTheme } from './hooks/useTheme';

/**
 * App = composition only. Data lives in two hooks:
 *  - useGeneration: request lifecycle (loading/error, abort, stale guard, retry)
 *  - useSessions:   persisted study sets + version history
 * Study progress (card marks, quiz answers) is local UI state inside the
 * deck/quiz components and resets whenever a new version is rendered.
 */
export default function App() {
  const { theme, toggle } = useTheme();
  const sessions = useSessions();
  const gen = useGeneration();
  const [warnings, setWarnings] = useState<string[]>([]);
  // Which session an in-flight refinement belongs to (it may not stay active).
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  const revealWorkspace = () => {
    if (window.matchMedia('(max-width: 899px)').matches) {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleGenerate = useCallback(
    (v: ComposerValue) => {
      setWarnings([]);
      revealWorkspace();
      const req = { text: v.text, mode: v.mode, count: v.count, attachment: v.attachment, simulate: v.simulate };
      void gen.run(req, 'generate', (res) => {
        sessions.create({ text: v.text, mode: v.mode, count: v.count, attachmentName: v.attachment?.name }, res.set);
        setWarnings(res.warnings);
      });
    },
    [gen, sessions],
  );

  const active = sessions.active;

  const handleRefine = (instruction: string) => {
    if (!active) return;
    const sessionId = active.id;
    const set = active.versions[active.versions.length - 1]!.set;
    setWarnings([]);
    setRefineTarget(sessionId);
    void gen.run(
      { text: active.input.text, mode: active.input.mode, count: active.input.count, refine: { set, instruction } },
      'refine',
      (res) => {
        sessions.addVersion(sessionId, res.set, instruction);
        setWarnings(res.warnings);
      },
    );
  };

  const select = (id: string | null) => {
    setWarnings([]);
    if (gen.state.status === 'error') gen.dismiss();
    sessions.select(id);
    if (id) revealWorkspace();
  };

  const { state } = gen;
  const generating = state.status === 'loading' && state.kind === 'generate';
  const refiningHere = state.status !== 'idle' && state.kind === 'refine' && refineTarget === active?.id;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => select(null)} aria-label="Study Forge home">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          Study Forge
        </button>
        <button className="btn btn-ghost btn-small" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          {theme === 'dark' ? '☀︎ Light' : '☾ Dark'}
        </button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <Composer busy={generating} onSubmit={handleGenerate} />
          <SessionList sessions={sessions.sessions} activeId={active?.id ?? null} onSelect={select} onRemove={sessions.remove} />
        </aside>

        <main className="workspace" ref={workspaceRef}>
          {generating && <LoadingState startedAt={state.startedAt} onCancel={gen.cancel} />}
          {state.status === 'error' && state.kind === 'generate' && (
            <ErrorState error={state.error} onRetry={gen.retry} onDismiss={gen.dismiss} />
          )}

          {active ? (
            <StudySetView
              key={active.id}
              session={active}
              refining={refiningHere && state.status === 'loading'}
              onUndo={() => sessions.undo(active.id)}
              footer={<RefineBar busy={state.status === 'loading'} onRefine={handleRefine} />}
            >
              <Warnings warnings={warnings} onDismiss={() => setWarnings([])} />
              {refiningHere && state.status === 'loading' && (
                <div className="refine-status" role="status">
                  <span className="spinner" aria-hidden /> Applying your change… your current set stays usable.
                  <button className="btn btn-ghost btn-small" onClick={gen.cancel}>
                    Cancel
                  </button>
                </div>
              )}
              {refiningHere && state.status === 'error' && (
                <ErrorState compact error={state.error} onRetry={gen.retry} onDismiss={gen.dismiss} />
              )}
            </StudySetView>
          ) : (
            !generating && state.status !== 'error' && <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}
