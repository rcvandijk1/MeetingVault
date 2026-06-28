export function buildUI(systems, eraManager, onEraSwitch) {
  const { weather, events, time, inhabitants, isGenesis, chunkManager, maxGeneration } = systems;
  const panel = document.getElementById('controls');

  function renderEraButtons() {
    const btns = eraManager.eraList.map(e =>
      `<button class="era-btn${e.id===eraManager.current?.id&&!isGenesis()?' active':''}" data-era="${e.id}">${e.emoji} ${e.name}</button>`
    ).join('');
    const genActive = isGenesis() ? ' active' : '';
    return btns + `<button class="era-btn${genActive}" data-era="genesis" style="grid-column:span 2;border-color:#88ff88;color:#88ff88">🌱 Genesis</button>`;
  }

  function renderWeatherButtons() {
    if (isGenesis()) return '<span style="color:#666;font-size:10px">Set era to control weather</span>';
    const opts = eraManager.current?.weatherOptions || [];
    return opts.map(w =>
      `<button class="w-btn${weather.current===w.id?' active':''}" data-w="${w.id}">${w.label}</button>`
    ).join('');
  }

  function renderDisasterButtons() {
    const dis = eraManager.current?.disasters || [];
    return dis.map(d=>`<button class="d-btn" data-d="${d.id}">${d.label}</button>`).join('') +
      `<button class="d-btn clear-btn" id="clear-disaster">✖ Clear</button>`;
  }

  function renderSocialButtons() {
    const soc = eraManager.current?.socialEvents || [];
    return soc.map(s=>`<button class="s-btn" data-s="${s.id}">${s.label}</button>`).join('');
  }

  function _genesisStats() {
    const all   = inhabitants();
    const live  = all.filter(i=>i.lifeStage!=='dead');
    const adults = live.filter(i=>i.lifeStage==='adult'||i.lifeStage==='elder');
    const infants = live.filter(i=>i.lifeStage==='infant');
    const children = live.filter(i=>i.lifeStage==='child'||i.lifeStage==='teen');
    const pregnant = live.filter(i=>i.isPregnant).length;
    const chunks = chunkManager?.()?.discoveredCount ?? 1;
    const maxGen = maxGeneration?.() ?? 0;
    const oldest = live.length ? live.reduce((a,b)=>b.age>a.age?b:a) : { age:0, name:'—' };
    return { live, adults, infants, children, pregnant, chunks, maxGen, oldest };
  }

  function renderGenesisPanel() {
    if (!isGenesis()) return '';
    const { live, adults, infants, children, pregnant, chunks, maxGen, oldest } = _genesisStats();
    return `
      <div class="section">
        <div class="section-title">🌱 Genesis Population</div>
        <div id="genesis-live" style="font-size:11px;line-height:1.7;color:#ccc">
          <div>👥 Total: <b style="color:#fff">${live.length}</b></div>
          <div>👶 Infants: ${infants.length} &nbsp; 🧒 Children: ${children.length}</div>
          <div>🧑 Adults: ${adults.length} &nbsp; 🤰 Pregnant: ${pregnant}</div>
          <div>🧬 Max gen: <b style="color:#88ff88">${maxGen}</b></div>
          <div>🗺️ Chunks: <b style="color:#ffcc66">${chunks}</b></div>
          <div>👴 Oldest: <b style="color:#aaa">${oldest.name} (${Math.floor(oldest.age)}yr)</b></div>
        </div>
      </div>
    `;
  }

  function render() {
    panel.innerHTML = `
      <div class="section">
        <div class="section-title">🌍 Era</div>
        <div class="btn-grid era-grid">${renderEraButtons()}</div>
      </div>

      <div class="section">
        <div class="section-title">⏱ Time</div>
        <div id="time-display" class="time-disp"></div>
        <div class="row">
          <span class="label">Speed</span>
          <input type="range" id="speed" min="10" max="600" value="60" step="10">
          <span id="speed-val">1×</span>
        </div>
      </div>

      ${renderGenesisPanel()}

      <div class="section">
        <div class="section-title">🌤 Weather</div>
        <div class="btn-grid" id="weather-btns">${renderWeatherButtons()}</div>
      </div>

      <div class="section">
        <div class="section-title">🔥 Disasters</div>
        <div class="btn-grid" id="disaster-btns">${renderDisasterButtons()}</div>
      </div>

      <div class="section">
        <div class="section-title">🎉 Social Events</div>
        <div class="btn-grid" id="social-btns">${renderSocialButtons()}</div>
      </div>

      <div class="section">
        <div class="section-title">📋 Village Log</div>
        <div id="event-label" class="event-label"></div>
        <div id="trades" class="trades"></div>
      </div>

      <div id="inhabitant-panel" class="inh-panel" style="display:none"></div>
    `;
    _bindEvents();
  }

  function _bindEvents() {
    panel.querySelectorAll('.era-btn').forEach(btn => {
      btn.addEventListener('click', () => { onEraSwitch(btn.dataset.era); render(); });
    });

    const speedSlider = document.getElementById('speed');
    const speedVal    = document.getElementById('speed-val');
    speedSlider.value = time.speed;
    speedSlider.addEventListener('input', () => {
      const v=parseInt(speedSlider.value); time.setSpeed(v);
      speedVal.textContent=`${Math.round(v/60)}× (${v}m/s)`;
    });

    panel.querySelectorAll('.w-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.w-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        weather.setWeather(btn.dataset.w);
      });
    });

    panel.querySelectorAll('.d-btn[data-d]').forEach(btn => {
      btn.addEventListener('click', () => {
        events.triggerDisaster(btn.dataset.d, systems.inhabitants());
        document.getElementById('event-label').textContent=events.eventLabel;
      });
    });
    document.getElementById('clear-disaster')?.addEventListener('click', () => {
      events.clearAll(systems.inhabitants());
      document.getElementById('event-label').textContent='';
    });

    panel.querySelectorAll('.s-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        events.triggerSocialEvent(btn.dataset.s, systems.inhabitants());
        document.getElementById('event-label').textContent=events.eventLabel;
      });
    });
  }

  render();

  return {
    rerender: render,
    updateTime(ts) {
      const el=document.getElementById('time-display');
      if (el) el.textContent=ts.formattedTime;
    },
    updateTrades(barter) {
      const el=document.getElementById('trades');
      if (!el) return;
      const trades=barter.getLastTrades(3);
      const era=eraManager.current;
      el.innerHTML=trades.length
        ?`<div class="trades-title">${era?.economyLabel||'Trade'} log:</div>`+trades.map(t=>
            `<div class="trade">${t.buyer} ↔ ${t.seller}: ${t.offer}→${t.want}</div>`
          ).join('')
        :`<div class="trade-empty">No ${(era?.economyLabel||'trade').toLowerCase()} yet</div>`;
    },
    updateGenesis() {
      if (!isGenesis()) return;
      const el = document.getElementById('genesis-live');
      if (!el) return;
      const { live, adults, infants, children, pregnant, chunks, maxGen, oldest } = _genesisStats();
      el.innerHTML =
        `<div>👥 Total: <b style="color:#fff">${live.length}</b></div>` +
        `<div>👶 Infants: ${infants.length} &nbsp; 🧒 Children: ${children.length}</div>` +
        `<div>🧑 Adults: ${adults.length} &nbsp; 🤰 Pregnant: ${pregnant}</div>` +
        `<div>🧬 Max gen: <b style="color:#88ff88">${maxGen}</b></div>` +
        `<div>🗺️ Chunks: <b style="color:#ffcc66">${chunks}</b></div>` +
        `<div>👴 Oldest: <b style="color:#aaa">${oldest.name} (${Math.floor(oldest.age)}yr)</b></div>`;
    },
    showInhabitant(inh) {
      const p=document.getElementById('inhabitant-panel');
      if (!p) return;
      if (!inh) { p.style.display='none'; return; }
      p.style.display='block';
      const era=eraManager.current;
      const moodLabel=era?.invertMood?'Stress':(era?.moodLabel||'Mood');
      const moodValue=era?.invertMood?Math.round((1-inh.mood)*100):Math.round(inh.mood*100);
      const moodColor=era?.invertMood
        ?`rgb(${Math.floor(inh.mood*255)},${Math.floor((1-inh.mood)*200)},50)`
        :inh.moodColor;
      const goods=Object.entries(inh.inventory||{}).filter(([,v])=>v>0).map(([k,v])=>`${k}:${v}`).join(', ')||'none';

      // Genesis extras
      let genesisInfo = '';
      if (inh.dna) {
        const stage = inh.lifeStage || 'adult';
        const stageLabels = { infant:'👶 Infant', child:'🧒 Child', teen:'🧑 Teen', adult:'🧑 Adult', elder:'👴 Elder', dead:'💀 Dead' };
        const spouse = inh.spouse?.lifeStage !== 'dead' ? (inh.spouse?.name || '—') : '—';
        genesisInfo = `
          <div class="inh-role" style="color:#88ff88">${stageLabels[stage]} · Gen ${inh.generation} · Age ${Math.floor(inh.age)}yr</div>
          <div style="font-size:10px;color:#aaaacc">
            ${inh.gender==='female'?'♀':'♂'} · Spouse: ${spouse}${inh.isPregnant?' · 🤰':''}<br>
            Str:${Math.round(inh.dna.strength*10)} Spd:${Math.round(inh.dna.speed*10)} Int:${Math.round(inh.dna.intelligence*10)}<br>
            ❄️:${Math.round(inh.dna.coldAdapt*10)} ☀️:${Math.round(inh.dna.heatAdapt*10)} 🏔️:${Math.round(inh.dna.altAdapt*10)}
          </div>
        `;
      }

      p.innerHTML=`
        <div class="inh-name">${inh.career.emoji} ${inh.name}</div>
        <div class="inh-role">${inh.career.name}${inh.isPlagued?' ☠️':''}${inh.isOnStrike?' ✊':''}</div>
        ${genesisInfo}
        <div class="inh-state">${inh.stateLabel} ${inh.state.replace(/_/g,' ')}</div>
        <div class="inh-mood">${moodLabel}: <span style="color:${moodColor}">${moodValue}%</span></div>
        <div class="inh-inv">${era?.economyLabel||'Goods'}: ${goods}</div>
      `;
    }
  };
}
