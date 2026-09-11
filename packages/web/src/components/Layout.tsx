import { NavLink, Outlet } from 'react-router-dom';
import { Radar, Search, GitCompare, History, UserCog, Settings, Plane, Tag } from 'lucide-react';
import { useCompareStore } from '../store/compare';
import { useProviderStatus } from '../api/hooks';

const NAV = [
  { to: '/', label: 'Radar', icon: Radar, end: true },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/deals', label: 'Deals', icon: Tag },
  { to: '/compare', label: 'Compare', icon: GitCompare },
  { to: '/history', label: 'History', icon: History },
  { to: '/profiles', label: 'Profiles', icon: UserCog },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Layout() {
  const compare = useCompareStore((s) => s.ids.length);
  const providers = useProviderStatus();
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Plane size={22} color="var(--c-accent)" />
          <div>
            <div className="brand-name">Krabi Flight Radar</div>
            <div className="brand-sub">Alphen aan den Rijn → Krabi</div>
          </div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} data-testid={`nav-${n.label.toLowerCase()}`}>
            <n.icon size={16} /> {n.label}
            {n.label === 'Compare' && compare > 0 && <span className="nav-badge">{compare}</span>}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          Providers: {providers.data?.configured.join(', ') ?? '…'}
          <br />
          {providers.data?.health.map((h) => (
            <span key={h.provider} style={{ color: h.ok ? 'var(--c-good)' : 'var(--c-warn)' }}>
              {h.provider}: {h.ok ? 'ok' : 'unavailable'}
              <br />
            </span>
          ))}
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
