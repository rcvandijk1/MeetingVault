import { loadOutletFeed } from '../src/feeds.js';

const $ = (id) => document.getElementById(id);
const data = await (await fetch(chrome.runtime.getURL('data/outlets.json'))).json();
let { leanOverrides = {} } = await chrome.storage.sync.get('leanOverrides');

$('disclaimer').textContent = data.disclaimer;

function cell(text, cls) {
  const td = document.createElement('td');
  td.textContent = text;
  if (cls) td.className = cls;
  return td;
}

function render() {
  $('rows').replaceChildren(...data.outlets.map((o) => {
    const tr = document.createElement('tr');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Indeling van ${o.name}`);
    for (const lean of data.leans) {
      const opt = new Option(lean === o.lean ? `${lean} (standaard)` : lean, lean);
      opt.selected = (leanOverrides[o.id] || o.lean) === lean;
      select.append(opt);
    }
    select.addEventListener('change', async () => {
      if (select.value === o.lean) delete leanOverrides[o.id]; else leanOverrides[o.id] = select.value;
      await chrome.storage.sync.set({ leanOverrides });
    });
    const leanCell = document.createElement('td');
    leanCell.append(select);
    const feed = cell(o.feeds.length ? 'niet gecontroleerd' : 'wordt gezocht via homepage', 'feed');
    feed.id = `feed-${o.id}`;
    tr.append(cell(o.name), cell(o.country), cell(o.owner), leanCell, cell(o.basis), feed);
    return tr;
  }));
}

$('reset').addEventListener('click', async () => {
  leanOverrides = {};
  await chrome.storage.sync.set({ leanOverrides });
  render();
});

$('check').addEventListener('click', async () => {
  $('check').disabled = true;
  const status = $('status');
  status.hidden = false;
  let ok = 0, done = 0;
  status.textContent = 'Feeds controleren…';
  await Promise.all(data.outlets.map(async (o) => {
    const el = $(`feed-${o.id}`);
    el.textContent = 'bezig…';
    el.className = 'feed';
    const r = await loadOutletFeed(o);
    done++;
    if (r.ok) ok++;
    el.textContent = r.ok ? `werkt, ${r.items.length} berichten${r.discovered ? ' (via homepage)' : ''}` : `werkt niet: ${r.error}`;
    el.classList.add(r.ok ? 'ok' : 'bad');
    status.textContent = `${done} van ${data.outlets.length} gecontroleerd…`;
  }));
  status.textContent = `${ok} van ${data.outlets.length} feeds werken. Titels zonder werkende feed tellen niet mee in de vergelijking.`;
  $('check').disabled = false;
});

render();
