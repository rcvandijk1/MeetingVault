import * as THREE from 'three';

export class EventSystem {
  constructor(scene) {
    this.scene = scene;
    this.activeEvent = null;
    this._effects = [];
    this._shakeTime = 0;
    this._floodLevel = 0;
    this._floodPlane = null;
    this._celebParticles = null;
    this._solarFlash = 0;
    this.camera = null;
    this._eraDisasters = {};
    this._eraSocialEvents = {};
  }

  setCamera(cam) { this.camera = cam; }

  loadEra(eraConfig) {
    this._eraDisasters    = Object.fromEntries(eraConfig.disasters.map(d => [d.id, d]));
    this._eraSocialEvents = Object.fromEntries(eraConfig.socialEvents.map(e => [e.id, e]));
    this._gatherWP = eraConfig.gatherWaypoint;
    this._waypoints = eraConfig.waypoints;
  }

  triggerDisaster(id, inhabitants) {
    this._clearEffects();
    this.activeEvent = id;
    const def = this._eraDisasters[id];
    if (!def) return;

    switch (id) {
      // Universal fire
      case 'fire': case 'factory_fire':
        this._spawnFireCluster(inhabitants); break;
      case 'flood':
        this._spawnFlood(); break;
      case 'earthquake':
        this._shakeTime = 8;
        inhabitants.forEach(i => { i.setOverride('cowering'); i.mood = Math.max(0, i.mood - 0.2); }); break;
      case 'plague':
        this._applyPlague(inhabitants, 0x88aa44); break;
      // Stone Age
      case 'predator':
        inhabitants.forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); i.mood -= 0.3; }); break;
      case 'volcano':
        this._spawnAshCloud(); inhabitants.forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); }); break;
      case 'meteor':
        this._spawnMeteors(); inhabitants.forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); }); break;
      case 'cave_collapse':
        this._shakeTime = 5; inhabitants.forEach(i => { i.setOverride('cowering'); }); break;
      // Modern
      case 'strike':
        inhabitants.filter(i => i.career.id !== 'police').forEach(i => { i.isOnStrike = true; i.clearOverride(); i.mood = Math.max(0, i.mood - 0.2); }); break;
      case 'power_outage':
        inhabitants.forEach(i => { i.setOverride('cowering'); }); break;
      case 'traffic_jam':
        inhabitants.forEach(i => { if (i.career.id === 'delivery_driver') i.setOverride('cowering'); });
        break;
      case 'market_crash':
        inhabitants.forEach(i => { i.mood = Math.max(0, i.mood - 0.4); }); break;
      // Futuristic
      case 'solar_flare':
        this._solarFlash = 1.5; inhabitants.forEach(i => { i.setOverride('cowering'); i.mood -= 0.2; }); break;
      case 'alien_invasion':
        inhabitants.forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); i.mood -= 0.3; }); break;
      case 'ai_rebellion':
        inhabitants.filter(i => i.career.id === 'android').forEach(i => {
          i.body.traverse(c => { if (c.material) { c.material = c.material.clone(); c.material.color.setHex(0xff2222); } });
          i.setOverride('fleeing');
        });
        inhabitants.filter(i => i.career.id !== 'android').forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); }); break;
      case 'quantum_glitch':
        inhabitants.forEach(i => { i.setOverride('cowering'); i.pos.x += (Math.random()-0.5)*20; i.pos.z += (Math.random()-0.5)*20; }); break;
    }
  }

  triggerSocialEvent(id, inhabitants) {
    this._clearEffects();
    this.activeEvent = id;
    const def = this._eraSocialEvents[id];
    if (!def) return;

    const gather = def.gather;
    const gatherPos = this._waypoints?.[gather];
    const state = def.state || 'celebrating';

    inhabitants.forEach(i => {
      i.setOverride(state);
      if (gatherPos) i.socialTarget = gatherPos;
      i.mood = Math.min(1, i.mood + 0.2);
    });

    if (['celebrating', 'festival', 'tribal_dance', 'tribal_hunt', 'holo_concert', 'space_launch'].some(s => id.includes(s) || state === 'celebrating')) {
      this._spawnCelebration(gatherPos);
    }
    if (id === 'space_launch') this._spawnRocketLaunch();
    if (id === 'solar_flare_event') this._solarFlash = 0.5;
  }

  _setFleeAway(i) {
    i.fleeTarget = { x: i.pos.x + (Math.random()-0.5)*50, z: i.pos.z + (Math.random()-0.5)*50 };
  }

  _spawnFireCluster(inhabitants) {
    const spots = [[5,-5],[-8,3],[12,8]];
    for (const [x,z] of spots) this._addFire(x, z);
    inhabitants.forEach(i => { i.setOverride('fleeing'); this._setFleeAway(i); i.mood -= 0.3; });
  }

  _addFire(x, z) {
    const count = 100;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3]=(Math.random()-0.5)*2+x; pos[i*3+1]=Math.random()*3; pos[i*3+2]=(Math.random()-0.5)*2+z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const fire = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff4400, size: 0.3, transparent: true, opacity: 0.9, depthWrite: false }));
    fire._baseX = x; fire._baseZ = z; fire._isFire = true;
    this.scene.add(fire);
    this._effects.push(fire);
    const l = new THREE.PointLight(0xff4400, 2, 12); l.position.set(x, 2, z); this.scene.add(l);
    this._effects.push(l);
  }

  _spawnFlood() {
    this._floodLevel = 0;
    this._floodPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshPhongMaterial({ color: 0x2255aa, transparent: true, opacity: 0.6 })
    );
    this._floodPlane.rotation.x = -Math.PI/2; this._floodPlane.position.y = -5;
    this.scene.add(this._floodPlane);
  }

  _applyPlague(inhabitants, color) {
    inhabitants.filter(() => Math.random() < 0.4).forEach(i => {
      i.isPlagued = true; i.mood -= 0.2;
      i.body.traverse(c => { if (c.material) { c.material = c.material.clone(); c.material.color.setHex(0x88aa44); } });
    });
  }

  _spawnAshCloud() {
    const count = 3000;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3]=(Math.random()-0.5)*140; pos[i*3+1]=Math.random()*45; pos[i*3+2]=(Math.random()-0.5)*140;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaa8855, size: 0.2, transparent: true, opacity: 0.6, depthWrite: false }));
    this.scene.add(cloud); this._effects.push(cloud);
  }

  _spawnMeteors() {
    for (let m = 0; m < 8; m++) {
      const count = 30;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const x0 = (Math.random()-0.5)*80, z0 = (Math.random()-0.5)*80;
      for (let i = 0; i < count; i++) {
        pos[i*3]=x0+(Math.random()-0.5)*3; pos[i*3+1]=40-i*(40/count); pos[i*3+2]=z0+(Math.random()-0.5)*3;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const meteor = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff8833, size: 0.25, depthWrite: false }));
      meteor._meteorX = x0; meteor._meteorZ = z0; meteor._isMeteor = true;
      this.scene.add(meteor); this._effects.push(meteor);
    }
  }

  _spawnCelebration(pos) {
    const count = 250;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cx = pos?.x || 0, cz = pos?.z || 0;
    for (let i = 0; i < count; i++) {
      positions[i*3]=(Math.random()-0.5)*30+cx; positions[i*3+1]=Math.random()*16; positions[i*3+2]=(Math.random()-0.5)*30+cz;
      colors[i*3]=Math.random(); colors[i*3+1]=Math.random(); colors[i*3+2]=Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._celebParticles = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.25, vertexColors: true, depthWrite: false }));
    this.scene.add(this._celebParticles);
  }

  _spawnRocketLaunch() {
    const count = 500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i*3]=(Math.random()-0.5)*4; pos[i*3+1]=1+Math.random()*25; pos[i*3+2]=(Math.random()-0.5)*4-38;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const exhaust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff6600, size: 0.2, transparent: true, opacity: 0.8, depthWrite: false }));
    exhaust._isExhaust = true;
    this.scene.add(exhaust); this._effects.push(exhaust);
  }

  _clearEffects() {
    for (const e of this._effects) { this.scene.remove(e); if (e.geometry) e.geometry.dispose(); if (e.material) e.material.dispose(); }
    this._effects = [];
    if (this._floodPlane) { this.scene.remove(this._floodPlane); this._floodPlane.geometry.dispose(); this._floodPlane.material.dispose(); this._floodPlane = null; }
    if (this._celebParticles) { this.scene.remove(this._celebParticles); this._celebParticles.geometry.dispose(); this._celebParticles.material.dispose(); this._celebParticles = null; }
    this._floodLevel = 0; this._shakeTime = 0; this._solarFlash = 0;
  }

  clearAll(inhabitants) {
    this._clearEffects();
    this.activeEvent = null;
    inhabitants.forEach(i => {
      i.clearOverride(); i.isOnStrike = false; i.isPlagued = false;
      i.body.traverse(c => { if (c.material?.color) { /* restore not easy without original — live with it */ } });
    });
  }

  update(dt, inhabitants) {
    if (!this.activeEvent) return;

    // Fire animation
    for (const e of this._effects) {
      if (e._isFire) {
        const p = e.geometry.attributes.position.array;
        for (let i = 0; i < p.length/3; i++) {
          p[i*3+1] += (Math.random()-0.3)*0.12;
          if (p[i*3+1]>4) p[i*3+1]=0;
          p[i*3]=e._baseX+(Math.random()-0.5)*2; p[i*3+2]=e._baseZ+(Math.random()-0.5)*2;
        }
        e.geometry.attributes.position.needsUpdate = true;
        e.material.color.setHSL(0.06+Math.random()*0.03, 1, 0.5+Math.random()*0.1);
      }
      if (e._isMeteor) {
        const p = e.geometry.attributes.position.array;
        for (let i = 0; i < p.length/3; i++) { p[i*3+1] -= 15 * dt; }
        e.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Flood
    if (this._floodPlane) {
      this._floodLevel = Math.min(4, this._floodLevel + dt * 0.25);
      this._floodPlane.position.y = -5 + this._floodLevel;
    }

    // Earthquake
    if (this._shakeTime > 0) {
      this._shakeTime -= dt;
      if (this.camera) { this.camera.position.x += (Math.random()-0.5)*0.35; this.camera.position.y += (Math.random()-0.5)*0.2; }
      if (this._shakeTime <= 0 && inhabitants) inhabitants.forEach(i => i.clearOverride());
    }

    // Solar flare (futuristic)
    if (this._solarFlash > 0) {
      this._solarFlash -= dt;
      if (this.camera) {
        const flashIntensity = Math.max(0, this._solarFlash);
        this.scene.background?.setRGB?.(0.5 + flashIntensity, 0.3 + flashIntensity * 0.5, 0.1);
      }
      if (this._solarFlash <= 0 && inhabitants) inhabitants.forEach(i => i.clearOverride());
    }

    // Confetti
    if (this._celebParticles) {
      const p = this._celebParticles.geometry.attributes.position.array;
      for (let i = 0; i < p.length/3; i++) {
        p[i*3+1] -= 1.5*dt;
        if (p[i*3+1]<0) { p[i*3]=(Math.random()-0.5)*30; p[i*3+1]=16; p[i*3+2]=(Math.random()-0.5)*30; }
      }
      this._celebParticles.geometry.attributes.position.needsUpdate = true;
    }
  }

  get eventLabel() {
    if (!this.activeEvent) return '';
    const d = this._eraDisasters[this.activeEvent] || this._eraSocialEvents[this.activeEvent];
    return d?.label || this.activeEvent;
  }
}
