import { loadOutletFeed } from '../src/feeds.js';
import { MODELS } from '../src/ai.js';
import { getMembership, setMemberToken } from '../src/membership.js';
import { CONFIG } from '../config.js';
import { loadAiSettings, createClient, explainError } from '../panel/ai-client.js';

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

// ---- AI-sleutel ----

const ai = await loadAiSettings();
$('ai-model').replaceChildren(...MODELS.map((m) => new Option(m.label, m.id, false, m.id === ai.model)));
$('ai-key').placeholder = ai.key ? `Bewaard (eindigt op ${ai.key.slice(-4)})` : 'sk-ant-…';

function aiStatus(text, isError = false) {
  const el = $('ai-status');
  el.hidden = !text;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

$('ai-model').addEventListener('change', () => chrome.storage.local.set({ aiModel: $('ai-model').value }));

$('ai-save').addEventListener('click', async () => {
  const key = $('ai-key').value.trim() || (await loadAiSettings()).key;
  const model = $('ai-model').value;
  if (!key) return aiStatus('Vul eerst een sleutel in.', true);
  aiStatus('Sleutel testen…');
  try {
    // Het model opvragen kost niets en bewijst dat de sleutel werkt en bij dit model mag.
    await createClient(key).models.retrieve(model);
    await chrome.storage.local.set({ aiKey: key, aiModel: model });
    $('ai-key').value = '';
    $('ai-key').placeholder = `Bewaard (eindigt op ${key.slice(-4)})`;
    aiStatus('De sleutel werkt en is bewaard. Analyses gebruiken nu het AI-model.');
  } catch (e) {
    aiStatus(`De sleutel is niet bewaard. ${explainError(e)}`, true);
  }
});

$('ai-remove').addEventListener('click', async () => {
  await chrome.storage.local.remove('aiKey');
  $('ai-key').value = '';
  $('ai-key').placeholder = 'sk-ant-…';
  aiStatus('De sleutel is verwijderd. Je krijgt weer de basisanalyse.');
});

// ---- Lidmaatschap ----

const membership = await getMembership();
$('member-off').hidden = !!CONFIG.serverUrl;
$('member-save').disabled = !CONFIG.serverUrl;
if (membership.token) $('member-token').placeholder = 'Bewaard';

function memberStatus(text) {
  $('member-status').hidden = !text;
  $('member-status').textContent = text;
}
$('member-save').addEventListener('click', async () => {
  const token = $('member-token').value.trim();
  if (!token) return memberStatus('Vul eerst je lidcode in.');
  await setMemberToken(token);
  $('member-token').value = '';
  $('member-token').placeholder = 'Bewaard';
  memberStatus('Je lidcode is bewaard. De server controleert hem bij je eerstvolgende analyse.');
});
$('member-remove').addEventListener('click', async () => {
  await setMemberToken('');
  $('member-token').placeholder = '';
  memberStatus('Je lidcode is verwijderd.');
});
