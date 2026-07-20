import { useEffect, useState } from 'react'
import { WatcherLogo } from './WatcherLogo'

const STORAGE_KEY = 'watcher.header.collapsed'

type CollapsibleHeaderProps = {
  tabCount: number
}

export function CollapsibleHeader({ tabCount }: CollapsibleHeaderProps): JSX.Element {
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
      <div className="watcher-header__drag" />
      <div className="watcher-header__content">
        <WatcherLogo size={collapsed ? 20 : 28} showWordmark={!collapsed} />
        {!collapsed && (
          <span className="watcher-header__status">
            {tabCount} {tabCount === 1 ? 'agent' : 'agents'} connected
          </span>
        )}
      </div>
      <button
        type="button"
        className="watcher-header__toggle"
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
    </header>
  )
}
