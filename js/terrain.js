import * as THREE from 'three';

export function buildTerrain(scene) {
  const group = new THREE.Group();

  // Ground
  const groundGeo = new THREE.PlaneGeometry(200, 200, 40, 40);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x6aaa55 });
  // Slightly vary vertex heights
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getY(i); // PlaneGeometry uses X/Y before rotation
    if (Math.abs(x) < 40 && Math.abs(z) < 40) continue; // keep center flat
    pos.setZ(i, (Math.random() - 0.5) * 0.3);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Dirt paths - simple flattened boxes
  const pathMat = new THREE.MeshLambertMaterial({ color: 0xc4a265 });
  const paths = [
    { x: 0,   z: -20, w: 4, l: 40 },   // north-south main road
    { x: 0,   z: 10,  w: 60, l: 4 },   // east-west road
    { x: -18, z: -12, w: 4, l: 20 },   // to bakery/weavery
    { x: 18,  z: -12, w: 4, l: 20 },   // to smithy/pottery
    { x: -10, z: 22,  w: 4, l: 30 },   // to dock
    { x: 25,  z: 13,  w: 4, l: 20 },   // to pasture
  ];
  for (const p of paths) {
    const pg = new THREE.BoxGeometry(p.w, 0.05, p.l);
    const pm = new THREE.Mesh(pg, pathMat);
    pm.position.set(p.x, 0.01, p.z);
    pm.receiveShadow = true;
    group.add(pm);
  }

  // Market square cobblestones
  const squareGeo = new THREE.BoxGeometry(22, 0.05, 22);
  const squareMat = new THREE.MeshLambertMaterial({ color: 0xb09070 });
  const square = new THREE.Mesh(squareGeo, squareMat);
  square.position.set(0, 0.01, 0);
  group.add(square);

  // Pond/water
  const pondGeo = new THREE.CircleGeometry(8, 16);
  const pondMat = new THREE.MeshPhongMaterial({ color: 0x3399cc, transparent: true, opacity: 0.8 });
  const pond = new THREE.Mesh(pondGeo, pondMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-15, 0.05, 42);
  group.add(pond);

  // Fields (darker green strips)
  const fieldMat = new THREE.MeshLambertMaterial({ color: 0x7ab648 });
  for (let i = 0; i < 4; i++) {
    const fg = new THREE.BoxGeometry(12, 0.05, 6);
    const fm = new THREE.Mesh(fg, fieldMat);
    fm.position.set(-9 + i * 13, 0.02, -40);
    fm.receiveShadow = true;
    group.add(fm);
  }

  // Trees
  _addTrees(group, scene);

  scene.add(group);
  return group;
}

function _addTrees(group) {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7b5226 });
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x1b5e20 });

  const positions = [
    // Forest cluster east
    [35,-28],[38,-32],[42,-26],[34,-35],[40,-38],[36,-22],[44,-33],
    // Decorative village trees
    [-8,-12],[8,-12],[-14,4],[14,4],[-6,6],[6,6],
    // Around pond
    [-22,38],[-8,46],[-20,48],[-10,38],
    // Edge trees
    [-45,0],[-45,20],[45,5],[45,-15],[-30,-45],[30,-42],
  ];

  for (const [x, z] of positions) {
    const h = 3 + Math.random() * 2;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h * 0.4, 6), trunkMat);
    trunk.position.set(x, h * 0.2, z);
    trunk.castShadow = true;
    group.add(trunk);

    // Voxel-style foliage (stacked boxes = pixel art look)
    const layers = Math.floor(2 + Math.random() * 2);
    for (let l = 0; l < layers; l++) {
      const s = (layers - l) * 1.2 + 0.5;
      const mat = l % 2 === 0 ? leavesMat : foliageMat;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(s, 1, s), mat);
      leaf.position.set(x, h * 0.4 + l * 0.9, z);
      leaf.castShadow = true;
      group.add(leaf);
    }
  }

  // Rocks
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  for (let i = 0; i < 12; i++) {
    const rx = (Math.random() - 0.5) * 160;
    const rz = (Math.random() - 0.5) * 160;
    if (Math.abs(rx) < 25 && Math.abs(rz) < 25) continue;
    const rs = 0.3 + Math.random() * 0.7;
    const rock = new THREE.Mesh(new THREE.BoxGeometry(rs, rs * 0.6, rs), rockMat);
    rock.position.set(rx, rs * 0.3, rz);
    rock.rotation.y = Math.random() * Math.PI;
    group.add(rock);
  }
}
