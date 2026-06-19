import React from 'react';
import { EVENTS, ROLES, PHASES, MODES, CONTROLLER } from '../protocol.js';
import { emitWithAck } from '../socket.js';
import DisclaimerBanner from './DisclaimerBanner.jsx';
import Bench from './Bench.jsx';
import Podium from './Podium.jsx';
import Gallery from './Gallery.jsx';
import Transcript from './Transcript.jsx';
import TurnIndicator from './TurnIndicator.jsx';
import ArgumentInput from './ArgumentInput.jsx';
import ObjectionButton from './ObjectionButton.jsx';
import VerdictBanner from './VerdictBanner.jsx';
import Scales from './Scales.jsx';

// Main trial view. Realises the gilded-courtroom reference layout:
// header/bench at top, two lawyer cards flanking the center, a phase pill,
// a Case Details panel (host's Begin Trial + notifications), the Court Record,
// a gallery strip, and a footer toolbar with the Leave control.
// Props (from App): state, you {id, role, name}, judgeLive (accumulated tokens),
// judgeThinking (bool), onLeave, onToast.
export default function Courtroom({ state, you, judgeLive, judgeThinking, onLeave, onToast }) {
  if (!state) {
    return (
      <div className="courtroom-scene">
        <DisclaimerBanner />
        <p className="loading serif">Entering the courtroom…</p>
      </div>
    );
  }

  const participants = state.participants || [];
  const lawyerA = participants.find((p) => p.role === ROLES.LAWYER_A) || null;
  const lawyerB = participants.find((p) => p.role === ROLES.LAWYER_B) || null;

  const lawyers = state.lawyers || { lawyerA: CONTROLLER.HUMAN, lawyerB: CONTROLLER.HUMAN };
  const aIsAi = lawyers.lawyerA === CONTROLLER.AI;
  const bIsAi = lawyers.lawyerB === CONTROLLER.AI;
  const mode = state.mode || MODES.HVH;

  // A human seat is "ready" only when filled; an AI seat is always ready.
  const seatReadyA = aIsAi || Boolean(lawyerA);
  const seatReadyB = bIsAi || Boolean(lawyerB);

  // Display name for each seat: the human occupant's typed name, else "AI Counsel"
  // for an AI seat, else the generic fallback. Used to declare the winner BY NAME.
  const nameA = lawyerA ? lawyerA.name : aIsAi ? 'AI Counsel' : 'Lawyer A';
  const nameB = lawyerB ? lawyerB.name : bIsAi ? 'AI Counsel' : 'Lawyer B';

  const isHost = you && state.hostId && you.id === state.hostId;
  const inLobby = state.phase === PHASES.LOBBY;
  const canBegin = seatReadyA && seatReadyB;
  const verdictDelivered =
    state.phase === PHASES.VERDICT || state.phase === PHASES.ENDED;

  const myRole = you && you.role;
  const isLawyer = myRole === ROLES.LAWYER_A || myRole === ROLES.LAWYER_B;

  async function beginTrial() {
    if (!canBegin) return;
    await emitWithAck(EVENTS.START_TRIAL, { code: state.code });
    // Errors surface via ERROR_MSG toast handled in App.
  }

  // Lightweight notifications driven from real state (no new socket events).
  const notifications = [];
  if (mode === MODES.AVA) {
    notifications.push({
      key: 'ava',
      text: canBegin ? 'AI vs AI — ready to begin' : 'AI vs AI — preparing counsel',
      tone: canBegin ? 'ok' : 'wait',
    });
  } else if (mode === MODES.HVA) {
    // Exactly one human seat needs filling.
    const humanReady = aIsAi ? seatReadyB : seatReadyA;
    notifications.push(
      humanReady
        ? { key: 'hva-ready', text: 'The human lawyer is present', tone: 'ok' }
        : { key: 'hva-wait', text: 'Waiting for the human lawyer', tone: 'wait' }
    );
  } else if (canBegin) {
    notifications.push({ key: 'both', text: 'Both lawyers present', tone: 'ok' });
  } else {
    notifications.push({
      key: 'await',
      text: 'Awaiting both counsel to be seated',
      tone: 'wait',
    });
  }
  if (inLobby) {
    notifications.push({
      key: 'begin',
      text: 'Waiting for host to begin',
      tone: 'wait',
    });
  }
  if (state.aiThinking) {
    notifications.push({ key: 'composing', text: 'AI Counsel is composing…', tone: 'wait' });
  }
  if (verdictDelivered) {
    notifications.push({ key: 'verdict', text: 'Verdict delivered', tone: 'gold' });
  }

  return (
    <div className="courtroom-scene">
      <DisclaimerBanner />

      {/* PROMINENT VERDICT BANNER — appears once a winner is decided */}
      {state.result ? <VerdictBanner result={state.result} nameA={nameA} nameB={nameB} /> : null}

      <div className="court-grid">
        {/* HEADER + BENCH (title, emblem, judge medallion, status panel) */}
        <Bench state={state} judgeLive={judgeLive} judgeThinking={judgeThinking} />

        {/* LAWYER A (left) */}
        <div className="seat seat-left">
          <Podium
            side="left"
            sideLabel={state.sideA}
            client={state.clientA}
            roleKey={ROLES.LAWYER_A}
            participant={lawyerA}
            active={state.currentTurn === ROLES.LAWYER_A}
            isYou={myRole === ROLES.LAWYER_A}
            isAi={aIsAi}
            composing={state.aiThinking === ROLES.LAWYER_A}
          />
        </div>

        {/* CENTER STATUS PILL */}
        <div className="seat seat-center">
          <TurnIndicator state={state} />
        </div>

        {/* LAWYER B (right) */}
        <div className="seat seat-right">
          <Podium
            side="right"
            sideLabel={state.sideB}
            client={state.clientB}
            roleKey={ROLES.LAWYER_B}
            participant={lawyerB}
            active={state.currentTurn === ROLES.LAWYER_B}
            isYou={myRole === ROLES.LAWYER_B}
            isAi={bIsAi}
            composing={state.aiThinking === ROLES.LAWYER_B}
          />
        </div>

        {/* CASE DETAILS PANEL (oxblood, right column) */}
        <aside className="case-details" aria-label="case details">
          <h3 className="case-details-title serif">Case Details</h3>
          <p className="case-details-name serif">{state.caseTitle}</p>
          <p className="case-details-type">
            Case Type: <strong>{state.caseType}</strong>
          </p>
          {state.description ? (
            <p className="case-details-desc">{state.description}</p>
          ) : null}
          <p className="case-details-room">
            Room code: <strong>{state.code}</strong>
          </p>

          {inLobby ? (
            isHost ? (
              <button
                className="btn btn-begin"
                onClick={beginTrial}
                disabled={!canBegin}
              >
                Begin Trial
              </button>
            ) : (
              <p className="case-details-wait serif">
                Awaiting the host to convene the court…
              </p>
            )
          ) : null}
          {inLobby && !canBegin ? (
            <p className="case-details-hint">
              {mode === MODES.HVA
                ? 'The human lawyer seat must be filled to begin.'
                : 'Every human lawyer seat must be filled to begin.'}
            </p>
          ) : null}

          <h4 className="case-details-subhead serif">Notifications</h4>
          <ul className="notifications">
            {notifications.map((n) => (
              <li key={n.key} className={`notification ${n.tone}`}>
                {n.text}
              </li>
            ))}
          </ul>
        </aside>

        {/* COURT RECORD (center-lower) + the local user's controls */}
        <div className="record-col">
          <Transcript transcript={state.transcript} />
          {/* Objection is available to ANY participant while counsel has the floor,
              including the host/spectator in AI-vs-AI mode. */}
          <ObjectionButton state={state} you={you} />
          {isLawyer ? <ArgumentInput state={state} you={you} /> : null}
        </div>

        {/* GALLERY strip */}
        <div className="gallery-col">
          <Gallery participants={participants} />
        </div>
      </div>

      {/* FOOTER TOOLBAR */}
      <footer className="court-toolbar" aria-label="court toolbar">
        <div className="toolbar-brand">
          <Scales className="toolbar-scales" />
          <span className="serif">The Honorable AI Judge</span>
        </div>
        <div className="toolbar-actions">
          <span className="toolbar-room">Room {state.code}</span>
          <button className="toolbar-btn" onClick={onLeave}>
            Leave Court
          </button>
        </div>
      </footer>
    </div>
  );
}
