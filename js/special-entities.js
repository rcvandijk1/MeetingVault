import * as THREE from 'three';

function mat(color, emissive) {
  return new THREE.MeshLambertMaterial({ color, ...(emissive ? { emissive, emissiveIntensity: 0.5 } : {}) });
}
function box(w, h, d, color, emissive) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, emissive));
}

// ── Creature builders ──────────────────────────────────────────────────────

function buildMammoth(primaryColor, secondaryColor) {
  const g = new THREE.Group();
  const body = box(2.5, 1.5, 4, primaryColor); body.position.y = 1.5; g.add(body);
  const head = box(1.4, 1.2, 1.4, primaryColor); head.position.set(0, 2.4, -2.2); g.add(head);
  const neck = box(0.9, 0.8, 0.9, primaryColor); neck.position.set(0, 1.9, -1.8); g.add(neck);
  // Trunk
  const trunk1 = box(0.4, 1.0, 0.4, secondaryColor); trunk1.position.set(0, 1.5, -3); trunk1.rotation.x = 0.4; g.add(trunk1);
  const trunk2 = box(0.3, 0.7, 0.3, secondaryColor); trunk2.position.set(0, 0.6, -3.4); g.add(trunk2);
  // Tusks
  const tuskL = box(0.15, 0.15, 1.4, 0xfffde0); tuskL.position.set(-0.5, 1.7, -2.9); tuskL.rotation.x = -0.3; tuskL.rotation.z = 0.15; g.add(tuskL);
  const tuskR = box(0.15, 0.15, 1.4, 0xfffde0); tuskR.position.set(0.5, 1.7, -2.9); tuskR.rotation.x = -0.3; tuskR.rotation.z = -0.15; g.add(tuskR);
  // Legs
  [[-0.9,-1.3],[-0.9,1.3],[0.9,-1.3],[0.9,1.3]].forEach(([lx,lz]) => {
    const leg = box(0.5, 1.4, 0.5, secondaryColor); leg.position.set(lx, 0.7, lz); g.add(leg);
  });
  // Fur bumps (voxels)
  for (let i = 0; i < 6; i++) {
    const fur = box(0.3 + Math.random() * 0.2, 0.3, 0.3, primaryColor);
    fur.position.set((Math.random() - 0.5) * 2, 2.4, (Math.random() - 0.5) * 3);
    g.add(fur);
  }
  return g;
}

function buildSaberTooth(primaryColor, secondaryColor) {
  const g = new THREE.Group();
  const body = box(1, 0.85, 2, primaryColor); body.position.y = 1; g.add(body);
  const head = box(0.9, 0.7, 1, primaryColor); head.position.set(0, 1.4, -1.3); g.add(head);
  const fang1 = box(0.1, 0.5, 0.08, 0xfffde0); fang1.position.set(-0.2, 0.9, -1.8); g.add(fang1);
  const fang2 = box(0.1, 0.5, 0.08, 0xfffde0); fang2.position.set(0.2, 0.9, -1.8); g.add(fang2);
  const tail = box(0.2, 0.2, 1.2, secondaryColor); tail.position.set(0, 1.1, 1); tail.rotation.x = -0.3; g.add(tail);
  [[-0.4,-0.5],[-0.4,0.5],[0.4,-0.5],[0.4,0.5]].forEach(([lx,lz]) => {
    const leg = box(0.25, 0.9, 0.25, secondaryColor); leg.position.set(lx, 0.45, lz); g.add(leg);
  });
  // Stripes
  for (let i = 0; i < 4; i++) {
    const stripe = box(0.15, 0.9, 0.15, secondaryColor); stripe.position.set(0, 1, -0.8 + i * 0.5); g.add(stripe);
  }
  return g;
}

