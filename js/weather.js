import * as THREE from 'three';

const PARTICLE_COLORS = {
  rain: 0x99aabb, snow: 0xffffff, ash: 0xaa9966,
  spark: 0x88aaff, solar: 0xff9933, dust: 0xaa44cc, smog: 0xaaaa55,
};
const PARTICLE_SIZES = {
  rain: 0.06, snow: 0.18, ash: 0.12, spark: 0.08, solar: 0.1, dust: 0.14, smog: 0.1,
};
const PARTICLE_COUNTS = {
  rain: 4000, snow: 3000, ash: 2500, spark: 5000, solar: 1500, dust: 2000, smog: 2000,
};

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.current = 'clear';
    this.currentConfig = null;
    this.particles = null;
    this._lightning = null;
    this._lightningTimer = 0;
    this._time = 0;
  }

  loadEraWeather(weatherOptions) {
    this._options = Object.fromEntries(weatherOptions.map(w => [w.id, w]));
    this.setWeather(weatherOptions[0].id);
  }

  setWeather(id) {
    const cfg = this._options?.[id];
    if (!cfg) return;
    this.current = id;
    this.currentConfig = cfg;
    this._clearParticles();
    this._setupParticles(cfg);
    this._applyFog(cfg);
  }

  _applyFog(cfg) {
    this.scene.fog = new THREE.Fog(cfg.fogColor, cfg.fogNear, cfg.fogFar);
  }

  _clearParticles() {
    if (this.particles) { this.scene.remove(this.particles); this.particles.geometry.dispose(); this.particles.material.dispose(); this.particles = null; }
    if (this._lightning) { this.scene.remove(this._lightning); this._lightning = null; }
  }

  _setupParticles(cfg) {
    if (!cfg.particleType) return;
    const type = cfg.particleType;
    const count = PARTICLE_COUNTS[type] || 3000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3] = (Math.random()-0.5)*120; pos[i*3+1] = Math.random()*50; pos[i*3+2] = (Math.random()-0.5)*120;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: PARTICLE_COLORS[type] || 0x99aabb, size: PARTICLE_SIZES[type] || 0.08, transparent: true, opacity: 0.75, depthWrite: false });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);

    if (cfg.lightning) {
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,40,0), new THREE.Vector3(5,0,-5)]);
      this._lightning = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffaa }));
      this._lightning.visible = false;
      this.scene.add(this._lightning);
    }
  }

  update(dt) {
    this._time += dt;
    if (!this.particles || !this.currentConfig) return;
    const cfg = this.currentConfig;
    const type = cfg.particleType;
    const windX = cfg.windX || 0, windZ = cfg.windZ || 0;

    const fallSpeeds = { rain: 18, snow: 4, ash: 6, spark: 8, solar: 12, dust: 3, smog: 1 };
    const fallSpeed = fallSpeeds[type] || 8;

    const pos = this.particles.geometry.attributes.position.array;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i*3]   += windX + (type === 'spark' ? (Math.random()-0.5)*0.05 : 0);
      pos[i*3+1] -= fallSpeed * dt;
      pos[i*3+2] += windZ;
      if (type === 'solar') { pos[i*3+1] += Math.sin(this._time * 2 + i) * 0.02; }
      if (type === 'dust')  { pos[i*3] += Math.sin(this._time + i * 0.1) * 0.02; }
      if (pos[i*3+1] < 0) { pos[i*3]=(Math.random()-0.5)*120; pos[i*3+1]=50; pos[i*3+2]=(Math.random()-0.5)*120; }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;

    if (type === 'smog') { this.particles.material.opacity = 0.5 + 0.2 * Math.sin(this._time * 0.5); }
    if (type === 'dust') { this.particles.material.color.setHSL(0.8 + Math.sin(this._time*0.3)*0.05, 0.6, 0.5); }

    // Lightning
    if (this._lightning) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightning.visible = true;
        const p = this._lightning.geometry.attributes.position.array;
        p[0]=(Math.random()-0.5)*80; p[2]=(Math.random()-0.5)*80;
        p[3]=p[0]+(Math.random()-0.5)*10; p[5]=p[2]+(Math.random()-0.5)*10;
        this._lightning.geometry.attributes.position.needsUpdate = true;
        this._lightningTimer = 2 + Math.random() * 5;
      } else if (this._lightningTimer < 0.05) { this._lightning.visible = false; }
    }
  }

  get speedMultiplier() { return this.currentConfig?.speedMult ?? 1.0; }
  get shouldSeekShelter() { return this.currentConfig?.shelter ?? false; }
  get moodPenalty()       { return this.currentConfig?.moodPenalty ?? 0; }
  get gravityMode()       { return this.currentConfig?.gravityMode ?? false; }
}
