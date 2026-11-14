import {
  CalendarCheck,
  Crown,
  FileText,
  Flame,
  Hammer,
  Layers,
  Lock,
  RotateCcw,
  Sparkles,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { levelInfo, liveStreak } from '../../game/engine';
import { useGame, type Toast } from '../../game/GameContext';

const ICONS: Record<string, LucideIcon> = { Hammer, FileText, Wand2, Flame, Zap, Crown, RotateCcw, Layers, CalendarCheck };
export const AchievementIcon = ({ name, size = 20 }: { name: string; size?: number }) => {
  const Icon = ICONS[name] ?? Sparkles;
  return <Icon size={size} strokeWidth={2.2} aria-hidden />;
};
export { Lock };

/* ---------------- progress ring ---------------- */

export function Ring({ value, size = 64, stroke = 6, children }: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--brand-1)" />
            <stop offset="100%" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

/* ---------------- HUD ---------------- */

export function Hud() {
  const { profile, today } = useGame();
  const lvl = levelInfo(profile.xp);
  const streak = liveStreak(profile.streak, today);
  return (
    <div className="hud" aria-label="Your progress">
      <div className={`hud-streak ${streak > 0 ? 'is-live' : ''}`} title={`${streak}-day streak (best ${profile.streak.best})`}>
        <Flame size={16} strokeWidth={2.4} aria-hidden />
        <span className="hud-num">{streak}</span>
        <span className="sr-only">day streak</span>
      </div>
      <div className="hud-level" title={`${lvl.into} / ${lvl.span} XP to level ${lvl.level + 1}`}>
        <span className="hud-badge">{lvl.level}</span>
        <div className="hud-xp">
          <div className="hud-xp-top">
            <span className="hud-title">{lvl.title}</span>
            <span className="hud-xp-num">
              {lvl.into}/{lvl.span} XP
            </span>
          </div>
          <div className="xpbar" role="progressbar" aria-valuemin={0} aria-valuemax={lvl.span} aria-valuenow={lvl.into} aria-label="Experience">
            <div className="xpbar-fill" style={{ width: `${lvl.progress * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- toasts ---------------- */

function ToastItem({ toast }: { toast: Toast }) {
  const { dismissToast } = useGame();
  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), toast.kind === 'xp' ? 1400 : 4200);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  if (toast.kind === 'xp') {
    return <div className="toast-xp">+{toast.amount} XP</div>;
  }
  const a = toast.achievement;
  return (
    <div className="toast-ach" role="status">
      <div className="medal is-unlocked">
        <AchievementIcon name={a.icon} />
      </div>
      <div>
        <div className="eyebrow">Achievement unlocked</div>
        <strong>{a.name}</strong>
        <div className="muted small">{a.description}</div>
      </div>
    </div>
  );
}

export function ToastLayer() {
  const { toasts } = useGame();
  return (
    <>
      <div className="xp-layer" aria-live="polite">
        {toasts.filter((t) => t.kind === 'xp').map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
      <div className="ach-layer">
        {toasts.filter((t) => t.kind === 'achievement').map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </>
  );
}

/* ---------------- confetti ---------------- */

const COLORS = ['#8B5CF6', '#22D3EE', '#34E5A0', '#FFC24B', '#FF6B8B', '#ffffff'];

/** Lightweight canvas confetti; fires whenever `burst` changes. */
export function Confetti() {
  const { burst } = useGame();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (burst === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = innerWidth * dpr;
    el.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const parts = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
      y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14,
      vy: -Math.random() * 14 - 4,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      c: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    }));
    let frame = 0;
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - frame / 150);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (++frame < 150) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst]);

  return <canvas ref={canvas} className="confetti" aria-hidden />;
}

/* ---------------- level up ---------------- */

export function LevelUpOverlay() {
  const { levelUp, dismissLevelUp } = useGame();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (levelUp === null) return;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissLevelUp();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [levelUp, dismissLevelUp]);

  if (levelUp === null) return null;
  const { title } = levelInfo(50 * levelUp * (levelUp - 1));
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="lvl-title" onClick={dismissLevelUp}>
      <div className="levelup" onClick={(e) => e.stopPropagation()}>
        <div className="levelup-rays" aria-hidden />
        <div className="eyebrow">Level up</div>
        <div className="levelup-num">{levelUp}</div>
        <h2 id="lvl-title">
          You’re now a <span className="grad-text">{title}</span>
        </h2>
        <p className="muted">Keep the streak alive to climb faster.</p>
        <button ref={btn} className="btn btn-primary btn-lg" onClick={dismissLevelUp}>
          Keep going
        </button>
      </div>
    </div>
  );
}
