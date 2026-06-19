import React, { useState } from 'react';
import { EVENTS, MODES, ROLES } from '../protocol.js';
import { emitWithAck } from '../socket.js';
import DisclaimerBanner from './DisclaimerBanner.jsx';
import Scales from './Scales.jsx';

const MODE_OPTIONS = [
  { value: MODES.HVH, label: 'Human vs Human', hint: 'Two human lawyers argue the case.' },
  { value: MODES.HVA, label: 'Human vs AI', hint: 'You argue one side; AI Counsel argues the other.' },
  { value: MODES.AVA, label: 'AI vs AI', hint: 'Two AI advocates argue; you preside as spectator.' },
];

// Case creation form. On success emits CREATE_ROOM and lifts { code, you, state } to App.
export default function CreateCase({ onJoined, onBack }) {
  const [caseTitle, setCaseTitle] = useState('');
  const [caseType, setCaseType] = useState('civil');
  const [description, setDescription] = useState('');
  const [facts, setFacts] = useState('');
  const [jurisdiction, setJurisdiction] = useState('auto');
  const [customJurisdiction, setCustomJurisdiction] = useState('');
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [clientA, setClientA] = useState('');
  const [clientB, setClientB] = useState('');
  const [rounds, setRounds] = useState(2);
  const [name, setName] = useState('');
  const [mode, setMode] = useState(MODES.HVH);
  const [humanSide, setHumanSide] = useState(ROLES.LAWYER_A);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!caseTitle.trim() || !name.trim() || !sideA.trim() || !sideB.trim()) {
      setError('Please fill in the case title, both sides, and your name.');
      return;
    }
    setBusy(true);
    // When "Other" is chosen, send the TYPED jurisdiction (e.g. "Japan"); if the
    // box is empty, fall back to auto-detect rather than the literal "other".
    const resolvedJurisdiction =
      jurisdiction === 'other' ? (customJurisdiction.trim() || 'auto') : jurisdiction;
    try {
      const res = await emitWithAck(EVENTS.CREATE_ROOM, {
        caseTitle: caseTitle.trim(),
        caseType,
        description: description.trim(),
        facts: facts.trim(),
        jurisdiction: resolvedJurisdiction,
        sideA: sideA.trim(),
        sideB: sideB.trim(),
        clientA: clientA.trim(),
        clientB: clientB.trim(),
        rounds: Number(rounds),
        name: name.trim(),
        mode,
        // Only meaningful for hva; harmless otherwise.
        humanSide,
      });
      if (res && res.ok) {
        onJoined({ code: res.code, you: res.you, state: res.state });
      } else {
        setError((res && res.error) || 'Could not create the case.');
      }
    } catch (err) {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="entry-scene">
      <DisclaimerBanner />
      <div className="entry-center">
      <div className="panel form-panel">
      <div className="form-panel-head">
        <Scales className="form-emblem" />
        <h2 className="serif">Create a Case</h2>
        <div className="entry-flourish" aria-hidden="true" />
      </div>
      <form onSubmit={handleSubmit} className="case-form">
        <label>
          Case title
          <input
            type="text"
            value={caseTitle}
            onChange={(e) => setCaseTitle(e.target.value)}
            placeholder="The People v. ..."
          />
        </label>

        <div className="form-row">
          <label>
            Case type
            <select value={caseType} onChange={(e) => setCaseType(e.target.value)}>
              <option value="civil">Civil</option>
              <option value="criminal">Criminal</option>
              <option value="small-claims">Small Claims</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Jurisdiction
            <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="uk">United Kingdom</option>
              <option value="us">United States</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        {jurisdiction === 'other' ? (
          <label>
            Specify jurisdiction
            <input
              type="text"
              value={customJurisdiction}
              onChange={(e) => setCustomJurisdiction(e.target.value)}
              placeholder="e.g. Japan, China, Germany"
            />
          </label>
        ) : null}

        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="Summarize the dispute, the facts, and what is being decided."
          />
        </label>

        <label>
          Case facts / evidence (optional)
          <textarea
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            rows={4}
            placeholder="Concrete facts, evidence, dates, witness statements, or stakes the lawyers can argue from."
          />
        </label>

        <div className="form-row">
          <div className="side-group">
            <label>
              Side A
              <input
                type="text"
                value={sideA}
                onChange={(e) => setSideA(e.target.value)}
                placeholder="Prosecution / Plaintiff"
              />
            </label>
            <label>
              Client they represent (optional)
              <input
                type="text"
                value={clientA}
                onChange={(e) => setClientA(e.target.value)}
                placeholder="e.g. Sarah Mitchell"
              />
            </label>
          </div>
          <div className="side-group">
            <label>
              Side B
              <input
                type="text"
                value={sideB}
                onChange={(e) => setSideB(e.target.value)}
                placeholder="Defense"
              />
            </label>
            <label>
              Client they represent (optional)
              <input
                type="text"
                value={clientB}
                onChange={(e) => setClientB(e.target.value)}
                placeholder="e.g. James Carter"
              />
            </label>
          </div>
        </div>

        <fieldset className="mode-fieldset">
          <legend className="mode-legend serif">Trial mode</legend>
          <div className="mode-grid">
            {MODE_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                className={`mode-card${mode === opt.value ? ' selected' : ''}`}
                aria-pressed={mode === opt.value}
                onClick={() => setMode(opt.value)}
              >
                <span className="mode-card-label serif">{opt.label}</span>
                <span className="mode-card-hint">{opt.hint}</span>
              </button>
            ))}
          </div>

          {mode === MODES.HVA ? (
            <div className="mode-side-choice">
              <span className="mode-side-prompt serif">You argue as:</span>
              <div className="mode-side-buttons">
                <button
                  type="button"
                  className={`mode-side-btn${humanSide === ROLES.LAWYER_A ? ' selected' : ''}`}
                  aria-pressed={humanSide === ROLES.LAWYER_A}
                  onClick={() => setHumanSide(ROLES.LAWYER_A)}
                >
                  {sideA.trim() || 'Side A'}
                </button>
                <button
                  type="button"
                  className={`mode-side-btn${humanSide === ROLES.LAWYER_B ? ' selected' : ''}`}
                  aria-pressed={humanSide === ROLES.LAWYER_B}
                  onClick={() => setHumanSide(ROLES.LAWYER_B)}
                >
                  {sideB.trim() || 'Side B'}
                </button>
              </div>
              <span className="mode-side-note">
                The other side will be argued by AI Counsel.
              </span>
            </div>
          ) : null}
        </fieldset>

        <div className="form-row">
          <label>
            Rounds of argument
            <select value={rounds} onChange={(e) => setRounds(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
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
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={busy}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create case'}
          </button>
        </div>
      </form>
      </div>
      </div>
    </div>
  );
}
