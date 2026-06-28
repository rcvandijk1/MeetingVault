import * as THREE from 'three';
import { vbox, tree } from '../building-utils.js';

// Deterministic per-chunk seeded random
function sr(cx, cz, i) {
  let h = ((cx * 1337 + cz * 4201 + i * 7919) & 0x7fffffff);
  h = (((h >> 16) ^ h) * 0x45d9f3b) & 0x7fffffff;
  h = (((h >> 16) ^ h) * 0x45d9f3b) & 0x7fffffff;
  return ((h >> 16) ^ h & 0x7fffffff) / 0x7fffffff;
}

function flat(cx, cz, size, color) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size + 1, size + 1),
    new THREE.MeshLambertMaterial({ color })
  );
  m.rotation.x = -Math.PI / 2;
  return m;
}

// ─────────────────────── BIOME DEFINITIONS ────────────────────────────────

const GRASSLAND = {
  id: 'grassland', name: 'Grassland', emoji: '🌿',
  pressure: { skinDrift: 0.42 },
  groundColor: 0x4a8c3f, fogColor: 0x87ceeb, fogDensity: 0.002, moodBonus: 0.05,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x4a8c3f));
    for (let i = 0; i < 9; i++) {
      const t = tree(0, 0);
      t.position.set((sr(cx,cz,i*3)-0.5)*s*0.82, 0, (sr(cx,cz,i*3+1)-0.5)*s*0.82);
      g.add(t);
    }
    for (let i = 0; i < 6; i++) {
      const r = vbox(0.7+sr(cx,cz,60+i)*0.6, 0.5+sr(cx,cz,70+i)*0.4, 0.7+sr(cx,cz,80+i)*0.5, 0x887755);
      r.position.set((sr(cx,cz,50+i)-0.5)*s*0.75, 0.25, (sr(cx,cz,90+i)-0.5)*s*0.75);
      g.add(r);
    }
    return g;
  }
};

const FOREST = {
  id: 'forest', name: 'Dense Forest', emoji: '🌲',
  pressure: { skinDrift: 0.48 },
  groundColor: 0x2d4a1a, fogColor: 0x3a5c28, fogDensity: 0.006, moodBonus: 0.02,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x2d4a1a));
    for (let i = 0; i < 28; i++) {
      const t = tree(0, 0);
      t.scale.setScalar(0.9 + sr(cx,cz,i*3+2)*0.9);
      t.position.set((sr(cx,cz,i*3)-0.5)*s*0.88, 0, (sr(cx,cz,i*3+1)-0.5)*s*0.88);
      g.add(t);
    }
    for (let i = 0; i < 18; i++) {
      const b = vbox(0.5+sr(cx,cz,100+i)*0.4, 0.4+sr(cx,cz,120+i)*0.3, 0.5+sr(cx,cz,110+i)*0.4, 0x3a7a25);
      b.position.set((sr(cx,cz,130+i)-0.5)*s*0.84, 0.2, (sr(cx,cz,140+i)-0.5)*s*0.84);
      g.add(b);
    }
    return g;
  }
};

const DESERT = {
  id: 'desert', name: 'Desert', emoji: '🏜️',
  pressure: { heat: true, skinDrift: 0.85 },
  groundColor: 0xd4a857, fogColor: 0xffe0a0, fogDensity: 0.003, moodBonus: -0.1,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0xd4a857));
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(10+sr(cx,cz,i)*8, 1.2+sr(cx,cz,i+10)*0.8, 7+sr(cx,cz,i+20)*5),
        new THREE.MeshLambertMaterial({ color: 0xbc9040 }));
      d.position.set((sr(cx,cz,30+i)-0.5)*s*0.65, 0.6, (sr(cx,cz,40+i)-0.5)*s*0.65);
      g.add(d);
    }
    for (let i = 0; i < 5; i++) {
      const cg = new THREE.Group();
      const h = 1.5 + sr(cx,cz,60+i);
      const tr = vbox(0.38, h*2, 0.38, 0x3a7a25);
      tr.position.y = h;
      cg.add(tr);
      const arm = vbox(1.4, 0.3, 0.35, 0x3a7a25);
      arm.position.set(0, h*0.85, 0);
      cg.add(arm);
      cg.position.set((sr(cx,cz,70+i)-0.5)*s*0.72, 0, (sr(cx,cz,80+i)-0.5)*s*0.72);
      g.add(cg);
    }
    return g;
  }
};

