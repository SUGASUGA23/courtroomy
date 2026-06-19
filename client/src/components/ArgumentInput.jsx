import React, { useState } from 'react';
import { EVENTS, ROLES, PHASES } from '../protocol.js';
import { emitWithAck } from '../socket.js';

// The local lawyer's argument controls.
// Submit (SUBMIT_ARGUMENT) is enabled ONLY on their turn during a speaking phase.
// Objecting is handled by the shared ObjectionButton (available to all participants).
export default function ArgumentInput({ state, you }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Only lawyers get this component; guard regardless.
  const myRole = you && you.role;
  const isLawyer = myRole === ROLES.LAWYER_A || myRole === ROLES.LAWYER_B;
  if (!isLawyer) return null;

  const phase = state && state.phase;
  const speakingPhase =
    phase === PHASES.OPENING ||
    phase === PHASES.ARGUMENTS ||
    phase === PHASES.CLOSING;

  const isMyTurn = state && state.currentTurn === myRole;
  const code = state && state.code;

  const canSubmit = speakingPhase && isMyTurn && !busy;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || !text.trim()) return;
    setBusy(true);
    try {
      const res = await emitWithAck(EVENTS.SUBMIT_ARGUMENT, {
        code,
        text: text.trim(),
      });
      if (res && res.ok) {
        setText('');
      }
      // Errors surface via ERROR_MSG toast handled in App.
    } finally {
      setBusy(false);
    }
  }

  let hint = '';
  if (!speakingPhase) {
    hint = 'Arguments are closed for this phase.';
  } else if (isMyTurn) {
    hint = 'It is your turn to address the court.';
  } else {
    hint = 'Opposing counsel has the floor.';
  }

  return (
    <form className="argument-input" onSubmit={handleSubmit}>
      <div className="argument-head">
        <span className="argument-label serif">Address the Court</span>
        <span className="argument-hint">{hint}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        disabled={!canSubmit}
        placeholder={
          canSubmit
            ? 'Address the court…'
            : 'You may speak only when it is your turn.'
        }
      />
      <div className="argument-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!canSubmit || !text.trim()}
        >
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </form>
  );
}
