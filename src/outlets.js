// Opzoeken van titels op hostnaam en toepassen van de eigen indeling van de gebruiker.

export function findOutlet(outlets, hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  return outlets.find((o) => o.domains.some((d) => host === d || host.endsWith(`.${d}`))) || null;
}

export function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// overrides: { [outletId]: lean }
export function applyOverrides(outlets, overrides, leans) {
  return outlets.map((o) => {
    const lean = overrides?.[o.id];
    return lean && leans.includes(lean) && lean !== o.lean ? { ...o, lean, overridden: true, defaultLean: o.lean } : o;
  });
}

export function matchPatterns(outlets) {
  return [...new Set(outlets.flatMap((o) => o.domains))].sort().map((d) => `*://*.${d}/*`);
}
