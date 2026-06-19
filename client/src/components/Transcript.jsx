import React, { useEffect, useRef } from 'react';
import Scales from './Scales.jsx';

// Defensive: hide any machine-readable "RESULT: winner=…" verdict tag that may
// linger in an entry so the raw line never shows in the record.
function stripResultTag(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[ \t>*_-]*RESULT:\s*winner\s*=.*$/is, '').trimEnd();
}

// The Court Record: a large aged-parchment panel with a faint scales watermark,
// rendering the transcript entries as a formal record. Auto-scrolls to newest.
export default function Transcript({ transcript }) {
  const endRef = useRef(null);
  const entries = transcript || [];

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [entries.length]);

  function labelFor(entry) {
    switch (entry.type) {
      case 'judge':
        return 'The Judge';
      case 'verdict':
        return 'Verdict';
      case 'objection':
        // An objection entry authored by a participant (has a role) is the stated
        // grounds; one from the bench (no role) is the ruling.
        return entry.role ? `${entry.name || 'Counsel'} — Objection` : 'Ruling on Objection';
      case 'argument':
        return entry.name || 'Counsel';
      case 'system':
      default:
        return entry.name || 'Court';
    }
  }

  return (
    <section className="transcript" aria-label="court record">
      <header className="transcript-header">
        <Scales className="transcript-emblem" />
        <h3 className="transcript-title serif">Court Record</h3>
      </header>
      <div className="transcript-body">
        <Scales className="transcript-watermark" />
        {entries.length === 0 ? (
          <p className="transcript-empty serif">The record is empty.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`transcript-entry ${entry.type}`}>
              <div className="entry-meta">
                <span className="entry-speaker">{labelFor(entry)}</span>
                {entry.ts ? (
                  <span className="entry-ts">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>
              <div
                className={
                  entry.type === 'judge' ||
                  entry.type === 'verdict' ||
                  entry.type === 'objection'
                    ? 'entry-text serif'
                    : 'entry-text serif'
                }
              >
                {stripResultTag(entry.text)}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
