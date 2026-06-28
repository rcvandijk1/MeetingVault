import * as THREE from 'three';

function mesh(geo, color) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function vbox(w, h, d, color) { return mesh(new THREE.BoxGeometry(w, h, d), color); }

export function ground(scene, w, d, color) {
  const m = mesh(new THREE.PlaneGeometry(w, d, 30, 30), color);
  m.rotation.x = -Math.PI / 2;
  scene.add(m);
  return m;
}

export function pathStrip(scene, x, z, w, l, color) {
  const m = vbox(w, 0.05, l, color);
  m.position.set(x, 0.02, z);
  scene.add(m);
  return m;
}

// Medieval pitched-roof house
export function medievalBuilding(x, z, w, d, wallH, wallColor, roofColor) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const wall = vbox(w, wallH, d, wallColor);
  wall.position.y = wallH / 2;
  g.add(wall);
  const roof = mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.5, 4), roofColor);
  roof.rotation.y = Math.PI / 4; roof.position.y = wallH + 1.0;
  g.add(roof);
  const door = vbox(0.8, 1.4, 0.1, 0x5c3a1e);
  door.position.set(0, 0.7, d / 2 + 0.01);
  g.add(door);
  return g;
}

// Rock/cave entrance made of stacked boulders
export function caveEntrance(x, z, w, h) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const col = 0x7a6652;
  const left  = vbox(w * 0.22, h * 0.8, w * 0.3, col); left.position.set(-w*0.38, h*0.4, 0);
  const right = vbox(w * 0.22, h * 0.8, w * 0.3, col); right.position.set(w*0.38, h*0.4, 0);
  const topArc = vbox(w, h * 0.28, w * 0.3, 0x6a5542); topArc.position.set(0, h * 0.85, 0);
  const dark   = vbox(w * 0.52, h * 0.65, 0.1, 0x111111); dark.position.set(0, h*0.37, 0.01);
  g.add(left, right, topArc, dark);
  // Extra boulders
  for (let i = 0; i < 3; i++) {
    const s = 0.4 + Math.random() * 0.5;
    const b = vbox(s, s * 0.7, s, 0x887766);
    b.position.set((Math.random() - 0.5) * w, s * 0.35, (Math.random() - 0.5) * 0.8);
    g.add(b);
  }
  return g;
}

// Modern flat-roofed building with windows
export function modernBuilding(x, z, w, d, floors, wallColor) {
  const h = floors * 3.2;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const wall = vbox(w, h, d, wallColor);
  wall.position.y = h / 2;
  g.add(wall);
  const winMat = new THREE.MeshLambertMaterial({ color: 0x88ccee, emissive: 0x112233 });
  for (let f = 0; f < floors; f++) {
    const cols = Math.max(1, Math.floor(w / 2.5));
    for (let c = 0; c < cols; c++) {
      const winX = (c - (cols - 1) / 2) * (w / cols);
      if (Math.abs(winX) < 0.8 && f === 0) continue;
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.06), winMat);
      win.position.set(winX, 1.6 + f * 3.2, d / 2 + 0.01);
      g.add(win);
    }
  }
  const roofEdge = vbox(w + 0.3, 0.4, d + 0.3, 0x555566);
  roofEdge.position.y = h + 0.2;
  g.add(roofEdge);
  const door = vbox(1.2, 2.4, 0.08, 0x334455);
  door.position.set(0, 1.2, d / 2 + 0.02);
  g.add(door);
  return g;
}

// Futuristic angular building with glow trim
export function futureBuilding(x, z, w, d, h, wallColor, glowColor) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const wall = vbox(w, h, d, wallColor); wall.position.y = h / 2;
  g.add(wall);
  if (glowColor) {
    const glowMat = new THREE.MeshLambertMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.8 });
    // Vertical glow stripes
    for (const sx of [-w / 2, w / 2]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), glowMat);
      stripe.position.set(sx, h / 2, d / 2);
      g.add(stripe);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, d + 0.3), glowMat);
    top.position.y = h + 0.09;
    g.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, d + 0.3), glowMat);
    base.position.y = 0.09;
    g.add(base);
  }
  // Slanted top decoration
  const topDecor = vbox(w * 0.6, 0.6, d * 0.6, 0x2a3a4a);
  topDecor.position.y = h + 0.3; topDecor.rotation.y = Math.PI / 8;
  g.add(topDecor);
  return g;
}

