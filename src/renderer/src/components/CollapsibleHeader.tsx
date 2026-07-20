import { useEffect, useState } from 'react'
import { WatcherLogo } from './WatcherLogo'
import type { Theme } from '../useTheme'

const STORAGE_KEY = 'watcher.header.collapsed'

type CollapsibleHeaderProps = {
  tabCount: number
  theme: Theme
  onToggleTheme: () => void
}

export function CollapsibleHeader({ tabCount, theme, onToggleTheme }: CollapsibleHeaderProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      // localStorage may be unavailable (e.g. private browsing); collapse state simply won't persist.
    }
  }, [collapsed])

  return (
    <header className={`watcher-header ${collapsed ? 'watcher-header--collapsed' : ''}`}>
      <div className="watcher-header__art" aria-hidden="true" />
      <div className="watcher-header__bar">
        <div className="watcher-header__content">
          <WatcherLogo size={collapsed ? 20 : 28} showWordmark={!collapsed} />
          {!collapsed && (
            <span className="watcher-header__status">
              {tabCount} {tabCount === 1 ? 'agent' : 'agents'} connected
            </span>
          )}
        </div>
        <div className="watcher-header__controls">
          <button
            type="button"
            className="watcher-header__icon-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M13.5 9.2A5.8 5.8 0 0 1 6.8 2.5a5.8 5.8 0 1 0 6.7 6.7Z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="watcher-header__icon-btn"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expand header' : 'Collapse header'}
            aria-label={collapsed ? 'Expand header' : 'Collapse header'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d={collapsed ? 'M4 2L9 7L4 12' : 'M11 4L6.5 9L2 4'}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}
