export class TimeSystem {
  constructor() {
    this.hour = 6;       // start at 6am
    this.minute = 0;
    this.day = 1;
    this.speed = 60;     // 1 real second = 1 game minute
    this._elapsed = 0;
    this.listeners = [];
    this.paused = false;
  }

  setSpeed(s) { this.speed = s; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }

  update(dt) {
    if (this.paused) return;
    this._elapsed += dt * this.speed;
    while (this._elapsed >= 60) {
      this._elapsed -= 60;
      this._tick();
    }
  }

  _tick() {
    this.minute++;
    if (this.minute >= 60) {
      this.minute = 0;
      this.hour++;
      this._emit('hour', this.hour);
      if (this.hour >= 24) {
        this.hour = 0;
        this.day++;
        this._emit('day', this.day);
      }
    }
  }

  on(event, fn) { this.listeners.push({ event, fn }); }
  _emit(event, val) { this.listeners.forEach(l => l.event === event && l.fn(val)); }

  get totalMinutes() { return this.hour * 60 + this.minute; }
  get isDay() { return this.hour >= 6 && this.hour < 20; }
  get isNight() { return !this.isDay; }

  // Sun angle 0=sunrise(6am), PI=sunset(18h), wrapped for night
  get sunAngle() {
    const t = ((this.hour + this.minute / 60) - 6) / 24;
    return t * Math.PI * 2;
  }

  get skyColor() {
    const h = this.hour + this.minute / 60;
    if (h < 5 || h >= 22) return { r: 0.01, g: 0.01, b: 0.08 };
    if (h < 6) { const t = h - 5; return { r: 0.2 * t, g: 0.1 * t, b: 0.2 + 0.3 * t }; }
    if (h < 7) { const t = h - 6; return { r: 0.9 - 0.3 * t, g: 0.4 + 0.3 * t, b: 0.5 + 0.2 * t }; }
    if (h < 18) return { r: 0.53, g: 0.81, b: 0.98 };
    if (h < 19) { const t = h - 18; return { r: 0.53 + 0.4 * t, g: 0.81 - 0.4 * t, b: 0.98 - 0.5 * t }; }
    if (h < 20) { const t = h - 19; return { r: 0.93 - 0.7 * t, g: 0.41 - 0.3 * t, b: 0.48 - 0.3 * t }; }
    if (h < 21) { const t = h - 20; return { r: 0.23 - 0.2 * t, g: 0.11 - 0.1 * t, b: 0.18 }; }
    return { r: 0.03, g: 0.01, b: 0.1 };
  }

  get formattedTime() {
    const h = String(this.hour).padStart(2, '0');
    const m = String(this.minute).padStart(2, '0');
    return `Day ${this.day}  ${h}:${m}`;
  }
}