const MOUNTAIN = {
  id: 'mountain', name: 'Mountains', emoji: '⛰️',
  pressure: { alt: true, cold: true, skinDrift: 0.28 },
  groundColor: 0x777777, fogColor: 0xccccdd, fogDensity: 0.004, moodBonus: -0.05,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x777777));
    for (let i = 0; i < 5; i++) {
      const h = 5 + sr(cx,cz,i*3+2)*10;
      const p = new THREE.Mesh(new THREE.ConeGeometry(3+sr(cx,cz,i*3)*2, h, 6),
        new THREE.MeshLambertMaterial({ color: 0x666666 }));
      p.position.set((sr(cx,cz,i*3)-0.5)*s*0.65, h/2, (sr(cx,cz,i*3+1)-0.5)*s*0.65);
      g.add(p);
      const sn = new THREE.Mesh(new THREE.ConeGeometry(1.4+sr(cx,cz,i*3), h*0.28, 6),
        new THREE.MeshLambertMaterial({ color: 0xffffff }));
      sn.position.set(p.position.x, h*0.87, p.position.z);
      g.add(sn);
    }
    for (let i = 0; i < 10; i++) {
      const r = vbox(1.3+sr(cx,cz,50+i)*1.2, 0.8+sr(cx,cz,60+i)*0.7, 1.3+sr(cx,cz,55+i)*0.9, 0x666666);
      r.position.set((sr(cx,cz,70+i)-0.5)*s*0.85, 0.4, (sr(cx,cz,80+i)-0.5)*s*0.85);
      g.add(r);
    }
    return g;
  }
};

const TUNDRA = {
  id: 'tundra', name: 'Frozen Tundra', emoji: '🌨️',
  pressure: { cold: true, skinDrift: 0.18 },
  groundColor: 0xcdd8e2, fogColor: 0xd0e0f0, fogDensity: 0.007, moodBonus: -0.15,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0xcdd8e2));
    for (let i = 0; i < 9; i++) {
      const ic = new THREE.Mesh(new THREE.BoxGeometry(4+sr(cx,cz,i*2)*5, 0.28, 3+sr(cx,cz,i*2+1)*4),
        new THREE.MeshLambertMaterial({ color: 0xb8d4ee, transparent: true, opacity: 0.82 }));
      ic.position.set((sr(cx,cz,i*2)-0.5)*s*0.82, 0.14, (sr(cx,cz,i*2+1)-0.5)*s*0.82);
      g.add(ic);
    }
    for (let i = 0; i < 6; i++) {
      const h = 2.5 + sr(cx,cz,50+i);
      const tr = vbox(0.22, h, 0.22, 0x3a2510);
      tr.position.set((sr(cx,cz,60+i)-0.5)*s*0.78, h/2, (sr(cx,cz,70+i)-0.5)*s*0.78);
      g.add(tr);
    }
    return g;
  }
};

const JUNGLE = {
  id: 'jungle', name: 'Jungle', emoji: '🌴',
  pressure: { heat: true, aqua: true, skinDrift: 0.72 },
  groundColor: 0x1a3a10, fogColor: 0x2a5020, fogDensity: 0.008, moodBonus: 0.0,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x1a3a10));
    for (let i = 0; i < 32; i++) {
      const h = 5 + sr(cx,cz,i*3+2)*7;
      const tr = vbox(0.38+sr(cx,cz,i*3+2)*0.18, h, 0.38+sr(cx,cz,i*3+2)*0.18, 0x3d2b10);
      tr.position.set((sr(cx,cz,i*3)-0.5)*s*0.9, h/2, (sr(cx,cz,i*3+1)-0.5)*s*0.9);
      g.add(tr);
      const cn = new THREE.Mesh(new THREE.SphereGeometry(1.8+sr(cx,cz,i*3+2)*1.5, 6, 4),
        new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.27+sr(cx,cz,i)*0.07, 0.7, 0.22) }));
      cn.position.set(tr.position.x, h+1.2, tr.position.z);
      g.add(cn);
    }
    return g;
  }
};

