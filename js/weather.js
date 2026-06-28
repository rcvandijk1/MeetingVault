import * as THREE from 'three';

export class WeatherSystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.current = 'clear';
    this.particles = null;
    this.windX = 0;
    this.windZ = 0;
    this._time = 0;
    this._lightning = null;
    this._lightningTimer = 0;
    this.fog = scene.fog;
  }

  setWeather(type) {
    this.current = type;
    this._clearParticles();
    this._setupParticles(type);
    this._applyFog(type);
    this._applyWind(type);
  }

  _applyFog(type) {
    const scene = this.scene;
    switch (type) {
      case 'clear':   scene.fog = new THREE.Fog(0x87ceeb, 80, 200); break;
      case 'cloudy':  scene.fog = new THREE.Fog(0xaabbcc, 60, 160); break;
      case 'rain':    scene.fog = new THREE.Fog(0x7a8a99, 40, 120); break;
      case 'storm':   scene.fog = new THREE.Fog(0x445566, 20, 80);  break;
      case 'snow':    scene.fog = new THREE.Fog(0xddeeff, 30, 100); break;
      case 'fog':     scene.fog = new THREE.Fog(0xccddcc, 5, 40);   break;
    }
    this.fog = scene.fog;
  }

  _applyWind(type) {
    this.windX = 0; this.windZ = 0;
    if (type === 'storm') { this.windX = 0.08; this.windZ = 0.04; }
    if (type === 'rain')  { this.windX = 0.02; }
    if (type === 'snow')  { this.windX = 0.01; this.windZ = 0.005; }
  }

  _clearParticles() {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      this.particles.material.dispose();
      this.particles = null;
    }
    if (this._lightning) {
      this.scene.remove(this._lightning);
      this._lightning = null;
    }
  }

  _setupParticles(type) {
    if (!['rain', 'storm', 'snow'].includes(type)) return;
    const count = type === 'storm' ? 8000 : type === 'rain' ? 4000 : 3000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 50;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const color = type === 'snow' ? 0xffffff : 0x99aabb;
    const size  = type === 'snow' ? 0.18 : 0.06;
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.7, depthWrite: false });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);

    if (type === 'storm') {
      const lGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 40, 0), new THREE.Vector3(5, 0, -5)
      ]);
      const lMat = new THREE.LineBasicMaterial({ color: 0xffffaa });
      this._lightning = new THREE.Line(lGeo, lMat);
      this._lightning.visible = false;
      this.scene.add(this._lightning);
    }
  }

  update(dt, timeSystem) {
    this._time += dt;
    if (!this.particles) return;

    const pos = this.particles.geometry.attributes.position.array;
    const isSnow = this.current === 'snow';
    const fallSpeed = this.current === 'storm' ? 25 : this.current === 'rain' ? 18 : 4;

    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3]     += this.windX;
      pos[i * 3 + 1] -= fallSpeed * dt;
      pos[i * 3 + 2] += this.windZ;
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3]     = (Math.random() - 0.5) * 120;
        pos[i * 3 + 1] = 50;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;

    // Lightning
    if (this._lightning) {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightning.visible = true;
        const p = this._lightning.geometry.attributes.position.array;
        p[0] = (Math.random() - 0.5) * 80; p[2] = (Math.random() - 0.5) * 80;
        p[3] = p[0] + (Math.random() - 0.5) * 10; p[5] = p[2] + (Math.random() - 0.5) * 10;
        this._lightning.geometry.attributes.position.needsUpdate = true;
        this._lightningTimer = 2 + Math.random() * 5;
      } else if (this._lightningTimer < 0.05) {
        this._lightning.visible = false;
      }
    }
  }

  get speedMultiplier() {
    switch (this.current) {
      case 'storm': return 0.3;
      case 'rain':  return 0.65;
      case 'snow':  return 0.5;
      default:      return 1.0;
    }
  }

  get shouldSeekShelter() {
    return ['storm', 'rain'].includes(this.current);
  }
}