// Energy tower (futuristic pylon)
export function energyTower(x, z, h, color) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const shaft = vbox(0.5, h, 0.5, 0x334455); shaft.position.y = h / 2;
  g.add(shaft);
  const glowMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8), glowMat);
  orb.position.y = h + 0.7;
  g.add(orb);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9 + i * 0.3, 0.06, 6, 16), glowMat);
    ring.position.y = h + 0.7;
    ring.rotation.x = (i * Math.PI) / 3;
    g.add(ring);
  }
  return g;
}

// Bio-dome (sphere with frame)
export function bioDome(x, z, r, glassColor, frameColor) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: glassColor, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  dome.position.y = 0;
  g.add(dome);
  const base = vbox(r * 2 + 0.3, 0.4, r * 2 + 0.3, frameColor);
  base.position.y = 0.2;
  g.add(base);
  return g;
}

// Voxel tree (shared across eras, configurable colors)
export function tree(x, z, trunkColor, leafColor1, leafColor2, s) {
  s = s || 1;
  const g = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.2 * s, 0.3 * s, 1.6 * s, 5), trunkColor);
  trunk.position.set(x, 0.8 * s, z);
  g.add(trunk);
  const layers = 3;
  for (let l = 0; l < layers; l++) {
    const ls = (layers - l) * 1.3 * s + 0.4;
    const leaf = vbox(ls, s, ls, l % 2 === 0 ? leafColor1 : leafColor2);
    leaf.position.set(x, (1.6 + l * 0.95) * s, z);
    g.add(leaf);
  }
  return g;
}

// Standing stone (stone age)
export function standingStone(x, z, h, tilt) {
  const g = vbox(0.5 + Math.random() * 0.3, h, 0.4 + Math.random() * 0.2, 0x888888);
  g.position.set(x, h / 2, z);
  g.rotation.z = (tilt || 0) + (Math.random() - 0.5) * 0.1;
  g.rotation.y = Math.random() * Math.PI;
  return g;
}

// Campfire
export function campfire(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const ring = mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.15, 12), 0x888888);
  ring.position.y = 0.07;
  g.add(ring);
  const log1 = vbox(0.15, 0.15, 0.7, 0x5c3a1e); log1.position.y = 0.14; log1.rotation.y = 0.5; g.add(log1);
  const log2 = vbox(0.15, 0.15, 0.7, 0x5c3a1e); log2.position.y = 0.14; log2.rotation.y = -0.5; g.add(log2);
  const glow = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 6),
    new THREE.MeshLambertMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })
  );
  glow.position.y = 0.4;
  g.add(glow);
  const light = new THREE.PointLight(0xff6600, 1.5, 8);
  light.position.y = 0.5;
  g.add(light);
  return g;
}

// Road marking
export function roadMarkings(scene, x, z, w, l, horizontal) {
  const dashes = Math.floor(l / 3);
  for (let i = 0; i < dashes; i++) {
    const mark = vbox(horizontal ? 1.2 : 0.15, 0.02, horizontal ? 0.15 : 1.2, 0xffffff);
    mark.position.set(
      x + (horizontal ? -l / 2 + i * (l / dashes) + 0.6 : 0),
      0.03,
      z + (horizontal ? 0 : -l / 2 + i * (l / dashes) + 0.6)
    );
    scene.add(mark);
  }
}

// Street light
export function streetLight(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = vbox(0.12, 4, 0.12, 0x555566); pole.position.y = 2;
  const arm  = vbox(1.5, 0.1, 0.1, 0x555566); arm.position.set(0.7, 4.05, 0);
  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.2, 0.3),
    new THREE.MeshLambertMaterial({ color: 0xffffaa, emissive: 0xffff88, emissiveIntensity: 1 })
  );
  bulb.position.set(1.4, 3.95, 0);
  g.add(pole, arm, bulb);
  const l = new THREE.PointLight(0xffffaa, 0.8, 12);
  l.position.set(1.4, 3.9, 0);
  g.add(l);
  return g;
}
