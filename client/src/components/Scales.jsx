import React from 'react';

// A simple gold scales-of-justice emblem used across the courtroom theme.
// Purely decorative (aria-hidden). `className` lets callers size/color it.
export default function Scales({ className = '', title }) {
  return (
    <svg
      className={`scales-icon ${className}`}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* central column */}
        <line x1="32" y1="9" x2="32" y2="50" />
        {/* beam */}
        <line x1="13" y1="17" x2="51" y2="17" />
        {/* finial */}
        <circle cx="32" cy="7" r="2.4" fill="currentColor" stroke="none" />
        {/* base */}
        <line x1="22" y1="54" x2="42" y2="54" />
        <path d="M27 50 q5 4 10 0" />
        {/* left chains + pan */}
        <line x1="13" y1="17" x2="9" y2="30" />
        <line x1="13" y1="17" x2="17" y2="30" />
        <path d="M7 30 a6 6 0 0 0 12 0 Z" fill="currentColor" fillOpacity="0.18" />
        {/* right chains + pan */}
        <line x1="51" y1="17" x2="47" y2="30" />
        <line x1="51" y1="17" x2="55" y2="30" />
        <path d="M45 30 a6 6 0 0 0 12 0 Z" fill="currentColor" fillOpacity="0.18" />
      </g>
    </svg>
  );
}
