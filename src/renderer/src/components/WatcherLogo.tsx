type WatcherLogoProps = {
  size?: number
  showWordmark?: boolean
}

/**
 * Placeholder brand mark for Watcher: an aperture/eye motif inside a window
 * frame, standing in for "many agents, one pane of glass" until real
 * artwork is supplied.
 */
export function WatcherLogo({ size = 28, showWordmark = true }: WatcherLogoProps): JSX.Element {
  return (
    <div className="watcher-logo">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="watcher-logo-gradient" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#6e56cf" />
            <stop offset="1" stopColor="#12b5b0" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="36" height="36" rx="10" stroke="url(#watcher-logo-gradient)" strokeWidth="2.5" />
        <path
          d="M8 20c3.2-5.5 8-8.3 12-8.3s8.8 2.8 12 8.3c-3.2 5.5-8 8.3-12 8.3S11.2 25.5 8 20Z"
          stroke="url(#watcher-logo-gradient)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle cx="20" cy="20" r="4.2" fill="url(#watcher-logo-gradient)" />
      </svg>
      {showWordmark && (
        <span className="watcher-logo__wordmark">
          WATCHER
          <span className="watcher-logo__tagline">multi-agent IDE</span>
        </span>
      )}
    </div>
  )
}