function buildPterodactyl(primaryColor) {
  const g = new THREE.Group();
  const body = box(0.7, 0.6, 1.2, primaryColor); body.position.y = 0.3; g.add(body);
  const head = box(0.5, 0.5, 0.7, primaryColor); head.position.set(0, 0.5, -1); g.add(head);
  const beak = box(0.15, 0.15, 0.6, 0x888866); beak.position.set(0, 0.35, -1.55); g.add(beak);
  const crest = box(0.15, 0.55, 0.2, primaryColor); crest.position.set(0, 0.95, -0.7); g.add(crest);
  // Wings (spread out)
  const wingL = box(2.5, 0.12, 0.8, primaryColor); wingL.position.set(-1.7, 0.4, -0.1); wingL.rotation.z = -0.15; g.add(wingL);
  const wingR = box(2.5, 0.12, 0.8, primaryColor); wingR.position.set(1.7, 0.4, -0.1); wingR.rotation.z = 0.15; g.add(wingR);
  return g;
}

function buildCaveBear(primaryColor, secondaryColor) {
  const g = new THREE.Group();
  const body = box(1.4, 1.2, 2, primaryColor); body.position.y = 1.2; g.add(body);
  const head = box(1.1, 1.0, 1, primaryColor); head.position.set(0, 2, -1.2); g.add(head);
  const snout = box(0.7, 0.5, 0.6, secondaryColor); snout.position.set(0, 1.7, -1.8); g.add(snout);
  const earL = box(0.3, 0.3, 0.25, primaryColor); earL.position.set(-0.45, 2.65, -1.1); g.add(earL);
  const earR = box(0.3, 0.3, 0.25, primaryColor); earR.position.set(0.45, 2.65, -1.1); g.add(earR);
  [[-0.55,-0.4],[-0.55,0.4],[0.55,-0.4],[0.55,0.4]].forEach(([lx,lz]) => {
    const leg = box(0.4, 1.1, 0.4, secondaryColor); leg.position.set(lx, 0.55, lz); g.add(leg);
  });
  return g;
}

function buildAlien(primaryColor, secondaryColor) {
  const g = new THREE.Group();
  // Large oval head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat(primaryColor));
  head.scale.set(1, 1.3, 1); head.position.y = 1.2; g.add(head);
  // Big black eyes
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const eyeGeo = new THREE.SphereGeometry(0.1, 6, 4);
  const lEye = new THREE.Mesh(eyeGeo, eyeMat); lEye.position.set(-0.15, 1.28, 0.3); g.add(lEye);
  const rEye = new THREE.Mesh(eyeGeo, eyeMat); rEye.position.set(0.15, 1.28, 0.3); g.add(rEye);
  // Small body
  const body = box(0.4, 0.55, 0.3, secondaryColor); body.position.y = 0.72; g.add(body);
  // Long thin arms
  const armGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
  const armMat = mat(primaryColor);
  const lArm = new THREE.Mesh(armGeo, armMat); lArm.position.set(-0.3, 0.68, 0); lArm.rotation.z = 0.3; g.add(lArm);
  const rArm = new THREE.Mesh(armGeo, armMat); rArm.position.set(0.3, 0.68, 0); rArm.rotation.z = -0.3; g.add(rArm);
  // Legs
  const legGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12);
  const lLeg = new THREE.Mesh(legGeo, mat(primaryColor)); lLeg.position.set(-0.12, 0.22, 0); g.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, mat(primaryColor)); rLeg.position.set(0.12, 0.22, 0); g.add(rLeg);
  // Glow
  const glow = new THREE.PointLight(0x44ff88, 0.5, 4);
  glow.position.y = 1; g.add(glow);
  g._lLeg = lLeg; g._rLeg = rLeg;
  return g;
}

