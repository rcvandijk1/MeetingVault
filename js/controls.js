export function buildUI(systems, eraManager, onEraSwitch) {
  const { weather, events, time, inhabitants } = systems;
  const panel = document.getElementById('controls');

  function renderEraButtons() {
    return eraManager.eraList.map(e =>
      `<button class="era-btn${e.id === eraManager.current?.id ? ' active' : ''}" data-era="${e.id}">${e.emoji} ${e.name}</button>`
    ).join('');
  }

  function renderWeatherButtons() {
    const opts = eraManager.current?.weatherOptions || [];
    return opts.map(w =>
      `<button class="w-btn${weather.current === w.id ? ' active' : ''}" data-w="${w.id}">${w.label}</button>`
    ).join('');
  }

  function renderDisasterButtons() {
    const dis = eraManager.current?.disasters || [];
    return dis.map(d => `<button class="d-btn" data-d="${d.id}">${d.label}</button>`).join('') +
      `<button class="d-btn clear-btn" id="clear-disaster">✖ Clear</button>`;
  }

  function renderSocialButtons() {
    const soc = eraManager.current?.socialEvents || [];
    return soc.map(s => `<button class="s-btn" data-s="${s.id}">${s.label}</button>`).join('');
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
    // Era switcher
    panel.querySelectorAll('.era-btn').forEach(btn => {
      btn.addEventListener('click', () => { onEraSwitch(btn.dataset.era); render(); });
    });

    // Speed
    const speedSlider = document.getElementById('speed');
    const speedVal    = document.getElementById('speed-val');
    speedSlider.value = time.speed;
    speedSlider.addEventListener('input', () => {
      const v = parseInt(speedSlider.value); time.setSpeed(v);
      speedVal.textContent = `${Math.round(v/60)}× (${v}m/s)`;
    });

    // Weather
    panel.querySelectorAll('.w-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        panel.querySelectorAll('.w-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        weather.setWeather(btn.dataset.w);
      });
    });

    // Disasters
    panel.querySelectorAll('.d-btn[data-d]').forEach(btn => {
      btn.addEventListener('click', () => {
        events.triggerDisaster(btn.dataset.d, systems.inhabitants());
        document.getElementById('event-label').textContent = events.eventLabel;
      });
    });
    document.getElementById('clear-disaster')?.addEventListener('click', () => {
      events.clearAll(systems.inhabitants());
      document.getElementById('event-label').textContent = '';
    });

    // Social events
    panel.querySelectorAll('.s-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        events.triggerSocialEvent(btn.dataset.s, systems.inhabitants());
        document.getElementById('event-label').textContent = events.eventLabel;
      });
    });
  }

  render();

  return {
    rerender: render,
    updateTime(ts) {
      const el = document.getElementById('time-display');
      if (el) el.textContent = ts.formattedTime;
    },
    updateTrades(barter) {
      const el = document.getElementById('trades');
      if (!el) return;
      const trades = barter.getLastTrades(3);
      const era = eraManager.current;
      el.innerHTML = trades.length
        ? `<div class="trades-title">${era?.economyLabel || 'Trade'} log:</div>` + trades.map(t =>
            `<div class="trade">${t.buyer} ↔ ${t.seller}: ${t.offer}→${t.want}</div>`
          ).join('')
        : `<div class="trade-empty">No ${(era?.economyLabel||'trade').toLowerCase()} yet</div>`;
    },
    showInhabitant(inh) {
      const p = document.getElementById('inhabitant-panel');
      if (!p) return;
      if (!inh) { p.style.display = 'none'; return; }
      p.style.display = 'block';
      const era = eraManager.current;
      const moodLabel = era?.invertMood ? 'Stress' : (era?.moodLabel || 'Mood');
      const moodValue = era?.invertMood ? Math.round((1 - inh.mood) * 100) : Math.round(inh.mood * 100);
      const moodColor = era?.invertMood
        ? `rgb(${Math.floor(inh.mood * 255)},${Math.floor((1-inh.mood) * 200)},50)`
        : inh.moodColor;
      const goods = Object.entries(inh.inventory).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}`).join(', ') || 'none';
      p.innerHTML = `
        <div class="inh-name">${inh.career.emoji} ${inh.name}</div>
        <div class="inh-role">${inh.career.name}${inh.isPlagued ? ' ☠️' : ''}${inh.isOnStrike ? ' ✊' : ''}</div>
        <div class="inh-state">${inh.stateLabel} ${inh.state.replace(/_/g,' ')}</div>
        <div class="inh-mood">${moodLabel}: <span style="color:${moodColor}">${moodValue}%</span></div>
        <div class="inh-inv">${era?.economyLabel||'Goods'}: ${goods}</div>
      `;
    }
  };
}
