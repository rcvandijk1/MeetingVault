import * as THREE from 'three';
import { WAYPOINTS } from './pathfinding.js';

export class EventSystem {
  constructor(scene) {
    this.scene = scene;
    this.activeEvent = null;
    this.activeDuration = 0;
    this.fireObjects = [];
    this.floodPlane = null;
    this.floodLevel = 0;
    this._shakeTime = 0;
    this._originalCamPos = null;
    this.camera = null;
    this.onEventEnd = null;
    this.celebrationParticles = null;
  }

  setCamera(cam) { this.camera = cam; }

  triggerDisaster(type, inhabitants) {
    this._clearEvent();
    this.activeEvent = type;
    this.activeDuration = 0;

    switch (type) {
      case 'fire':       this._startFire(inhabitants); break;
      case 'flood':      this._startFlood(); break;
      case 'earthquake': this._startEarthquake(inhabitants); break;
      case 'plague':     this._startPlague(inhabitants); break;
    }
  }

  triggerSocialEvent(type, inhabitants) {
    this._clearEvent();
    this.activeEvent = type;
    this.activeDuration = 0;

    switch (type) {
      case 'festival':    this._startFestival(inhabitants); break;
      case 'market_day':  this._startMarketDay(inhabitants); break;
      case 'wedding':     this._startWedding(inhabitants); break;
      case 'town_meeting':this._startTownMeeting(inhabitants); break;
    }
  }

  _startFire(inhabitants) {
    // Spawn fire particles near market
    const positions = [
      { x: 5, z: -5 }, { x: -8, z: 3 }, { x: 12, z: 8 }
    ];
    for (const p of positions) {
      this._spawnFire(p.x, 0, p.z);
    }
    inhabitants.forEach(inh => {
      inh.setOverride('fleeing');
      inh.fleeTarget = { x: inh.pos.x + (Math.random() - 0.5) * 30, z: inh.pos.z + (Math.random() - 0.5) * 30 };
      inh.mood = Math.max(0, inh.mood - 0.3);
    });
  }

