import React from 'react';
import { ROLES } from '../protocol.js';

// The gallery strip: a row of gold-framed thumbnails. Real spectators appear
// first; the remaining frames are decorative exhibit slots (no upload logic).
export default function Gallery({ participants }) {
  const spectators = (participants || []).filter(
    (p) => p.role === ROLES.SPECTATOR || p.role == null
  );

  // Decorative exhibit slots fill out the strip after the real spectators.
  const exhibitSlots = ['Exhibit 1', 'Exhibit 2', 'Exhibit 3', 'Exhibit 4'];

  return (
    <section className="gallery" aria-label="gallery">
      <h3 className="gallery-title serif">Gallery</h3>
      <div className="gallery-row">
        {spectators.map((p) => (
          <figure key={p.id} className="gallery-frame spectator">
            <span className="gallery-thumb" aria-hidden="true">
              <span className="gallery-initial serif">
                {p.name ? p.name[0].toUpperCase() : '?'}
              </span>
            </span>
            <figcaption className="gallery-caption">{p.name || 'Spectator'}</figcaption>
          </figure>
        ))}

        {exhibitSlots.map((label, i) => (
          <figure key={`exhibit-${i}`} className="gallery-frame exhibit">
            <span className="gallery-thumb" aria-hidden="true">
              <span className="gallery-exhibit-mark">{i + 1}</span>
            </span>
            <figcaption className="gallery-caption">{label}</figcaption>
          </figure>
        ))}

        <figure className="gallery-frame add" aria-hidden="true">
          <span className="gallery-thumb add">
            <span className="gallery-plus">+</span>
          </span>
          <figcaption className="gallery-caption">Add Exhibit</figcaption>
        </figure>
      </div>
    </section>
  );
}
