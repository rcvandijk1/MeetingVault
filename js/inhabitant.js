import * as THREE from 'three';
import { findPath, waypointPos, WAYPOINTS } from './pathfinding.js';

const NAMES = [
  'Aldric','Bessa','Coran','Dwyn','Edda','Feren','Gala','Hadwin',
  'Idris','Jenna','Kael','Lyra','Maren','Noel','Oswin','Petra',
  'Quinn','Rona','Sela','Thorn','Uma','Vega','Wren','Xyra','Yara','Zale'
];

const HOME_WAYPOINTS = [
  'home_1','home_2','home_3','home_4','home_5','home_6',
  'home_7','home_8','home_9','home_10','home_11','home_12'
];

let _nameIdx = 0;
let _homeIdx = 0;

export class Inhabitant {
  constructor(career, scene, barter) {
    this.name = NAMES[_nameIdx++ % NAMES.length];
    this.career = career;
    this.scene = scene;
    this.barter = barter;
    this.home = HOME_WAYPOINTS[_homeIdx++ % HOME_WAYPOINTS.length];
    this.inventory = {};
    this.mood = 0.7 + Math.random() * 0.3;
    this.state = 'sleeping';
    this._override = null;
    this.isPlagued = false;
    this.socialTarget = null;
    this.fleeTarget = null;

    // Navigation
    this._path = [];
    this._pathTarget = null;
    this._waypointIdx = 0;
    this._moveTimer = 0;
    this._stateTimer = 0;
    this._barterCooldown = 0;
    this._produceTimer = 0;
    this._animTimer = 0;

    // Starting position
    const homePos = waypointPos(this.home);
    this.pos = { x: homePos.x + (Math.random() - 0.5) * 2, z: homePos.z + (Math.random() - 0.5) * 2 };

    this.body = this._buildPixelBody();
    this.body.position.set(this.pos.x, 0, this.pos.z);
    scene.add(this.body);

    // Nameplate
    this._namePlate = null; // created lazily on hover

    // Initial inventory
    const produces = career.produces || {};
    for (const [good, amt] of Object.entries(produces)) {
      this.inventory[good] = Math.floor(amt * 1.5);
    }
  }

