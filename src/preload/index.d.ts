import type { WatcherAPI } from './index'

declare global {
  interface Window {
    watcher: WatcherAPI
  }
}
