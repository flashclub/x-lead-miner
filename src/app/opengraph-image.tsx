import { ImageResponse } from 'next/og';

export const alt = 'X Lead Miner';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * 1200x630 Open Graph card. Colors are static (server rendering cannot read
 * CSS theme variables) — these mirror the ember theme palette in
 * src/app/themes/ember.css. Re-brand when the product gets a real name/brand.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background: '#120d09',
          padding: '80px',
        }}
      >
        <div
          style={{
            display: 'flex',
            fontSize: 64,
            color: '#f59e0b',
            marginBottom: 24,
          }}
        >
          ▍
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 88,
            fontWeight: 700,
            color: '#f5ece3',
            letterSpacing: '-0.02em',
          }}
        >
          X Lead Miner
        </div>
        <div style={{ display: 'flex', fontSize: 36, color: '#c2a896', marginTop: 20 }}>
          Find buyers on X before your competitors do
        </div>
      </div>
    ),
    size,
  );
}
