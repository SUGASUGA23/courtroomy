import React from 'react';

// A single lawyer's parchment card inside an ornate gilded frame.
// Highlights when it is this side's turn (active).
// `participant` is { id, name, role } or null when the slot is empty.
// `isAi` marks an AI-controlled seat (shows an "AI Counsel" treatment).
// `composing` is true while the server is generating this AI lawyer's argument.
export default function Podium({ side, sideLabel, client, roleKey, participant, active, isYou, isAi, composing }) {
  const initial = participant && participant.name ? participant.name[0].toUpperCase() : null;
  // The generic "Lawyer A/B" tag is only shown while the seat is still OPEN, so a
  // joiner knows which chair to claim. Once a human or AI occupies it, the card is
  // identified by the occupant's own name (or "AI Counsel"), never "Lawyer A/B".
  const seatFilled = isAi || Boolean(participant);
  const bandLabel = seatFilled ? null : roleKey === 'lawyerA' ? 'Lawyer A' : 'Lawyer B';

  const classes = ['lawyer-card'];
  if (active) classes.push('active');
  if (isAi) classes.push('ai');
  classes.push(side === 'left' ? 'side-a' : 'side-b');

  let status;
  if (isAi) {
    if (composing) status = 'Composing…';
    else if (active) status = 'Speaking…';
    else status = 'Standing by';
  } else if (!participant) {
    status = 'Awaiting counsel';
  } else if (active) {
    status = 'Speaking…';
  } else {
    status = 'Standing by';
  }

  // The displayed name for the seat.
  let displayName;
  if (isAi) {
    displayName = <span className="lawyer-ai-name">AI Counsel</span>;
  } else if (participant) {
    displayName = participant.name;
  } else {
    displayName = <span className="lawyer-empty">Empty seat</span>;
  }

  return (
    <div className={classes.join(' ')} aria-label={`${sideLabel} counsel`}>
      <div className="lawyer-frame">
        <div className="lawyer-parchment">
          <div className="lawyer-side-label serif">{sideLabel}</div>
          {client ? <div className="lawyer-client serif">for {client}</div> : null}

          <div className="lawyer-avatar" aria-hidden="true">
            {isAi ? (
              <svg className="lawyer-ai-glyph" viewBox="0 0 48 48" focusable="false">
                {/* A simple gilded "AI scales/automaton" glyph for AI Counsel. */}
                <rect x="15" y="10" width="18" height="15" rx="4" fill="currentColor" />
                <circle cx="20.5" cy="17.5" r="2.2" fill="#2a1d07" />
                <circle cx="27.5" cy="17.5" r="2.2" fill="#2a1d07" />
                <rect x="22.5" y="4" width="3" height="6" rx="1.5" fill="currentColor" />
                <circle cx="24" cy="3" r="2.4" fill="currentColor" />
                <path d="M12 44c0-7 5.4-11 12-11s12 4 12 11Z" fill="currentColor" />
              </svg>
            ) : initial ? (
              <span className="lawyer-initial serif">{initial}</span>
            ) : (
              <svg className="lawyer-silhouette" viewBox="0 0 48 48" focusable="false">
                <circle cx="24" cy="17" r="9" fill="currentColor" />
                <path
                  d="M8 44c0-9 7.2-15 16-15s16 6 16 15Z"
                  fill="currentColor"
                />
              </svg>
            )}
          </div>

          <div className="lawyer-name serif">
            {displayName}
            {isAi ? <span className="lawyer-ai-badge">AI</span> : null}
            {isYou ? <span className="lawyer-you">you</span> : null}
          </div>

          <div className={`lawyer-status${active || composing ? ' active' : ''}`}>
            {composing ? (
              <span className="lawyer-composing">
                Composing
                <span className="dots" aria-hidden="true"><i></i><i></i><i></i></span>
              </span>
            ) : isYou && active ? (
              'Your turn'
            ) : (
              status
            )}
          </div>

          {bandLabel ? <div className="lawyer-band serif">{bandLabel}</div> : null}
        </div>
      </div>
    </div>
  );
}
