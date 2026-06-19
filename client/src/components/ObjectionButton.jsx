import React, { useState, useEffect, useRef } from 'react';
import { EVENTS, ROLES, PHASES } from '../protocol.js';
import { socket } from '../socket.js';

// A standalone "Objection!" control available to ANY participant watching a trial
// in progress — the host/spectator in AI-vs-AI mode, or a lawyer who is NOT
// currently speaking. A lawyer cannot object on their own turn. The user STATES
// the grounds of their objection in a small text input; the judge then rules on
// THAT specific complaint. A short cooldown after each submit prevents spam.
const COOLDOWN_MS = 4000;

export default function ObjectionButton({ state, you }) {
  const [cooling, setCooling] = useState(false);
  const [text, setText] = useState('');
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!state) return null;

  const phase = state.phase;
  const speakingPhase =
    phase === PHASES.OPENING ||
    phase === PHASES.ARGUMENTS ||
    phase === PHASES.CLOSING;
  const inProgress = state.status === 'in-trial';

  const myRole = you && you.role;
  const isLawyer = myRole === ROLES.LAWYER_A || myRole === ROLES.LAWYER_B;
  // A lawyer may not object during their own turn; everyone else may always object
  // while counsel has the floor.
  const blockedOwnTurn = isLawyer && state.currentTurn === myRole;

  const available = inProgress && speakingPhase && !blockedOwnTurn;
  if (!available) return null;

  const trimmed = text.trim();
  const disabled = cooling;
  const canSubmit = !disabled && trimmed.length > 0;

  function handleObjection(e) {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    // Send the user's stated grounds so the judge rules on THIS objection.
    socket.emit(EVENTS.RAISE_OBJECTION, { code: state.code, text: trimmed });
    setText('');
    setCooling(true);
    timerRef.current = setTimeout(() => setCooling(false), COOLDOWN_MS);
  }

  return (
    <form className="objection-bar" onSubmit={handleObjection}>
      <input
        type="text"
        className="objection-input"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        disabled={disabled}
        placeholder="State your objection — e.g. Hearsay, Speculation, Relevance, Leading the witness"
        aria-label="State the grounds of your objection"
      />
      <button
        type="submit"
        className={`btn btn-objection${canSubmit ? ' armed' : ''}`}
        disabled={!canSubmit}
        title="State your grounds, then object — the judge will rule Sustained or Overruled"
      >
        {disabled ? 'Objection raised…' : 'Object!'}
      </button>
    </form>
  );
}