function buildCar(color, glowing) {
  const g = new THREE.Group();
  const body = box(1.6, 0.55, 3.2, color); body.position.y = 0.55; g.add(body);
  const cabin = box(1.3, 0.5, 1.8, color); cabin.position.y = 1.08; cabin.position.z = -0.2; g.add(cabin);
  // Wheels
  [[-0.85,-1.0],[-0.85,1.0],[0.85,-1.0],[0.85,1.0]].forEach(([wx,wz]) => {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 8),
      new THREE.MeshLambertMaterial({ color: 0x222222 }));
    wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.28, wz); g.add(wh);
  });
  // Windows
  const winMat = new THREE.MeshLambertMaterial({ color: 0x88ccee, transparent: true, opacity: 0.7 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.05), winMat);
  win.position.set(0, 1.08, -1.1); g.add(win);
  // Headlights
  const hMat = new THREE.MeshLambertMaterial({ color: 0xffffcc, emissive: 0xffffaa });
  [[-0.5, 1.7],[0.5, 1.7]].forEach(([hx, hz]) => {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.1), hMat);
    hl.position.set(hx, 0.6, hz); g.add(hl);
  });
  if (glowing) {
    // Hover glow underneath
    const hoverGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.8),
      new THREE.MeshLambertMaterial({ color, emissive: color, transparent: true, opacity: 0.5 }));
    hoverGlow.rotation.x = -Math.PI / 2; hoverGlow.position.y = 0.05; g.add(hoverGlow);
    g.position.y = 0.5; // hover height
  }
  return g;
}

const BUILDERS = {
  mammoth: buildMammoth,
  saber_tooth: buildSaberTooth,
  pterodactyl: buildPterodactyl,
  cave_bear: buildCaveBear,
  alien: buildAlien,
  alien_scout: buildAlien,
};

export class SpecialEntities {
  constructor(scene) {
    this.scene = scene;
    this.entities = [];
    this.vehicles = [];
    this._time = 0;
  }

  spawn(eraConfig, waypoints) {
    this.clear();
    // Creatures
    for (const cfg of (eraConfig.creatures || [])) {
      const builder = BUILDERS[cfg.type];
      if (!builder) continue;
      for (let i = 0; i < cfg.count; i++) {
        const mesh = builder(cfg.primaryColor, cfg.secondaryColor);
        mesh.scale.setScalar(cfg.scale);
        const startX = (Math.random() - 0.5) * 100;
        const startZ = (Math.random() - 0.5) * 100;
        mesh.position.set(startX, 0, startZ);
        this.scene.add(mesh);

        const entity = {
          mesh, cfg,
          pos: { x: startX, z: startZ, y: 0 },
          target: { x: startX, z: startZ },
          speed: cfg.speed,
          _retargetTimer: 0,
          _animTimer: 0,
          alive: true,
        };
        if (cfg.flying) {
          entity.pos.y = 12 + Math.random() * 8;
          entity.target.y = entity.pos.y;
        }
        this.entities.push(entity);
      }
    }

    // Vehicles
    for (const vcfg of (eraConfig.vehicles || [])) {
      const mesh = buildCar(vcfg.color, !!vcfg.glow);
      const startPos = this._randomRoadPos(eraConfig.id);
      mesh.position.set(startPos.x, 0, startPos.z);
      this.scene.add(mesh);
      this.vehicles.push({
        mesh,
        pos: { x: startPos.x, z: startPos.z },
        dir: { x: Math.random() > 0.5 ? 1 : -1, z: 0 },
        speed: 6 + Math.random() * 4,
        _roadTimer: 0,
        stopped: false,
      });
    }
  }

  _randomRoadPos(eraId) {
    if (eraId === 'modern') {
      const roads = [[0,-10],[0,12]];
      const r = roads[Math.floor(Math.random() * roads.length)];
      return { x: (Math.random() - 0.5) * 60 + r[0], z: r[1] };
    }
    return { x: (Math.random() - 0.5) * 60, z: (Math.random() - 0.5) * 60 };
  }

  clear() {
    for (const e of this.entities) { this.scene.remove(e.mesh); e.mesh.geometry?.dispose(); }
    for (const v of this.vehicles)  { this.scene.remove(v.mesh); v.mesh.geometry?.dispose(); }
    this.entities = [];
    this.vehicles = [];
  }