const SWAMP = {
  id: 'swamp', name: 'Swamp', emoji: '🐸',
  pressure: { aqua: true, skinDrift: 0.62 },
  groundColor: 0x2d3a1a, fogColor: 0x3a4820, fogDensity: 0.012, moodBonus: -0.2,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x2d3a1a));
    for (let i = 0; i < 6; i++) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(5+sr(cx,cz,i*2)*8, 4+sr(cx,cz,i*2+1)*5),
        new THREE.MeshLambertMaterial({ color: 0x1a3515, transparent: true, opacity: 0.72 }));
      pool.rotation.x = -Math.PI/2;
      pool.position.set((sr(cx,cz,i*2)-0.5)*s*0.68, 0.04, (sr(cx,cz,i*2+1)-0.5)*s*0.68);
      g.add(pool);
    }
    for (let i = 0; i < 14; i++) {
      const h = 2.5 + sr(cx,cz,40+i*2)*2;
      const tr = vbox(0.32, h, 0.32, 0x2a1a08);
      const px = (sr(cx,cz,40+i*2)-0.5)*s*0.85;
      const pz = (sr(cx,cz,50+i)-0.5)*s*0.85;
      tr.position.set(px, h/2, pz);
      tr.rotation.z = (sr(cx,cz,60+i)-0.5)*0.45;
      g.add(tr);
      const cn = vbox(1.8+sr(cx,cz,70+i), 0.7, 1.8+sr(cx,cz,70+i), 0x2a4a15);
      cn.position.set(px + (sr(cx,cz,80+i)-0.5)*0.8, h + 0.35, pz);
      g.add(cn);
    }
    return g;
  }
};

const VOLCANIC = {
  id: 'volcanic', name: 'Volcanic Wastes', emoji: '🌋',
  pressure: { heat: true, skinDrift: 0.78 },
  groundColor: 0x1a0a00, fogColor: 0x3a1a00, fogDensity: 0.009, moodBonus: -0.3,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0x1a0a00));
    for (let i = 0; i < 9; i++) {
      const len = 8 + sr(cx,cz,i*3)*18;
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.35+sr(cx,cz,i*3+1)*0.3),
        new THREE.MeshBasicMaterial({ color: 0xff3a00 }));
      crack.rotation.x = -Math.PI/2;
      crack.rotation.z = sr(cx,cz,i*3+2)*Math.PI;
      crack.position.set((sr(cx,cz,30+i)-0.5)*s*0.68, 0.01, (sr(cx,cz,40+i)-0.5)*s*0.68);
      g.add(crack);
      if (i < 4) {
        const l = new THREE.PointLight(0xff3300, 1.2, 12);
        l.position.set(crack.position.x, 0.5, crack.position.z);
        g.add(l);
      }
    }
    for (let i = 0; i < 8; i++) {
      const r = vbox(1+sr(cx,cz,100+i)*2, 0.8+sr(cx,cz,110+i), 1+sr(cx,cz,120+i), 0x2a1200);
      r.position.set((sr(cx,cz,130+i)-0.5)*s*0.8, 0.4, (sr(cx,cz,140+i)-0.5)*s*0.8);
      g.add(r);
    }
    return g;
  }
};

const COASTAL = {
  id: 'coastal', name: 'Coastal', emoji: '🏖️',
  pressure: { aqua: true, skinDrift: 0.55 },
  groundColor: 0xd4c07a, fogColor: 0x8ab8d0, fogDensity: 0.002, moodBonus: 0.08,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0xd4c07a));
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(s+1, s*0.42),
      new THREE.MeshLambertMaterial({ color: 0x2255aa, transparent: true, opacity: 0.8 }));
    ocean.rotation.x = -Math.PI/2;
    ocean.position.set(0, 0.04, -s*0.29);
    g.add(ocean);
    for (let i = 0; i < 7; i++) {
      const palm = new THREE.Group();
      const h = 4 + sr(cx,cz,i*2);
      const tr = vbox(0.32, h, 0.32, 0x7a5530);
      tr.position.y = h/2;
      palm.add(tr);
      const fr = vbox(3+sr(cx,cz,i*2), 0.28, 3+sr(cx,cz,i*2), 0x2d7a20);
      fr.position.y = h+0.14;
      palm.add(fr);
      palm.position.set((sr(cx,cz,10+i*2)-0.5)*s*0.65, 0, (sr(cx,cz,10+i*2+1)-0.5)*s*0.28+6);
      g.add(palm);
    }
    return g;
  }
};

