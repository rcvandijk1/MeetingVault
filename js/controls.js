export function buildUI(weather, events, time, inhabitants, onSpeedChange) {
  const panel = document.getElementById('controls');

  panel.innerHTML = `
    <div class="section">
      <div class="section-title">⏱ Time</div>
      <div id="time-display" class="time-disp">Day 1  06:00</div>
      <div class="row">
        <span class="label">Speed</span>
        <input type="range" id="speed" min="10" max="600" value="60" step="10">
        <span id="speed-val">1×</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🌤 Weather</div>
      <div class="btn-grid">
        <button class="w-btn active" data-w="clear">☀️ Clear</button>
        <button class="w-btn" data-w="cloudy">☁️ Cloudy</button>
        <button class="w-btn" data-w="rain">🌧 Rain</button>
        <button class="w-btn" data-w="storm">⛈ Storm</button>
        <button class="w-btn" data-w="snow">❄️ Snow</button>
        <button class="w-btn" data-w="fog">🌫 Fog</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🔥 Disasters</div>
      <div class="btn-grid">
        <button class="d-btn" data-d="fire">🔥 Fire</button>
        <button class="d-btn" data-d="flood">🌊 Flood</button>
        <button class="d-btn" data-d="earthquake">⚡ Quake</button>
        <button class="d-btn" data-d="plague">☠️ Plague</button>
        <button class="d-btn clear-btn" id="clear-disaster">✖ Clear</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">🎉 Social Events</div>
      <div class="btn-grid">
        <button class="s-btn" data-s="festival">🎊 Festival</button>
        <button class="s-btn" data-s="market_day">🏪 Market Day</button>
        <button class="s-btn" data-s="wedding">💒 Wedding</button>
        <button class="s-btn" data-s="town_meeting">📣 Town Meeting</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">👥 Village</div>
      <div id="event-label" class="event-label"></div>
      <div id="trades" class="trades"></div>
    </div>

    <div id="inhabitant-panel" class="inh-panel" style="display:none"></div>
  `;

  // Speed control
  const speedSlider = document.getElementById('speed');
  const speedVal    = document.getElementById('speed-val');
  speedSlider.addEventListener('input', () => {
    const val = parseInt(speedSlider.value);
    time.setSpeed(val);
    speedVal.textContent = Math.round(val / 60) + '× (' + val + 'm/s)';
    onSpeedChange && onSpeedChange(val);
  });

  // Weather buttons
  document.querySelectorAll('.w-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.w-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      weather.setWeather(btn.dataset.w);
    });
  });

  // Disaster buttons
  document.querySelectorAll('.d-btn').forEach(btn => {
    if (!btn.dataset.d) return;
    btn.addEventListener('click', () => {
      events.triggerDisaster(btn.dataset.d, inhabitants);
      document.getElementById('event-label').textContent = events.eventLabel;
    });
  });
  document.getElementById('clear-disaster')?.addEventListener('click', () => {
    events.clearAll(inhabitants);
    document.getElementById('event-label').textContent = '';
  });

  // Social event buttons
  document.querySelectorAll('.s-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      events.triggerSocialEvent(btn.dataset.s, inhabitants);
      document.getElementById('event-label').textContent = events.eventLabel;
    });
  });

  return {
    updateTime(timeSystem) {
      const el = document.getElementById('time-display');
      if (el) el.textContent = timeSystem.formattedTime;
    },
    updateTrades(barter) {
      const el = document.getElementById('trades');
      if (!el) return;
      const trades = barter.getLastTrades(3);
      el.innerHTML = trades.length
        ? '<div class="trades-title">Recent trades:</div>' + trades.map(t =>
            `<div class="trade">${t.buyer} ↔ ${t.seller}: ${t.offer}→${t.want}</div>`
          ).join('')
        : '<div class="trade-empty">No trades yet</div>';
    },
    showInhabitant(inh) {
      const panel = document.getElementById('inhabitant-panel');
      if (!panel) return;
      if (!inh) { panel.style.display = 'none'; return; }
      panel.style.display = 'block';
      const goods = Object.entries(inh.inventory).filter(([,v]) => v > 0)
        .map(([k,v]) => `${k}:${v}`).join(', ') || 'none';
      panel.innerHTML = `
        <div class="inh-name">${inh.career.emoji} ${inh.name}</div>
        <div class="inh-role">${inh.career.name}</div>
        <div class="inh-state">${inh.stateLabel} ${inh.state.replace(/_/g,' ')}</div>
        <div class="inh-mood">Mood: <span style="color:${inh.moodColor}">${Math.round(inh.mood * 100)}%</span></div>
        <div class="inh-inv">Goods: ${goods}</div>
      `;
    }
  };
}
