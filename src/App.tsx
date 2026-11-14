import { Moon, Sun } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Composer, type ComposerValue } from './components/Composer';
import { Dashboard } from './components/Dashboard';
import { Confetti, Hud, LevelUpOverlay, ToastLayer } from './components/game/GameUI';
import { RefineBar } from './components/RefineBar';
import { SessionList } from './components/SessionList';
import { ErrorState, LoadingState, Warnings } from './components/StatusViews';
import { StudySetView } from './components/StudySetView';
import { useGame } from './game/GameContext';
import { useGeneration } from './hooks/useGeneration';
import { useSessions } from './hooks/useSessions';
import { useTheme } from './hooks/useTheme';

/**
 * App = composition only. State lives in hooks:
 *  - useGeneration: request lifecycle (loading/error, abort, stale guard, retry)
 *  - useSessions:   persisted study sets + version history
 *  - useGame:       XP, levels, streaks, achievements (pure rules in game/engine.ts)
 * Study progress (card marks, quiz answers) is local reducer state inside
 * the deck/quiz components and resets whenever a new version is rendered.
 */
export default function App() {
  const { theme, toggle } = useTheme();
  const sessions = useSessions();
  const gen = useGeneration();
  const game = useGame();
  const [warnings, setWarnings] = useState<string[]>([]);
  // Which session an in-flight refinement belongs to (it may not stay active).
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);

  const revealWorkspace = () => {
    if (window.matchMedia('(max-width: 979px)').matches) {
      workspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const { record } = game;
  const handleGenerate = useCallback(
    (v: ComposerValue) => {
      setWarnings([]);
      revealWorkspace();
      const req = { text: v.text, mode: v.mode, count: v.count, attachment: v.attachment, simulate: v.simulate };
      void gen.run(req, 'generate', (res) => {
        sessions.create({ text: v.text, mode: v.mode, count: v.count, attachmentName: v.attachment?.name }, res.set);
        setWarnings(res.warnings);
        record({ type: 'set_generated', fromFile: !!v.attachment });
      });
    },
    [gen, sessions, record],
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
        record({ type: 'set_refined' });
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
    <>
      <div className="backdrop" aria-hidden>
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
        <span className="grid" />
      </div>

      <div className="app">
        <header className="topbar">
          <button className="brand" onClick={() => select(null)} aria-label="Study Forge home">
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
              <defs>
                <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--brand-1)" />
                  <stop offset="100%" stopColor="var(--brand-2)" />
                </linearGradient>
              </defs>
              <path d="M16 2 30 16 16 30 2 16Z" fill="url(#brand-grad)" />
              <path d="M16 9 23 16 16 23 9 16Z" fill="var(--bg)" opacity=".55" />
            </svg>
            <span className="brand-word">
              Study<span>Forge</span>
            </span>
          </button>
          <div className="topbar-right">
            <Hud />
            <button className="btn btn-icon btn-ghost" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        <div className="layout">
          <aside className="sidebar">
            <Composer busy={generating} onSubmit={handleGenerate} />
            <SessionList sessions={sessions.sessions} activeId={active?.id ?? null} onSelect={select} onRemove={sessions.remove} />
          </aside>

          <main className="workspace" ref={workspaceRef}>
            {generating && <LoadingState startedAt={state.startedAt} onCancel={gen.cancel} />}
            {state.status === 'error' && state.kind === 'generate' && <ErrorState error={state.error} onRetry={gen.retry} onDismiss={gen.dismiss} />}

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
                    <span className="spinner" aria-hidden /> Applying your change… your current set stays playable.
                    <button className="btn btn-ghost btn-small" onClick={gen.cancel}>
                      Cancel
                    </button>
                  </div>
                )}
                {refiningHere && state.status === 'error' && <ErrorState compact error={state.error} onRetry={gen.retry} onDismiss={gen.dismiss} />}
              </StudySetView>
            ) : (
              !generating && <Dashboard />
            )}
          </main>
        </div>
      </div>

      <ToastLayer />
      <Confetti />
      <LevelUpOverlay />
    </>
  );
}
