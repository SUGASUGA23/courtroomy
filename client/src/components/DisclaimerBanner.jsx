import React from 'react';

// Persistent, unmissable educational disclaimer. Styled as a subtle gold-on-dark
// strip so it fits the gilded courtroom theme.
export default function DisclaimerBanner() {
  return (
    <div className="disclaimer-banner" role="note" aria-label="disclaimer">
      <span aria-hidden="true">&#9878;&#65039;</span>
      Educational simulation only — not real legal advice.
    </div>
  );
}
