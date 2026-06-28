import * as THREE from 'three';

function box(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function roof(w, d, color) {
  const geo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, 2.5, 4);
  const mat = new THREE.MeshLambertMaterial({ color });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.y = Math.PI / 4;
  mesh.castShadow = true;
  return mesh;
}

function building(x, z, w, d, wallH, wallColor, roofColor, label) {
  const g = new THREE.Group();
  g.userData.label = label;
  g.position.set(x, 0, z);

  const wall = box(w, wallH, d, wallColor);
  wall.position.y = wallH / 2;
  g.add(wall);

  const r = roof(w, d, roofColor);
  r.position.y = wallH + 1.0;
  g.add(r);

  // Door
  const door = box(0.8, 1.4, 0.1, 0x5c3a1e);
  door.position.set(0, 0.7, d / 2 + 0.01);
  g.add(door);

  // Window
  const win = box(0.7, 0.6, 0.1, 0xaaddff);
  win.position.set(w * 0.25, wallH * 0.6, d / 2 + 0.01);
  g.add(win);

  return g;
}

export function buildVillage(scene) {
  const buildings = {};

  const defs = [
    // Market stalls (center)
    { key:'market_stall_1', x: -5,  z: -2,  w: 3, d: 2, h: 2.5, wall: 0xf5deb3, roof: 0xcc4444, label: 'Market Stall' },
    { key:'market_stall_2', x:  5,  z: -2,  w: 3, d: 2, h: 2.5, wall: 0xf5deb3, roof: 0x4444cc, label: 'Market Stall' },
    { key:'market_stall_3', x:  0,  z:  5,  w: 3, d: 2, h: 2.5, wall: 0xf5deb3, roof: 0x44aa44, label: 'Market Stall' },
    // Well
    { key:'well', x: -4, z: -4, w: 1.5, d: 1.5, h: 1.5, wall: 0x999999, roof: 0x8b4513, label: 'Well' },
    // Smithy
    { key:'smithy', x: 18, z: -5, w: 8, d: 7, h: 4.5, wall: 0x555555, roof: 0x333333, label: 'Smithy' },
    // Bakery
    { key:'bakery', x: -18, z: -5, w: 7, d: 6, h: 4, wall: 0xf0e0c0, roof: 0xcc7733, label: 'Bakery' },
    // Tavern (larger)
    { key:'tavern', x: 2, z: 16, w: 10, d: 8, h: 5, wall: 0xd2a679, roof: 0x8b2500, label: 'Tavern' },
    // Healer's hut
    { key:'healers_hut', x: -26, z: 10, w: 6, d: 5, h: 3.5, wall: 0xeeeedd, roof: 0x779977, label: "Healer's Hut" },
    // Pottery
    { key:'pottery', x: 26, z: 6, w: 6, d: 5, h: 3.5, wall: 0xd4935a, roof: 0xaa6633, label: 'Pottery' },
    // Weavery
    { key:'weavery', x: -22, z: -18, w: 7, d: 5, h: 3.5, wall: 0xddccee, roof: 0x9966aa, label: 'Weavery' },
    // Dock house
    { key:'dock', x: -10, z: 36, w: 6, d: 5, h: 3, wall: 0xc8a870, roof: 0x5c3a1e, label: 'Dock House' },
    // Homes
    { key:'home_1',  x: -12, z:  8,  w: 5, d: 4, h: 3.5, wall: 0xe8d5b7, roof: 0xaa3333, label: 'Home' },
    { key:'home_2',  x:  12, z:  8,  w: 5, d: 4, h: 3.5, wall: 0xd7e8b7, roof: 0x337733, label: 'Home' },
    { key:'home_3',  x: -14, z: 22,  w: 5, d: 4, h: 3.5, wall: 0xe8e2b7, roof: 0x887733, label: 'Home' },
    { key:'home_4',  x:  14, z: 22,  w: 5, d: 4, h: 3.5, wall: 0xb7d5e8, roof: 0x336688, label: 'Home' },
    { key:'home_5',  x:  -6, z: 28,  w: 5, d: 4, h: 3.5, wall: 0xe8c0b7, roof: 0x883333, label: 'Home' },
    { key:'home_6',  x:   8, z: 28,  w: 5, d: 4, h: 3.5, wall: 0xd0e8b7, roof: 0x558833, label: 'Home' },
    { key:'home_7',  x: -24, z:  0,  w: 5, d: 4, h: 3.5, wall: 0xe8d0b7, roof: 0xaa6633, label: 'Home' },
    { key:'home_8',  x:  24, z: -2,  w: 5, d: 4, h: 3.5, wall: 0xb7c8e8, roof: 0x4455aa, label: 'Home' },
    { key:'home_9',  x:  -4, z:-16,  w: 5, d: 4, h: 3.5, wall: 0xe8d5c8, roof: 0x996644, label: 'Home' },
    { key:'home_10', x:   6, z:-16,  w: 5, d: 4, h: 3.5, wall: 0xc8e8d5, roof: 0x449966, label: 'Home' },
    { key:'home_11', x: -30, z: 22,  w: 5, d: 4, h: 3.5, wall: 0xe8d5b7, roof: 0xaa5522, label: 'Home' },
    { key:'home_12', x:  32, z: 10,  w: 5, d: 4, h: 3.5, wall: 0xd5e8b7, roof: 0x557733, label: 'Home' },
    // Barn / fields shelter
    { key:'fields_barn', x: 0, z: -36, w: 8, d: 6, h: 4, wall: 0xc8a060, roof: 0x663300, label: 'Barn' },
    // Pasture fence-house
    { key:'pasture_shed', x: 28, z: 20, w: 6, d: 5, h: 3, wall: 0xbba080, roof: 0x664422, label: 'Pasture Shed' },
  ];

  for (const d of defs) {
    const b = building(d.x, d.z, d.w, d.d, d.h, d.wall, d.roof, d.label);
    scene.add(b);
    buildings[d.key] = b;
  }

  // Market sign post
  const signPost = box(0.15, 3, 0.15, 0x8b4513);
  signPost.position.set(0, 1.5, -8);
  scene.add(signPost);
  const sign = box(2, 0.8, 0.1, 0xf5deb3);
  sign.position.set(0, 3.2, -8);
  scene.add(sign);

  // Smithy chimney (larger box sticking up)
  const chimney = box(0.8, 3, 0.8, 0x444444);
  chimney.position.set(18 + 2, 6, -5);
  scene.add(chimney);

  // Bakery oven chimney
  const oven = box(0.7, 2, 0.7, 0x888888);
  oven.position.set(-18 + 2, 5.2, -5);
  scene.add(oven);

  // Dock pier
  const pier = box(1.5, 0.3, 12, 0x8b5e2a);
  pier.position.set(-10, 0.15, 43);
  scene.add(pier);

  // Fence posts around pasture
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0x9b7b5b });
  const pastureCorners = [
    [22,14],[28,14],[34,14],[34,20],[34,26],[28,26],[22,26],[22,20]
  ];
  for (const [fx, fz] of pastureCorners) {
    const post = box(0.2, 1.2, 0.2, 0x9b7b5b);
    post.position.set(fx, 0.6, fz);
    scene.add(post);
  }

  return buildings;
}
