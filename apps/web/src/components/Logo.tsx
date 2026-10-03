// The app mark: the folded-ribbon "AT", the same artwork the installed app
// shows on a home screen, on a transparent background. The originals are in
// docs/brand.
//
// No tile by default, so the mark sits straight on the page. A surface whose
// own colour would swallow the blue mark (the phone header) hands it a tile
// through `--logo-tile`.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'var(--logo-tile, transparent)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <img
        src="/brand/at-blue-mark-256.png"
        alt=""
        width={Math.round(size * 0.92)}
        height={Math.round(size * 0.92)}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    </span>
  )
}
