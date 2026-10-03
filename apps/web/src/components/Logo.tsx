// The app mark: the folded-ribbon "AT", the same artwork the installed app
// shows on a home screen, on a transparent background. The originals are in
// docs/brand.
//
// No tile by default, so the mark sits straight on the page. A surface whose
// own colour would swallow the blue mark (the phone header) hands it a tile
// through `--logo-tile`.
//
// `size` is pixels, or any CSS length (such as a clamp()) so the mark can grow
// with the screen. Everything inside is proportional to it.
export function Logo({ size = 32 }: { size?: number | string }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '28%',
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
        style={{ display: 'block', width: '92%', height: '92%', objectFit: 'contain' }}
      />
    </span>
  )
}
