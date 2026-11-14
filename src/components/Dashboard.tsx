import { Brain, FileUp, Repeat2, Target, Trophy } from 'lucide-react';
import { ACHIEVEMENTS, levelInfo, liveStreak } from '../game/engine';
import { useGame } from '../game/GameContext';
import { AchievementIcon, Lock, Ring } from './game/GameUI';

/** Home screen: pitch for new users, player card + trophies for returning ones. */
export function Dashboard() {
  const { profile, today } = useGame();
  const lvl = levelInfo(profile.xp);
  const { stats } = profile;
  const accuracy = stats.answers ? Math.round((stats.correct / stats.answers) * 100) : null;
  const unlocked = ACHIEVEMENTS.filter((a) => a.id in profile.achievements).length;

  return (
    <div className="dash">
      <section className="hero">
        <div className="eyebrow">
          <span className="dot" /> AI study arcade
        </div>
        <h1>
          Turn any notes into a game <span className="grad-text">you can win.</span>
        </h1>
        <p className="hero-sub">
          Drop in lecture notes, a PDF, or a photo of your notebook. Get flashcards and a quiz in seconds, then level up by
          beating them.
        </p>
        <ol className="how">
          <li>
            <FileUp size={20} aria-hidden />
            <div>
              <strong>Forge</strong>
              <span>Paste, type a topic, or attach a file</span>
            </div>
          </li>
          <li>
            <Brain size={20} aria-hidden />
            <div>
              <strong>Play</strong>
              <span>Flip cards, chain quiz combos</span>
            </div>
          </li>
          <li>
            <Repeat2 size={20} aria-hidden />
            <div>
              <strong>Master</strong>
              <span>Retest only what you missed</span>
            </div>
          </li>
        </ol>
      </section>

      <section className="bento" aria-label="Your stats">
        <div className="tile tile-player">
          <Ring value={lvl.progress} size={92} stroke={8}>
            <span className="ring-big">{lvl.level}</span>
          </Ring>
          <div>
            <div className="eyebrow">Level {lvl.level}</div>
            <div className="tile-title">{lvl.title}</div>
            <div className="muted small">
              {lvl.span - lvl.into} XP to level {lvl.level + 1} · {profile.xp.toLocaleString()} XP total
            </div>
          </div>
        </div>
        <div className="tile tile-stat tile-flame">
          <div className="tile-num">{liveStreak(profile.streak, today)}</div>
          <div className="muted small">day streak · best {profile.streak.best}</div>
        </div>
        <div className="tile tile-stat">
          <div className="tile-num">{accuracy === null ? '—' : `${accuracy}%`}</div>
          <div className="muted small">
            <Target size={13} aria-hidden /> quiz accuracy
          </div>
        </div>
        <div className="tile tile-stat">
          <div className="tile-num">{stats.cards}</div>
          <div className="muted small">cards reviewed</div>
        </div>
        <div className="tile tile-stat">
          <div className="tile-num">{stats.bestCombo}×</div>
          <div className="muted small">best combo</div>
        </div>
      </section>

      <section className="trophies" aria-label="Achievements">
        <div className="section-head">
          <h2>
            <Trophy size={18} aria-hidden /> Trophies
          </h2>
          <span className="muted small">
            {unlocked}/{ACHIEVEMENTS.length} unlocked
          </span>
        </div>
        <ul className="medals">
          {ACHIEVEMENTS.map((a) => {
            const got = a.id in profile.achievements;
            return (
              <li key={a.id} className={got ? 'is-unlocked' : ''} title={a.description}>
                <div className={`medal ${got ? 'is-unlocked' : ''}`}>{got ? <AchievementIcon name={a.icon} /> : <Lock size={16} aria-hidden />}</div>
                <div className="medal-name">{a.name}</div>
                <div className="medal-desc">{a.description}</div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
