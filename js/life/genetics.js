export class DNA {
  constructor(traits = {}) {
    this.skinTone      = clamp01(traits.skinTone      ?? 0.5);
    this.hairColor     = traits.hairColor     ?? 0x3d2b1f;
    this.height        = clampR(traits.height  ?? 1.0, 0.75, 1.25);
    this.strength      = clamp01(traits.strength      ?? 0.5);
    this.speed         = clamp01(traits.speed         ?? 0.5);
    this.intelligence  = clamp01(traits.intelligence  ?? 0.5);
    this.coldAdapt     = clamp01(traits.coldAdapt     ?? 0.0);
    this.heatAdapt     = clamp01(traits.heatAdapt     ?? 0.0);
    this.altAdapt      = clamp01(traits.altAdapt      ?? 0.0);
    this.aquaAdapt     = clamp01(traits.aquaAdapt     ?? 0.0);
    this.fertility     = clamp01(traits.fertility     ?? 0.65);
  }

  static combine(a, b) {
    const m  = (x, y) => clamp01(avg(x, y) + (Math.random() - 0.5) * 0.12);
    const mh = (x, y) => clampR(avg(x, y)  + (Math.random() - 0.5) * 0.10, 0.75, 1.25);
    return new DNA({
      skinTone:     m(a.skinTone,     b.skinTone),
      hairColor:    Math.random() < 0.5 ? a.hairColor : b.hairColor,
      height:       mh(a.height,      b.height),
      strength:     m(a.strength,     b.strength),
      speed:        m(a.speed,        b.speed),
      intelligence: m(a.intelligence, b.intelligence),
      coldAdapt:    m(a.coldAdapt,    b.coldAdapt),
      heatAdapt:    m(a.heatAdapt,    b.heatAdapt),
      altAdapt:     m(a.altAdapt,     b.altAdapt),
      aquaAdapt:    m(a.aquaAdapt,    b.aquaAdapt),
      fertility:    m(a.fertility,    b.fertility),
    });
  }

  // Slowly adapt to biome pressure each tick
  adaptTo(pressure) {
    const r = 0.00015;
    if (pressure.cold) this.coldAdapt = Math.min(1, this.coldAdapt + r);
    if (pressure.heat) this.heatAdapt = Math.min(1, this.heatAdapt + r);
    if (pressure.alt)  this.altAdapt  = Math.min(1, this.altAdapt  + r);
    if (pressure.aqua) this.aquaAdapt = Math.min(1, this.aquaAdapt + r);
    if (pressure.skinDrift != null) {
      this.skinTone = clamp01(this.skinTone + (pressure.skinDrift - this.skinTone) * 0.00008);
    }
  }

  // Survival penalty when mismatched to environment
  survivalPenalty(pressure) {
    let p = 0;
    if (pressure.cold) p += (1 - this.coldAdapt) * 0.0008;
    if (pressure.heat) p += (1 - this.heatAdapt) * 0.0008;
    if (pressure.alt)  p += (1 - this.altAdapt)  * 0.0005;
    if (pressure.aqua) p += (1 - this.aquaAdapt)  * 0.0004;
    return p;
  }

  get skinHex() {
    const t = this.skinTone;
    return (Math.floor(lerp(0xff, 0x5c, t)) << 16) |
           (Math.floor(lerp(0xd4, 0x33, t)) <<  8) |
            Math.floor(lerp(0xa8, 0x17, t));
  }
}

const avg    = (a, b)      => (a + b) / 2;
const clamp01 = v          => Math.max(0, Math.min(1, v));
const clampR  = (v, lo, hi)=> Math.max(lo, Math.min(hi, v));
const lerp    = (a, b, t)  => a + (b - a) * t;
