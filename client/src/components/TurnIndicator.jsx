import React from 'react';
import { ROLES, PHASES } from '../protocol.js';

// The center status pill: a gold-bordered oval showing the current phase,
// with a secondary line for whose turn it is to speak.
export default function TurnIndicator({ state }) {
  if (!state) return null;
  const { phase, round, rounds, currentTurn, sideA, sideB } = state;
  const participants = state.participants || [];

  // Prefer the human occupant's name; fall back to the side label (AI/empty seats).
  function speakerLabel(roleKey, side) {
    const occ = participants.find((p) => p.role === roleKey);
    if (occ) return occ.name;
    return side || (roleKey === ROLES.LAWYER_A ? 'Lawyer A' : 'Lawyer B');
  }

  function phaseLabel() {
    switch (phase) {
      case PHASES.LOBBY:
        return 'Lobby';
      case PHASES.OPENING:
        return 'Opening';
      case PHASES.ARGUMENTS:
        return 'Arguments';
      case PHASES.CLOSING:
        return 'Closing';
      case PHASES.VERDICT:
        return 'Verdict';
      case PHASES.ENDED:
        return 'Adjourned';
      default:
        return phase;
    }
  }

  let roundText = null;
  if (phase === PHASES.ARGUMENTS && round) {
    roundText = `Round ${round}${rounds ? ` of ${rounds}` : ''}`;
  }

  let turnText = null;
  if (currentTurn === ROLES.LAWYER_A) {
    turnText = `${speakerLabel(ROLES.LAWYER_A, sideA)} to speak`;
  } else if (currentTurn === ROLES.LAWYER_B) {
    turnText = `${speakerLabel(ROLES.LAWYER_B, sideB)} to speak`;
  }

  return (
    <div className="turn-indicator" aria-live="polite">
      <span className="phase-pill serif">{phaseLabel()}</span>
      {(roundText || turnText) ? (
        <span className="turn-sub">
          {roundText ? <span className="round-label">{roundText}</span> : null}
          {turnText ? <span className="whose-turn">{turnText}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
