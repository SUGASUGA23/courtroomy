import React, { useState } from 'react';
import { EVENTS, ROLES, CONTROLLER } from '../protocol.js';
import { emitWithAck } from '../socket.js';
import DisclaimerBanner from './DisclaimerBanner.jsx';
import Scales from './Scales.jsx';

// Join flow: enter code + name (JOIN_ROOM), then pick a role (PICK_ROLE).
// Shows which lawyer slots are already taken so they can't be double-claimed.
export default function JoinRoom({ onJoined, onBack }) {
  const [step, setStep] = useState('enter'); // 'enter' | 'pick'
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState(null);
  const [you, setYou] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleJoin(e) {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) {
      setError('Enter both a room code and your name.');
      return;
    }
    setBusy(true);
    try {
      const res = await emitWithAck(EVENTS.JOIN_ROOM, {
        code: code.trim().toUpperCase(),
        name: name.trim(),
      });
      if (res && res.ok) {
        setState(res.state);
        setYou(res.you);
        setStep('pick');
      } else {
        setError((res && res.error) || 'Could not join that room.');
      }
    } catch (err) {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function pickRole(role) {
    setError('');
    setBusy(true);
    try {
      const res = await emitWithAck(EVENTS.PICK_ROLE, {
        code: code.trim().toUpperCase(),
        role,
      });
      if (res && res.ok) {
        onJoined({
          code: code.trim().toUpperCase(),
          you: { ...you, role },
          state,
        });
      } else {
        setError((res && res.error) || 'That role is no longer available.');
      }
    } catch (err) {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'pick') {
    const participants = (state && state.participants) || [];
    const lawyers = (state && state.lawyers) || { lawyerA: CONTROLLER.HUMAN, lawyerB: CONTROLLER.HUMAN };
    const aIsAi = lawyers.lawyerA === CONTROLLER.AI;
    const bIsAi = lawyers.lawyerB === CONTROLLER.AI;
    const takenA = participants.some((p) => p.role === ROLES.LAWYER_A);
    const takenB = participants.some((p) => p.role === ROLES.LAWYER_B);
    const sideA = (state && state.sideA) || 'Side A';
    const sideB = (state && state.sideB) || 'Side B';

    return (
      <div className="entry-scene">
        <DisclaimerBanner />
        <div className="entry-center">
        <div className="panel form-panel">
        <div className="form-panel-head">
          <Scales className="form-emblem" />
          <h2 className="serif">Choose your role</h2>
          <div className="entry-flourish" aria-hidden="true" />
        </div>
        <p className="join-case-title serif">
          {state ? state.caseTitle : ''}
        </p>
        <div className="role-picker">
          <button
            className={`btn role-btn${aIsAi ? ' role-ai' : ''}`}
            disabled={aIsAi || takenA || busy}
            onClick={() => pickRole(ROLES.LAWYER_A)}
          >
            <span className="role-side">{sideA}</span>
            <span className="role-label">{aIsAi ? 'AI Counsel' : 'Lawyer A'}</span>
            {aIsAi ? (
              <span className="role-ai-tag">Argued by AI</span>
            ) : takenA ? (
              <span className="role-taken">Taken</span>
            ) : null}
          </button>

          <button
            className={`btn role-btn${bIsAi ? ' role-ai' : ''}`}
            disabled={bIsAi || takenB || busy}
            onClick={() => pickRole(ROLES.LAWYER_B)}
          >
            <span className="role-side">{sideB}</span>
            <span className="role-label">{bIsAi ? 'AI Counsel' : 'Lawyer B'}</span>
            {bIsAi ? (
              <span className="role-ai-tag">Argued by AI</span>
            ) : takenB ? (
              <span className="role-taken">Taken</span>
            ) : null}
          </button>

          <button
            className="btn role-btn role-spectator"
            disabled={busy}
            onClick={() => pickRole(ROLES.SPECTATOR)}
          >
            <span className="role-side">Gallery</span>
            <span className="role-label">Spectator</span>
          </button>
        </div>

        {aIsAi && bIsAi ? (
          <p className="role-ava-note serif">
            This is an AI vs AI trial — there are no human lawyer seats. Join the gallery to watch.
          </p>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setStep('enter')}
            disabled={busy}
          >
            Back
          </button>
        </div>
      </div>
      </div>
      </div>
    );
  }

  return (
    <div className="entry-scene">
      <DisclaimerBanner />
      <div className="entry-center">
      <div className="panel form-panel">
      <div className="form-panel-head">
        <Scales className="form-emblem" />
        <h2 className="serif">Join a Case</h2>
        <div className="entry-flourish" aria-hidden="true" />
      </div>
      <form onSubmit={handleJoin} className="case-form">
        <label>
          Room code
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="6-character code"
            maxLength={6}
            className="code-input"
          />
        </label>
        <label>
          Your name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="How others will see you"
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </form>
      </div>
      </div>
    </div>
  );
}
