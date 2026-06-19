import React, { useState } from 'react';
import { ROLES } from '../protocol.js';
import Scales from './Scales.jsx';

// Confetti/firework palette — gold, oxblood, court green.
const CONFETTI_COLORS = ['#e6c878', '#c9a14a', '#9c7a2e', '#6e1423', '#8e2434', '#2f6b3a', '#3f8a4c'];
const CONFETTI_COUNT = 42;

// Pre-computed confetti pieces. Each gets a random horizontal position, color,
// size, delay and fall duration so the burst looks organic. Pure CSS animates
// them (see styles.css `.confetti-piece` / `@keyframes confettiFall`).
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
  const left = Math.round((i / CONFETTI_COUNT) * 100 + (Math.random() * 6 - 3));
  return {
    id: i,
    left: Math.max(0, Math.min(100, left)),
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.round(Math.random() * 8),
    delay: Math.round(Math.random() * 1200),
    duration: 2600 + Math.round(Math.random() * 1800),
    drift: Math.round(Math.random() * 80 - 40),
    rounded: i % 3 === 0,
  };
});

// A few firework burst origins (percent of overlay width/height).
const FIREWORKS = [
  { id: 'fw1', x: 22, y: 30, color: '#e6c878', delay: 200 },
  { id: 'fw2', x: 78, y: 26, color: '#6e1423', delay: 900 },
  { id: 'fw3', x: 50, y: 18, color: '#3f8a4c', delay: 1500 },
];
const SPARKS = 12;

// A big celebratory VICTORY moment shown once the verdict carries a parsed
// result. Names the winner by BOTH role and side, shows both scores, and bursts
// confetti + fireworks (pure CSS). Dismissable. Honours prefers-reduced-motion
// (the animation is disabled in CSS there).
// `result` shape: { winner: 'lawyerA'|'lawyerB'|'tie', scoreA, scoreB, sideA, sideB }.
// `nameA`/`nameB` are the advocates' display names (the human's typed name, or
// "AI Counsel") so the winner is declared BY NAME, not "Lawyer A".
export default function VerdictBanner({ result, nameA, nameB }) {
  const [dismissed, setDismissed] = useState(false);
  if (!result) return null;

  const sideA = result.sideA || 'Side A';
  const sideB = result.sideB || 'Side B';
  const scoreA = Number.isFinite(result.scoreA) ? result.scoreA : '—';
  const scoreB = Number.isFinite(result.scoreB) ? result.scoreB : '—';
  const isTie = result.winner === 'tie';

  // The winning advocate's NAME (falls back to the generic seat label) + their side.
  const labelA = nameA || 'Lawyer A';
  const labelB = nameB || 'Lawyer B';
  const winnerName =
    result.winner === ROLES.LAWYER_A ? labelA : result.winner === ROLES.LAWYER_B ? labelB : null;
  const winnerSide = result.winner === ROLES.LAWYER_A ? sideA : result.winner === ROLES.LAWYER_B ? sideB : null;
  // Winner / loser scores for the sub-line.
  const winnerScore = result.winner === ROLES.LAWYER_A ? scoreA : scoreB;
  const loserSide = result.winner === ROLES.LAWYER_A ? sideB : sideA;
  const loserScore = result.winner === ROLES.LAWYER_A ? scoreB : scoreA;

  const headline = isTie
    ? "⚖️ IT'S A TIE"
    : `🎉 ${(winnerName || 'THE WINNER').toUpperCase()} WINS 🎉`;
  // Sub-line keeps the side names + scores for context (e.g. "for the Prosecution").
  const subline = isTie
    ? `${sideA} — ${scoreA}/10 vs ${sideB} — ${scoreB}/10`
    : `${winnerName} — for the ${winnerSide} — ${winnerScore}/10 vs ${loserSide} — ${loserScore}/10`;

  if (dismissed) {
    // Collapsed: keep a compact persistent banner so the result stays visible.
    return (
      <div className="verdict-banner" role="status" aria-live="polite">
        <Scales className="verdict-banner-scales" />
        <div className="verdict-banner-body">
          <span className="verdict-banner-kicker serif">⚖️ Verdict</span>
          <span className="verdict-banner-headline serif">{isTie ? 'The court declares a tie' : `${winnerName} wins`}</span>
          <span className="verdict-banner-scores">
            {sideA} <strong>{scoreA}/10</strong>
            <span className="verdict-banner-dot" aria-hidden="true">·</span>
            {sideB} <strong>{scoreB}/10</strong>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="victory-overlay" role="status" aria-live="polite">
      {/* Pure-CSS confetti + firework bursts (decorative). */}
      <div className="victory-fx" aria-hidden="true">
        {CONFETTI.map((c) => (
          <span
            key={c.id}
            className={`confetti-piece${c.rounded ? ' round' : ''}`}
            style={{
              left: `${c.left}%`,
              width: `${c.size}px`,
              height: `${c.size}px`,
              background: c.color,
              animationDelay: `${c.delay}ms`,
              animationDuration: `${c.duration}ms`,
              '--drift': `${c.drift}px`,
            }}
          />
        ))}
        {FIREWORKS.map((fw) => (
          <span
            key={fw.id}
            className="firework"
            style={{ left: `${fw.x}%`, top: `${fw.y}%`, animationDelay: `${fw.delay}ms` }}
          >
            {Array.from({ length: SPARKS }, (_, s) => (
              <i
                key={s}
                className="firework-spark"
                style={{ background: fw.color, transform: `rotate(${(360 / SPARKS) * s}deg)`, animationDelay: `${fw.delay}ms` }}
              />
            ))}
          </span>
        ))}
      </div>

      <div className="victory-card">
        <button
          type="button"
          className="victory-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss the victory celebration"
        >
          ×
        </button>
        <Scales className="victory-scales" />
        <span className="victory-kicker serif">⚖️ The Verdict</span>
        <h2 className="victory-headline serif">{headline}</h2>
        <p className="victory-subline serif">{subline}</p>
        <button type="button" className="btn btn-primary victory-continue" onClick={() => setDismissed(true)}>
          Continue
        </button>
      </div>
    </div>
  );
}
