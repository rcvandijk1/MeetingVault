import { findOutlet, hostnameOf } from './src/outlets.js';

let outletsPromise = null;
function loadOutlets() {
  outletsPromise ||= fetch(chrome.runtime.getURL('data/outlets.json')).then((r) => r.json()).then((d) => d.outlets);
  return outletsPromise;
}

// Een klik op het icoon opent het zijpaneel én geeft via activeTab tijdelijk toegang tot de huidige pagina.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  setTimeout(() => chrome.runtime.sendMessage({ type: 'kl:refresh', tabId: tab.id }).catch(() => {}), 300);
});

async function updateBadge(tabId, url, isArticle = false) {
  const outlet = url ? findOutlet(await loadOutlets(), hostnameOf(url)) : null;
  try {
    await chrome.action.setBadgeText({ tabId, text: outlet ? (isArticle ? 'art' : 'nws') : '' });
    if (outlet) await chrome.action.setBadgeBackgroundColor({ tabId, color: isArticle ? '#e76f51' : '#457b9d' });
    await chrome.action.setTitle({
      tabId,
      title: outlet
        ? `Kantlijn: ${outlet.name} herkend${isArticle ? ', artikel gevonden' : ''}. Klik om te analyseren.`
        : 'Kantlijn: klik om deze pagina te analyseren',
    });
  } catch { /* tabblad is intussen gesloten */ }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) updateBadge(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'kl:page' && sender.tab) updateBadge(sender.tab.id, sender.tab.url, !!msg.isArticle);
});