  _spawnFire(x, y, z) {
    const count = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = x + (Math.random() - 0.5) * 2;
      pos[i * 3 + 1] = y + Math.random() * 3;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xff4400, size: 0.3, transparent: true, opacity: 0.9,
      vertexColors: false, depthWrite: false
    });
    const fire = new THREE.Points(geo, mat);
    fire._type = 'fire';
    fire._baseX = x; fire._baseZ = z;
    this.scene.add(fire);
    this.fireObjects.push(fire);
  }

  _startFlood(inhabitants) {
    const geo = new THREE.PlaneGeometry(300, 300);
    const mat = new THREE.MeshPhongMaterial({
      color: 0x2255aa, transparent: true, opacity: 0.6
    });
    this.floodPlane = new THREE.Mesh(geo, mat);
    this.floodPlane.rotation.x = -Math.PI / 2;
    this.floodPlane.position.y = -5;
    this.scene.add(this.floodPlane);
  }

  _startEarthquake(inhabitants) {
    this._shakeTime = 8;
    inhabitants.forEach(inh => {
      inh.setOverride('cowering');
      inh.mood = Math.max(0, inh.mood - 0.2);
    });
  }

  _startPlague(inhabitants) {
    const affected = inhabitants.filter(() => Math.random() < 0.4);
    affected.forEach(inh => {
      inh.isPlagued = true;
      inh.mood = Math.max(0, inh.mood - 0.2);
      if (inh.body) {
        inh.body.traverse(c => {
          if (c.material) c.material = c.material.clone();
          if (c.material) c.material.color.setHex(0x88aa44);
        });
      }
    });
  }

  _startFestival(inhabitants) {
    inhabitants.forEach(inh => {
      inh.setOverride('celebrating');
      inh.mood = Math.min(1, inh.mood + 0.3);
      inh.socialTarget = WAYPOINTS.market;
    });
    this._spawnCelebration();
  }

  _spawnCelebration() {
    const count = 200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
      colors[i * 3] = Math.random();
      colors[i * 3 + 1] = Math.random();
      colors[i * 3 + 2] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.25, vertexColors: true, depthWrite: false });
    this.celebrationParticles = new THREE.Points(geo, mat);
    this.scene.add(this.celebrationParticles);
  }

  _startMarketDay(inhabitants) {
    inhabitants.forEach(inh => {
      inh.setOverride('bartering');
      inh.socialTarget = WAYPOINTS.market;
      inh.mood = Math.min(1, inh.mood + 0.15);
    });
  }

  _startWedding(inhabitants) {
    const couple = inhabitants.slice(0, 2);
    const guests = inhabitants.slice(2);
    couple.forEach(inh => {
      inh.setOverride('celebrating');
      inh.socialTarget = WAYPOINTS.market;
      inh.mood = 1;
    });
    guests.forEach(inh => {
      inh.setOverride('socializing');
      inh.socialTarget = WAYPOINTS.market;
      inh.mood = Math.min(1, inh.mood + 0.2);
    });
  }

  _startTownMeeting(inhabitants) {
    inhabitants.forEach(inh => {
      inh.setOverride('meeting');
      inh.socialTarget = WAYPOINTS.market;
    });
  }

  _clearEvent() {
    this.fireObjects.forEach(f => {
      this.scene.remove(f);
      f.geometry.dispose();
      f.material.dispose();
    });
    this.fireObjects = [];

    if (this.floodPlane) {
      this.scene.remove(this.floodPlane);
      this.floodPlane.geometry.dispose();
      this.floodPlane.material.dispose();
      this.floodPlane = null;
      this.floodLevel = 0;
    }
    this._shakeTime = 0;
    if (this.celebrationParticles) {
      this.scene.remove(this.celebrationParticles);
      this.celebrationParticles.geometry.dispose();
      this.celebrationParticles.material.dispose();
      this.celebrationParticles = null;
    }
  }

  clearAll(inhabitants) {
    this._clearEvent();
    this.activeEvent = null;
    inhabitants.forEach(inh => {
      inh.clearOverride();
      inh.isPlagued = false;
    });
  }

  update(dt, inhabitants) {
    if (!this.activeEvent) return;
    this.activeDuration += dt;

    // Fire animation
    this.fireObjects.forEach(fire => {
      const pos = fire.geometry.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[i * 3 + 1] += (Math.random() - 0.3) * 0.15;
        if (pos[i * 3 + 1] > 4) pos[i * 3 + 1] = 0;
        pos[i * 3] = fire._baseX + (Math.random() - 0.5) * 2;
        pos[i * 3 + 2] = fire._baseZ + (Math.random() - 0.5) * 2;
      }
      fire.geometry.attributes.position.needsUpdate = true;
      fire.material.color.setHSL(0.06 + Math.random() * 0.03, 1, 0.5 + Math.random() * 0.1);
    });

    // Flood rise
    if (this.activeEvent === 'flood' && this.floodPlane) {
      this.floodLevel = Math.min(3, this.floodLevel + dt * 0.3);
      this.floodPlane.position.y = -5 + this.floodLevel;
    }

    // Earthquake shake
    if (this._shakeTime > 0) {
      this._shakeTime -= dt;
      if (this.camera) {
        this.camera.position.x += (Math.random() - 0.5) * 0.3;
        this.camera.position.y += (Math.random() - 0.5) * 0.2;
      }
      if (this._shakeTime <= 0 && inhabitants) {
        inhabitants.forEach(inh => inh.clearOverride());
      }
    }

    // Celebration confetti
    if (this.celebrationParticles) {
      const pos = this.celebrationParticles.geometry.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[i * 3 + 1] -= 1.5 * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3] = (Math.random() - 0.5) * 30;
          pos[i * 3 + 1] = 15;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
        }
      }
      this.celebrationParticles.geometry.attributes.position.needsUpdate = true;
    }

    // Auto-clear disasters after 60s
    if (['fire','earthquake','plague'].includes(this.activeEvent) && this.activeDuration > 60) {
      this.clearAll(inhabitants);
    }
  }

  get eventLabel() {
    const labels = {
      fire: '🔥 Fire!', flood: '🌊 Flood!', earthquake: '⚡ Earthquake!', plague: '☠️ Plague',
      festival: '🎉 Festival!', market_day: '🏪 Market Day', wedding: '💒 Wedding!', town_meeting: '📣 Town Meeting'
    };
    return this.activeEvent ? labels[this.activeEvent] || this.activeEvent : '';
  }
}
