import React, { useEffect, useRef } from 'react';
import Scales from './Scales.jsx';

// Hide the machine-readable "RESULT: winner=…; scoreA=…; scoreB=…" tag the judge
// appends to a verdict so the raw line never shows to users (it drives the
// VerdictBanner instead). Strips it even while it is mid-stream in the live bubble.
function stripResultTag(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[ \t>*_-]*RESULT:\s*winner\s*=.*$/is, '').trimEnd();
}

// The header / bench. Carries the title, a gold scales emblem, the robed-judge
// medallion, and the dark translucent status panel where the judge's current line
// renders. Shows the latest finalized judge statement at rest, the live-streamed
// tokens (judgeLive) while composing, or a "considering…" indicator (judgeThinking).
export default function Bench({ state, judgeLive, judgeThinking }) {
  const liveRef = useRef(null);

  // Find the latest finalized judge entry for the resting state.
  const transcript = (state && state.transcript) || [];
  let lastJudge = null;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const t = transcript[i].type;
    if (t === 'judge' || t === 'objection' || t === 'verdict') {
      lastJudge = transcript[i];
      break;
    }
  }

  const liveText = stripResultTag(judgeLive);
  const streaming = Boolean(judgeLive && judgeLive.length);

  useEffect(() => {
    if (liveRef.current) {
      liveRef.current.scrollTop = liveRef.current.scrollHeight;
    }
  }, [judgeLive]);

  return (
    <section className="bench" aria-label="judge's bench">
      <header className="bench-header">
        <Scales className="bench-emblem-icon" />
        <h1 className="bench-title">The Honorable AI Judge</h1>
        <div className="bench-flourish" aria-hidden="true" />
      </header>

      <div className="bench-medallion" aria-hidden="true">
        <span className="bench-judge-seal">
          <Scales className="bench-seal-scales" />
        </span>
      </div>

      <div className="bench-status" ref={liveRef}>
        {judgeThinking && !streaming ? (
          <p className="judge-thinking">
            The judge is considering
            <span className="dots" aria-hidden="true"><i></i><i></i><i></i></span>
          </p>
        ) : null}

        {streaming ? (
          <p className="judge-statement streaming">{liveText}</p>
        ) : lastJudge ? (
          <p className="judge-statement">{stripResultTag(lastJudge.text)}</p>
        ) : (
          <p className="judge-statement judge-idle">
            Court is in session. Awaiting the proceedings…
          </p>
        )}
      </div>
    </section>
  );
}