  _buildPixelBody() {
    const c = this.career;
    const g = new THREE.Group();

    const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });

    // Legs
    const legGeo = new THREE.BoxGeometry(0.22, 0.45, 0.22);
    const leftLeg  = new THREE.Mesh(legGeo, mat(c.pantsColor || 0x333333));
    const rightLeg = new THREE.Mesh(legGeo, mat(c.pantsColor || 0x333333));
    leftLeg.position.set(-0.12, 0.22, 0);
    rightLeg.position.set(0.12, 0.22, 0);
    g.add(leftLeg); g.add(rightLeg);
    this._leftLeg = leftLeg; this._rightLeg = rightLeg;

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.3), mat(c.tunicColor));
    torso.position.set(0, 0.72, 0);
    g.add(torso); this._torso = torso;

    // Arms
    const armGeo = new THREE.BoxGeometry(0.18, 0.45, 0.18);
    const leftArm  = new THREE.Mesh(armGeo, mat(c.tunicColor));
    const rightArm = new THREE.Mesh(armGeo, mat(c.tunicColor));
    leftArm.position.set(-0.34, 0.68, 0);
    rightArm.position.set(0.34, 0.68, 0);
    g.add(leftArm); g.add(rightArm);
    this._leftArm = leftArm; this._rightArm = rightArm;

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), mat(c.skinColor));
    head.position.set(0, 1.2, 0);
    g.add(head); this._head = head;

    // Eyes (pixel dots)
    const eyeMat = mat(0x111111);
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
    const lEye = new THREE.Mesh(eyeGeo, eyeMat);
    const rEye = new THREE.Mesh(eyeGeo, eyeMat);
    lEye.position.set(-0.1, 1.22, 0.22);
    rEye.position.set(0.1, 1.22, 0.22);
    g.add(lEye); g.add(rEye);

    // Hat
    if (c.hatColor != null) {
      const hat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.5), mat(c.hatColor));
      hat.position.set(0, 1.52, 0);
      g.add(hat);
      if (c.id === 'farmer') {
        // Wide brim
        const brim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.8), mat(c.hatColor));
        brim.position.set(0, 1.42, 0);
        g.add(brim);
      }
    }

    // Career accessory
    this._addAccessory(g, c);

    // Shadow blob
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

  _addAccessory(g, c) {
    const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });
    switch (c.id) {
      case 'blacksmith': {
        const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), mat(0x888888));
        const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.14), mat(0x777777));
        hammer.position.set(0.42, 0.55, 0.1);
        hammerHead.position.set(0.42, 0.76, 0.1);
        g.add(hammer); g.add(hammerHead);
        break;
      }
      case 'woodcutter': {
        const axe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.06), mat(0x8b5e2a));
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.06), mat(0x999999));
        axe.position.set(0.42, 0.55, 0.1);
        blade.position.set(0.5, 0.76, 0.1);
        g.add(axe); g.add(blade);
        break;
      }
      case 'fisher': {
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), mat(0x8b5e2a));
        rod.position.set(0.42, 0.8, 0.05);
        rod.rotation.z = -0.3;
        g.add(rod);
        break;
      }
      case 'healer': {
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), mat(0xff0000));
        const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.06), mat(0xff0000));
        cross.position.set(0, 0.72, 0.18);
        crossV.position.set(0, 0.72, 0.18);
        g.add(cross); g.add(crossV);
        break;
      }
      case 'shepherd': {
        const staff = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), mat(0x8b5e2a));
        staff.position.set(0.42, 0.75, 0.05);
        g.add(staff);
        break;
      }
      case 'merchant': {
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), mat(0xc8a040));
        bag.position.set(0.4, 0.55, 0);
        g.add(bag);
        break;
      }
    }
  }

  setState(s) {
    if (this._override) return;
    if (this.state !== s) {
      this.state = s;
      this._stateTimer = 0;
    }
  }

  setOverride(s) {
    this._override = s;
    this.state = s;
    this._stateTimer = 0;
  }

  clearOverride() {
    this._override = null;
    this._path = [];
    this._pathTarget = null;
  }

  _workplaceWaypoint() {
    const wp = this.career.workplace;
    return WAYPOINTS[wp] ? wp : 'market';
  }

  _schedulePath(targetWP) {
    if (this._pathTarget === targetWP && this._path.length > 0) return;
    const cur = this._nearestWP();
    this._path = findPath(cur, targetWP);
    this._pathTarget = targetWP;
    this._waypointIdx = 0;
  }

  _nearestWP() {
    let best = 'market', bestD = Infinity;
    for (const [k, v] of Object.entries(WAYPOINTS)) {
      const d = (v.x - this.pos.x) ** 2 + (v.z - this.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }

  _atTarget(wp) {
    const t = waypointPos(wp);
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    return dx * dx + dz * dz < 4;
  }

  update(dt, timeSystem, weatherSystem, inhabitants) {
    const hour = timeSystem.hour;
    const speed = (this.isPlagued ? 0.4 : 1.0) * (weatherSystem?.speedMultiplier ?? 1.0);

    this._stateTimer += dt;
    this._barterCooldown = Math.max(0, this._barterCooldown - dt);
    this._produceTimer += dt;
    this._animTimer += dt;

    // Produce goods periodically while working
    if (this.state === 'working' && this._produceTimer > 15) {
      this._produceTimer = 0;
      const { produces } = this.career;
      if (produces) {
        for (const [g, r] of Object.entries(produces)) {
          if ((this.inventory[g] || 0) < 12) this.inventory[g] = (this.inventory[g] || 0) + 1;
        }
      }
    }

    // Override handling
    if (this._override) {
      this._handleOverrideState(dt, speed);
      this._animate();
      return;
    }

    // Normal day schedule
    if (hour >= 23 || hour < 6) {
      this._handleSleep(dt, speed);
    } else if (hour >= 6 && hour < 7) {
      this._handleWakeUp(dt, speed);
    } else if (hour >= 7 && hour < 12) {
      this._handleWork(dt, speed);
    } else if (hour >= 12 && hour < 13) {
      this._handleEat(dt, speed);
    } else if (hour >= 13 && hour < 17) {
      // Work or barter
      if (this._stateTimer > 120 && Math.random() < 0.3 && this._barterCooldown <= 0) {
        this._handleBarter(dt, speed, inhabitants);
      } else {
        this._handleWork(dt, speed);
      }
    } else if (hour >= 17 && hour < 20) {
      this._handleSocialize(dt, speed);
    } else if (hour >= 20 && hour < 23) {
      this._handleEvening(dt, speed, inhabitants);
    }

    // Weather override
    if (weatherSystem?.shouldSeekShelter && this.state !== 'sleeping' && Math.random() < 0.001) {
      this._schedulePath(this.home);
      this.setState('seeking_shelter');
    }

    this._animate();
  }

  _handleSleep(dt, speed) {
    this.setState('sleeping');
    this._walkToward(this.home, dt, speed * 0.5);
    if (this._atTarget(this.home)) {
      this.body.visible = true;
      this.body.position.y = -0.8; // "lying down"
    }
    // Mood recovers during sleep
    this.mood = Math.min(1, this.mood + dt * 0.01);
  }

  _handleWakeUp(dt, speed) {
    this.body.position.y = 0;
    this.setState('waking');
    this._stateTimer = 0;
  }

  _handleWork(dt, speed) {
    this.setState('working');
    const wp = this._workplaceWaypoint();
    this._schedulePath(wp);
    this._walkAlongPath(dt, speed);
  }

  _handleEat(dt, speed) {
    this.setState('eating');
    const dest = Math.random() < 0.6 ? this.home : 'tavern';
    this._schedulePath(dest);
    this._walkAlongPath(dt, speed * 0.8);
    if (this._stateTimer > 40 && this._atTarget(dest)) {
      this.barter.consume(this);
    }
  }

  _handleBarter(dt, speed, inhabitants) {
    this.setState('bartering');
    this._schedulePath('market');
    this._walkAlongPath(dt, speed);
    if (this._atTarget('market') && this._barterCooldown <= 0) {
      const near = inhabitants.filter(i =>
        i !== this && i.state !== 'sleeping' &&
        Math.abs(i.pos.x - this.pos.x) < 15 && Math.abs(i.pos.z - this.pos.z) < 15
      );
      for (const other of near) {
        const deal = this.barter.canTrade(this, other);
        if (deal) {
          this.barter.trade(this, other);
          this._barterCooldown = 20;
          this._stateTimer = 0;
          break;
        }
      }
    }
    if (this._stateTimer > 60) this._stateTimer = 0; // reset so we try again
  }

  _handleSocialize(dt, speed) {
    this.setState('socializing');
    const spots = ['tavern','well','market'];
    if (!this._pathTarget || this._atTarget(this._pathTarget)) {
      this._schedulePath(spots[Math.floor(Math.random() * spots.length)]);
    }
    this._walkAlongPath(dt, speed * 0.7);
    if (this._atTarget(this._pathTarget) && this._stateTimer > 30) {
      this._schedulePath(spots[Math.floor(Math.random() * spots.length)]);
      this._stateTimer = 0;
    }
  }

  _handleEvening(dt, speed, inhabitants) {
    this.setState('returning_home');
    this._schedulePath(this.home);
    this._walkAlongPath(dt, speed * 0.8);
  }

  _handleOverrideState(dt, speed) {
    switch (this._override) {
      case 'fleeing':
        if (this.fleeTarget) {
          const dx = this.fleeTarget.x - this.pos.x;
          const dz = this.fleeTarget.z - this.pos.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > 1) {
            const s = Math.min(speed * 4, dist) / dist;
            this.pos.x += dx * s * dt;
            this.pos.z += dz * s * dt;
          }
        }
        break;
      case 'cowering':
        // Shake in place
        this.body.rotation.z = Math.sin(this._animTimer * 20) * 0.1;
        break;
      case 'celebrating':
        if (this.socialTarget) this._walkToward('market', dt, speed * 0.9);
        this.body.position.y = 0.1 * Math.abs(Math.sin(this._animTimer * 4));
        break;
      case 'bartering':
        if (this.socialTarget) this._walkToward('market', dt, speed * 0.8);
        break;
      case 'meeting':
      case 'socializing':
        if (this.socialTarget) this._walkToward('market', dt, speed * 0.6);
        break;
    }
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _walkToward(wp, dt, speed) {
    const t = waypointPos(wp);
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.5) return;
    const s = Math.min(speed * 2.5 * dt, d);
    this.pos.x += (dx / d) * s;
    this.pos.z += (dz / d) * s;
    this.body.rotation.y = Math.atan2(dx, dz);
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _walkAlongPath(dt, speed) {
    if (!this._path || this._waypointIdx >= this._path.length) return;
    const wp = this._path[this._waypointIdx];
    const t = waypointPos(wp);
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.8) {
      this._waypointIdx++;
      return;
    }
    const s = Math.min(speed * 2.5 * dt, d);
    this.pos.x += (dx / d) * s;
    this.pos.z += (dz / d) * s;
    this.body.rotation.y = Math.atan2(dx, dz);
    this.body.position.set(this.pos.x, this.body.position.y, this.pos.z);
  }

  _animate() {
    const isMoving = this.state !== 'sleeping' && this.state !== 'cowering';
    if (!isMoving) return;

    const t = this._animTimer;
    const swingSpeed = this.state === 'working' ? 6 : 4;
    const swingAmt  = this.state === 'working' ? 0.5 : 0.35;

    if (this.state !== 'sleeping') {
      this.body.position.y = 0.04 * Math.abs(Math.sin(t * swingSpeed));
    }

    if (this._leftLeg) {
      this._leftLeg.rotation.x  =  swingAmt * Math.sin(t * swingSpeed);
      this._rightLeg.rotation.x = -swingAmt * Math.sin(t * swingSpeed);
      this._leftArm.rotation.x  = -swingAmt * Math.sin(t * swingSpeed);
      this._rightArm.rotation.x =  swingAmt * Math.sin(t * swingSpeed);
    }
    if (this.state === 'working') {
      this._head.rotation.x = -0.15 * Math.abs(Math.sin(t * swingSpeed));
    }
  }

  get stateLabel() {
    const labels = {
      sleeping: '💤', working: '⚒️', eating: '🍽️', bartering: '🤝',
      socializing: '💬', returning_home: '🏠', seeking_shelter: '🏠',
      waking: '☀️', celebrating: '🎉', fleeing: '😱', cowering: '😨',
      meeting: '📣'
    };
    return labels[this.state] || '❓';
  }

  get moodColor() {
    const r = Math.floor((1 - this.mood) * 255);
    const g = Math.floor(this.mood * 200);
    return `rgb(${r},${g},50)`;
  }

  dispose() {
    this.scene.remove(this.body);
  }
}
