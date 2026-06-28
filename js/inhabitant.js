import * as THREE from 'three';

const NAMES = [
  'Aldric','Bessa','Coran','Dwyn','Edda','Feren','Gala','Hadwin',
  'Idris','Jenna','Kael','Lyra','Maren','Noel','Oswin','Petra',
  'Quinn','Rona','Sela','Thorn','Uma','Vega','Wren','Xyra','Yara','Zale',
  'Bryn','Cael','Dara','Elva','Finn','Gwen','Holt','Iris','Jax','Kira',
];
let _nameIdx = 0;

export class Inhabitant {
  constructor(career, home, scene, barter, pathfinding) {
    this.name = NAMES[_nameIdx++ % NAMES.length];
    this.career = career;
    this.home = home;
    this.scene = scene;
    this.barter = barter;
    this.pathfinding = pathfinding;

    this.inventory = {};
    this.mood = 0.7 + Math.random() * 0.3;
    this.state = 'sleeping';
    this._override = null;
    this.isPlagued = false;
    this.isOnStrike = false;
    this.socialTarget = null;
    this.fleeTarget = null;

    this._path = [];
    this._pathTarget = null;
    this._waypointIdx = 0;
    this._stateTimer = 0;
    this._barterCooldown = 0;
    this._produceTimer = 0;
    this._animTimer = 0;

    const homePos = pathfinding.waypointPos(home);
    this.pos = { x: homePos.x + (Math.random() - 0.5) * 2, z: homePos.z + (Math.random() - 0.5) * 2 };

    this.body = this._buildPixelBody();
    this.body.position.set(this.pos.x, 0, this.pos.z);
    scene.add(this.body);

    const { produces } = career;
    if (produces) {
      for (const [g, amt] of Object.entries(produces)) this.inventory[g] = Math.floor(amt * 1.5);
    }
  }