const ARCTIC = {
  id: 'arctic', name: 'Arctic Ice', emoji: '🧊',
  pressure: { cold: true, skinDrift: 0.12 },
  groundColor: 0xeef5ff, fogColor: 0xddeeff, fogDensity: 0.005, moodBonus: -0.22,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0xeef5ff));
    for (let i = 0; i < 7; i++) {
      const h = 3 + sr(cx,cz,i*3+2)*6;
      const ib = new THREE.Mesh(new THREE.ConeGeometry(2+sr(cx,cz,i*3)*1.8, h, 5),
        new THREE.MeshLambertMaterial({ color: 0xc8e0ff, transparent: true, opacity: 0.88 }));
      ib.position.set((sr(cx,cz,i*3)-0.5)*s*0.72, h/2, (sr(cx,cz,i*3+1)-0.5)*s*0.72);
      g.add(ib);
    }
    return g;
  }
};

const SAVANNA = {
  id: 'savanna', name: 'Savanna', emoji: '🦒',
  pressure: { heat: true, skinDrift: 0.82 },
  groundColor: 0xc8a84a, fogColor: 0xd4b870, fogDensity: 0.002, moodBonus: 0.0,
  buildTerrain(cx, cz, s) {
    const g = new THREE.Group();
    g.add(flat(cx, cz, s, 0xc8a84a));
    for (let i = 0; i < 9; i++) {
      const ac = new THREE.Group();
      const h = 3 + sr(cx,cz,i*3+2);
      const tr = vbox(0.28, h, 0.28, 0x7a5020);
      tr.position.y = h/2;
      ac.add(tr);
      const cn = new THREE.Mesh(new THREE.CylinderGeometry(2.8+sr(cx,cz,i*3+2), 2+sr(cx,cz,i*3+2), 0.65, 8),
        new THREE.MeshLambertMaterial({ color: 0x4a7a20 }));
      cn.position.y = h + 0.32;
      ac.add(cn);
      ac.position.set((sr(cx,cz,i*3)-0.5)*s*0.8, 0, (sr(cx,cz,i*3+1)-0.5)*s*0.8);
      g.add(ac);
    }
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(3+sr(cx,cz,100+i)*3, 2+sr(cx,cz,110+i)*2),
        new THREE.MeshLambertMaterial({ color: 0xb89030 }));
      p.rotation.x = -Math.PI/2;
      p.position.set((sr(cx,cz,120+i)-0.5)*s*0.85, 0.01, (sr(cx,cz,130+i)-0.5)*s*0.85);
      g.add(p);
    }
    return g;
  }
};

const ALL_BIOMES = [
  GRASSLAND, FOREST, DESERT, MOUNTAIN, TUNDRA,
  JUNGLE, SWAMP, VOLCANIC, COASTAL, ARCTIC, SAVANNA
];

// Deterministic biome hash
function biomeHash(cx, cz) {
  let h = ((cx * 1337 + cz * 4201) & 0x7fffffff);
  h = (((h >> 16) ^ h) * 0x45d9f3b) & 0x7fffffff;
  return ((h >> 16) ^ h & 0x7fffffff) / 0x7fffffff;
}

export function getBiome(cx, cz) {
  if (cx === 0 && cz === 0) return GRASSLAND;
  const dist = Math.sqrt(cx * cx + cz * cz);
  const frac = biomeHash(cx, cz);
  // Near origin: gentle biomes only
  if (dist <= 1.5) {
    const gentle = [GRASSLAND, GRASSLAND, FOREST, COASTAL, SAVANNA];
    return gentle[Math.floor(frac * gentle.length)];
  }
  if (dist <= 3) {
    const mid = [GRASSLAND, FOREST, DESERT, COASTAL, SAVANNA, JUNGLE, TUNDRA];
    return mid[Math.floor(frac * mid.length)];
  }
  return ALL_BIOMES[Math.floor(frac * ALL_BIOMES.length)];
}

export { ALL_BIOMES };