  update(dt, inhabitants, panicMode) {
    this._time += dt;

    for (const entity of this.entities) {
      entity._retargetTimer -= dt;
      entity._animTimer += dt;
      const { cfg, pos } = entity;

      // Retarget
      if (entity._retargetTimer <= 0) {
        entity._retargetTimer = 3 + Math.random() * 5;
        if (panicMode && cfg.aggressive && inhabitants.length > 0) {
          // Chase nearest inhabitant
          const near = inhabitants.reduce((a, b) => {
            const da = (a.pos.x - pos.x)**2 + (a.pos.z - pos.z)**2;
            const db = (b.pos.x - pos.x)**2 + (b.pos.z - pos.z)**2;
            return da < db ? a : b;
          });
          entity.target = { x: near.pos.x, z: near.pos.z };
          // Make nearby inhabitants flee
          for (const inh of inhabitants) {
            const d = Math.sqrt((inh.pos.x - pos.x)**2 + (inh.pos.z - pos.z)**2);
            if (d < 15) {
              inh.setOverride('fleeing');
              inh.fleeTarget = { x: inh.pos.x + (inh.pos.x - pos.x) * 2, z: inh.pos.z + (inh.pos.z - pos.z) * 2 };
            }
          }
        } else {
          // Random wander
          entity.target = { x: (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 80 };
          if (cfg.flying) entity.target.y = 10 + Math.random() * 12;
        }
      }

      // Move toward target
      const dx = entity.target.x - pos.x;
      const dz = entity.target.z - pos.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist > 1) {
        const s = entity.speed * dt;
        pos.x += (dx / dist) * s;
        pos.z += (dz / dist) * s;
        entity.mesh.rotation.y = Math.atan2(dx, dz);
      }
      if (cfg.flying) {
        const dy = (entity.target.y || pos.y) - pos.y;
        pos.y += dy * dt * 0.5;
        // Wing flap
        const wings = entity.mesh.children.filter((c, i) => i >= 5 && i <= 6);
        wings.forEach((w, i) => { w.rotation.z = (i === 0 ? -1 : 1) * (0.15 + 0.3 * Math.abs(Math.sin(entity._animTimer * 3))); });
      } else {
        pos.y = 0;
        // Walk animation for legs
        if (entity.mesh._lLeg) {
          entity.mesh._lLeg.rotation.x =  0.4 * Math.sin(entity._animTimer * 4);
          entity.mesh._rLeg.rotation.x = -0.4 * Math.sin(entity._animTimer * 4);
        }
        entity.mesh.position.y = Math.abs(Math.sin(entity._animTimer * 4)) * 0.05 * cfg.scale;
      }
      entity.mesh.position.set(pos.x, pos.y, pos.z);
    }

    // Vehicles
    for (const v of this.vehicles) {
      if (v.stopped) continue;
      v._roadTimer -= dt;
      if (v._roadTimer <= 0) {
        v._roadTimer = 4 + Math.random() * 6;
        // Switch direction or road
        v.dir = Math.random() > 0.5
          ? { x: v.dir.x * -1, z: v.dir.z }
          : { x: v.dir.x, z: v.dir.z === 0 ? (Math.random() > 0.5 ? 1 : -1) : 0 };
        v.mesh.rotation.y = Math.atan2(v.dir.x, v.dir.z);
      }
      v.pos.x += v.dir.x * v.speed * dt;
      v.pos.z += v.dir.z * v.speed * dt;
      // Wrap bounds
      if (Math.abs(v.pos.x) > 55) { v.dir.x *= -1; }
      if (Math.abs(v.pos.z) > 55) { v.dir.z *= -1; }
      v.mesh.position.set(v.pos.x, v.mesh.position.y, v.pos.z);
    }
  }

  stopVehicles() { this.vehicles.forEach(v => { v.stopped = true; }); }
  startVehicles() { this.vehicles.forEach(v => { v.stopped = false; }); }

  getAlienCount() { return this.entities.filter(e => e.cfg.type.startsWith('alien')).length; }
}