  _buildPixelBody() {
    const app = this.career.appearance || this._legacyAppearance();
    const g = new THREE.Group();
    const m = (hex) => new THREE.MeshLambertMaterial({ color: hex });

    // Legs
    const legGeo = new THREE.BoxGeometry(0.22, 0.45, 0.22);
    this._leftLeg  = new THREE.Mesh(legGeo, m(app.bottomColor || 0x333333));
    this._rightLeg = new THREE.Mesh(legGeo, m(app.bottomColor || 0x333333));
    this._leftLeg.position.set(-0.12, 0.22, 0);
    this._rightLeg.position.set(0.12, 0.22, 0);
    g.add(this._leftLeg, this._rightLeg);

    // Torso
    this._torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3), m(app.topColor));
    this._torso.position.set(0, 0.72, 0);
    g.add(this._torso);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.18, 0.45, 0.18);
    this._leftArm  = new THREE.Mesh(armGeo, m(app.topColor));
    this._rightArm = new THREE.Mesh(armGeo, m(app.topColor));
    this._leftArm.position.set(-0.34, 0.68, 0);
    this._rightArm.position.set(0.34, 0.68, 0);
    g.add(this._leftArm, this._rightArm);

    // Head
    this._head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), m(app.skinColor));
    this._head.position.set(0, 1.2, 0);
    g.add(this._head);

    // Eyes
    const eyeM = m(0x111111);
    const eyeG = new THREE.BoxGeometry(0.08, 0.08, 0.05);
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(eyeG, eyeM);
      eye.position.set(ex, 1.22, 0.22);
      g.add(eye);
    }

    // Hat
    if (app.hat) {
      const { w = 0.5, h = 0.22, d = 0.5, color, brim } = app.hat;
      const hat = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color));
      hat.position.set(0, 1.42 + h / 2, 0);
      g.add(hat);
      if (brim) {
        const brimM = new THREE.Mesh(new THREE.BoxGeometry(brim.w || w + 0.3, 0.06, brim.d || d + 0.3), m(color));
        brimM.position.set(0, 1.42, 0);
        g.add(brimM);
      }
    }

    // Accessories
    for (const acc of (app.accessories || [])) {
      let geo;
      if (acc.geo === 'cylinder') {
        geo = new THREE.CylinderGeometry(acc.size[0], acc.size[1], acc.size[2], 6);
      } else {
        geo = new THREE.BoxGeometry(...acc.size);
      }
      const mesh = new THREE.Mesh(geo, m(acc.color));
      mesh.position.set(...acc.pos);
      if (acc.rot) mesh.rotation.set(...acc.rot);
      g.add(mesh);
    }

    // Shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    g.add(shadow);

    g.castShadow = true;
    return g;
  }

  _legacyAppearance() {
    return {
      skinColor: this.career.skinColor || 0xf4c88a,
      topColor: this.career.tunicColor || 0x888888,
      bottomColor: this.career.pantsColor || 0x333333,
      hat: this.career.hatColor != null ? { w: 0.5, h: 0.22, d: 0.5, color: this.career.hatColor } : null,
      accessories: [],
    };
  }

  setState(s) { if (!this._override) { if (this.state !== s) { this.state = s; this._stateTimer = 0; } } }
  setOverride(s) { this._override = s; this.state = s; this._stateTimer = 0; }
  clearOverride() { this._override = null; this._path = []; this._pathTarget = null; }

  _workplaceWP() {
    const wp = this.career.workplace;
    return this.pathfinding.waypoints[wp] ? wp : this.pathfinding.randomWaypoint();
  }

  _schedulePath(targetWP) {
    if (this._pathTarget === targetWP && this._path.length > this._waypointIdx) return;
    const cur = this.pathfinding.nearestWaypoint(this.pos.x, this.pos.z);
    this._path = this.pathfinding.findPath(cur, targetWP);
    this._pathTarget = targetWP;
    this._waypointIdx = 0;
  }

  _atTarget(wp) {
    const t = this.pathfinding.waypointPos(wp);
    return (t.x - this.pos.x) ** 2 + (t.z - this.pos.z) ** 2 < 4;
  }

  update(dt, timeSystem, weatherSystem, inhabitants, socialWPs) {
    const h = timeSystem.hour;
    const weatherMult = weatherSystem?.speedMultiplier ?? 1.0;
    const speed = (this.isPlagued ? 0.4 : 1.0) * weatherMult;

    this._stateTimer += dt;
    this._barterCooldown = Math.max(0, this._barterCooldown - dt);
    this._produceTimer += dt;
    this._animTimer += dt;

    // Produce while working
    if (this.state === 'working' && this._produceTimer > 20) {
      this._produceTimer = 0;
      for (const [good, rate] of Object.entries(this.career.produces || {})) {
        if ((this.inventory[good] || 0) < 12) this.inventory[good] = (this.inventory[good] || 0) + 1;
      }
    }

    if (this._override) { this._handleOverride(dt, speed); this._animate(); return; }
    if (this.isOnStrike) { this._handleStrike(dt, speed, socialWPs); this._animate(); return; }

    const workStart = this.career.workStart ?? 7;
    const workEnd   = this.career.workEnd   ?? 17;

    if (h >= 23 || h < 6)              this._doSleep(dt, speed);
    else if (h >= 6 && h < 7)          this._doWakeUp();
    else if (h >= workStart && h < Math.min(workStart + 3, 12)) this._doWork(dt, speed);
    else if (h >= 12 && h < 13)        this._doEat(dt, speed);
    else if (h >= 13 && h < workEnd)   {
      if (this._stateTimer > 90 && Math.random() < 0.25 && this._barterCooldown <= 0) this._doBarter(dt, speed, inhabitants);
      else this._doWork(dt, speed);
    }
    else if (h >= workEnd && h < 21)   this._doSocialize(dt, speed, socialWPs);
    else                               this._doReturnHome(dt, speed);

    if (weatherSystem?.shouldSeekShelter && Math.random() < 0.0005) {
      this._schedulePath(this.home);
      this.setState('seeking_shelter');
    }

    this._animate();
  }

  _doSleep(dt, speed) {
    this.setState('sleeping');
    this._walkAlongPath(dt, speed * 0.5);
    if (this._atTarget(this.home)) this.body.position.y = -0.8;
    this.mood = Math.min(1, this.mood + dt * 0.008);
    if (!this._pathTarget) this._schedulePath(this.home);
  }

  _doWakeUp() {
    this.body.position.y = 0;
    this.setState('waking');
    this._path = []; this._pathTarget = null;
  }

  _doWork(dt, speed) {
    this.setState('working');
    this._schedulePath(this._workplaceWP());
    this._walkAlongPath(dt, speed);
  }

  _doEat(dt, speed) {
    this.setState('eating');
    const dest = Math.random() < 0.6 ? this.home : (this.pathfinding.waypoints['tavern'] ? 'tavern' : this.home);
    this._schedulePath(dest);
    this._walkAlongPath(dt, speed * 0.8);
    if (this._stateTimer > 35 && this._atTarget(dest)) { this.barter.consume(this); this._stateTimer = 0; }
  }

  _doBarter(dt, speed, inhabitants) {
    this.setState('bartering');
    const mkt = this.pathfinding.waypoints['market'] ? 'market' : this.pathfinding.randomWaypoint();
    this._schedulePath(mkt);
    this._walkAlongPath(dt, speed);
    if (this._atTarget(mkt) && this._barterCooldown <= 0) {
      const near = inhabitants.filter(i => i !== this && i.state !== 'sleeping' &&
        Math.abs(i.pos.x - this.pos.x) < 18 && Math.abs(i.pos.z - this.pos.z) < 18);
      for (const other of near) {
        if (this.barter.canTrade(this, other)) {
          this.barter.trade(this, other);
          this._barterCooldown = 18;
          this._stateTimer = 0;
          break;
        }
      }
      if (this._stateTimer > 50) { this._pathTarget = null; this._stateTimer = 0; }
    }
  }

  _doSocialize(dt, speed, socialWPs) {
    this.setState('socializing');
    if (!this._pathTarget || this._atTarget(this._pathTarget)) {
      const spots = socialWPs?.length ? socialWPs : ['market'];
      this._schedulePath(spots[Math.floor(Math.random() * spots.length)]);
    }
    this._walkAlongPath(dt, speed * 0.7);
    if (this._atTarget(this._pathTarget) && this._stateTimer > 28) {
      this._pathTarget = null; this._stateTimer = 0;
    }
  }

  _doReturnHome(dt, speed) {
    this.setState('returning_home');
    this._schedulePath(this.home);
    this._walkAlongPath(dt, speed * 0.8);
  }

  _handleStrike(dt, speed, socialWPs) {
    this.state = 'striking';
    const mkt = this.pathfinding.waypoints['market'] ? 'market' : (this.pathfinding.waypoints['city_center'] ? 'city_center' : Object.keys(this.pathfinding.waypoints)[0]);
    this._schedulePath(mkt);
    this._walkAlongPath(dt, speed * 0.8);
    // Circle around the gather point
    if (this._atTarget(mkt) && this._stateTimer > 15) {
      this._pathTarget = null; this._stateTimer = 0;
    }
  }

  _handleOverride(dt, speed) {
    switch (this._override) {
      case 'fleeing':
        if (this.fleeTarget) {
          const dx = this.fleeTarget.x - this.pos.x, dz = this.fleeTarget.z - this.pos.z;
          const dist = Math.sqrt(dx*dx + dz*dz);
          if (dist > 1) {
            const s = Math.min(speed * 4.5, dist) / dist;
            this.pos.x += dx * s * dt; this.pos.z += dz * s * dt;
          }
        }
        break;
      case 'cowering':
        this.body.rotation.z = Math.sin(this._animTimer * 18) * 0.12;
        break;
      case 'celebrating':
      case 'marching':
      case 'bartering':
      case 'meeting':
      case 'socializing':
        if (this.socialTarget) {
          const key = Object.keys(this.pathfinding.waypoints).find(k => this.pathfinding.waypoints[k] === this.socialTarget) || 'market';
          this._walkToward(key, dt, speed * 0.85);
        }
        if (this._override === 'celebrating') {
          this.body.position.y = 0.1 * Math.abs(Math.sin(this._animTimer * 4));
        }
        break;
    }
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _walkToward(wp, dt, speed) {
    const t = this.pathfinding.waypointPos(wp);
    if (!t) return;
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.sqrt(dx*dx + dz*dz);
    if (d < 0.5) return;
    const s = Math.min(speed * 2.5 * dt, d);
    this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
    this.body.rotation.y = Math.atan2(dx, dz);
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _walkAlongPath(dt, speed) {
    if (!this._path || this._waypointIdx >= this._path.length) return;
    const wp = this._path[this._waypointIdx];
    const t = this.pathfinding.waypointPos(wp);
    if (!t) { this._waypointIdx++; return; }
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.sqrt(dx*dx + dz*dz);
    if (d < 0.8) { this._waypointIdx++; return; }
    const s = Math.min(speed * 2.5 * dt, d);
    this.pos.x += (dx / d) * s; this.pos.z += (dz / d) * s;
    this.body.rotation.y = Math.atan2(dx, dz);
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _animate() {
    const moving = !['sleeping','cowering'].includes(this.state) && this._override !== 'cowering';
    if (!moving) return;
    const t = this._animTimer;
    const ss = this.state === 'working' ? 6 : 4;
    const sa = this.state === 'working' ? 0.5 : 0.35;
    if (this.state !== 'sleeping') this.body.position.y = Math.max(0, this.body.position.y) + 0.04 * Math.abs(Math.sin(t * ss)) - 0.02;
    this._leftLeg.rotation.x  =  sa * Math.sin(t * ss);
    this._rightLeg.rotation.x = -sa * Math.sin(t * ss);
    this._leftArm.rotation.x  = -sa * Math.sin(t * ss);
    this._rightArm.rotation.x =  sa * Math.sin(t * ss);
    if (this.state === 'working') this._head.rotation.x = -0.15 * Math.abs(Math.sin(t * ss));
  }

  get stateLabel() {
    return { sleeping:'💤',working:'⚒️',eating:'🍽️',bartering:'🤝',socializing:'💬',
      returning_home:'🏠',seeking_shelter:'🏠',waking:'☀️',celebrating:'🎉',
      fleeing:'😱',cowering:'😨',meeting:'📣',striking:'✊',marching:'📢' }[this.state] || '❓';
  }
  get moodColor() {
    const r = Math.floor((1 - this.mood) * 255);
    const g = Math.floor(this.mood * 200);
    return `rgb(${r},${g},50)`;
  }

  dispose() { this.scene.remove(this.body); }
}

export function resetNameIndex() { _nameIdx = 0; }
