import * as THREE from 'three';
import { ground, caveEntrance, standingStone, campfire, tree, vbox } from '../building-utils.js';

export default {
  id: 'stone-age',
  name: 'Stone Age',
  subtitle: '~10,000 BC',
  emoji: '🦕',
  economyLabel: 'Barter',
  moodLabel: 'Spirit',

  careers: [
    {
      id: 'hunter', name: 'Hunter', emoji: '🏹',
      produces: { meat: 3, leather: 2 }, needs: ['berries', 'tools'],
      workplace: 'hunt_grounds', workStart: 5, workEnd: 14,
      appearance: {
        skinColor: 0xc4835a, topColor: 0x7a5030, bottomColor: 0x5c3a18,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.06, 0.75, 0.06], color: 0x8b4513, pos: [0.42, 0.7, 0.05], rot: [0.2, 0, 0.1] }
        ]
      }
    },
    {
      id: 'gatherer', name: 'Gatherer', emoji: '🌿',
      produces: { berries: 3, roots: 2, mushrooms: 1 }, needs: ['meat', 'tools'],
      workplace: 'forest_edge', workStart: 7, workEnd: 17,
      appearance: {
        skinColor: 0xd4a06a, topColor: 0x6b7c3a, bottomColor: 0x5c4a2a,
        hat: { w: 0.55, h: 0.2, d: 0.55, color: 0x5a7230, brim: { w: 0.85, d: 0.85 } },
        accessories: [
          { geo: 'box', size: [0.26, 0.26, 0.18], color: 0x8b6914, pos: [0.4, 0.58, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'shaman', name: 'Shaman', emoji: '🔮',
      produces: { remedy: 2, blessing: 1 }, needs: ['meat', 'berries', 'mushrooms'],
      workplace: 'shaman_cave', workStart: 8, workEnd: 22,
      appearance: {
        skinColor: 0xb87040, topColor: 0x4a2d6b, bottomColor: 0x2a1a0e,
        hat: { w: 0.48, h: 0.55, d: 0.48, color: 0x3a1a55 },
        accessories: [
          { geo: 'box', size: [0.07, 0.85, 0.07], color: 0x7a5030, pos: [0.42, 0.78, 0.05], rot: [0.1, 0, 0] },
          { geo: 'box', size: [0.25, 0.04, 0.04], color: 0xf0e0b0, pos: [0, 1.7, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'toolmaker', name: 'Toolmaker', emoji: '🪨',
      produces: { tools: 3, spearhead: 2 }, needs: ['meat', 'leather', 'berries'],
      workplace: 'bone_workshop', workStart: 7, workEnd: 16,
      appearance: {
        skinColor: 0xc4835a, topColor: 0xd4a853, bottomColor: 0x7a5030,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.28, 0.12, 0.1], color: 0x999999, pos: [0.42, 0.68, 0.05], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'firekeeper', name: 'Firekeeper', emoji: '🔥',
      produces: { fire: 2, charcoal: 2 }, needs: ['meat', 'roots'],
      workplace: 'fire_pit', workStart: 5, workEnd: 23,
      appearance: {
        skinColor: 0xd48050, topColor: 0xcc5500, bottomColor: 0x6b2200,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.08, 0.65, 0.08], color: 0x8b4513, pos: [0.42, 0.68, 0.1], rot: [0.15, 0, 0] },
          { geo: 'box', size: [0.12, 0.2, 0.12], color: 0xff6600, pos: [0.42, 1.05, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'painter', name: 'Painter', emoji: '🎨',
      produces: { pigment: 2, art: 1 }, needs: ['berries', 'meat', 'remedy'],
      workplace: 'shaman_cave', workStart: 9, workEnd: 17,
      appearance: {
        skinColor: 0xf0b870, topColor: 0xcc8844, bottomColor: 0x8b5e2a,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.22, 0.22, 0.1], color: 0xcc4422, pos: [-0.38, 0.68, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'tracker', name: 'Tracker', emoji: '👣',
      produces: { scouting: 2 }, needs: ['meat', 'leather', 'tools'],
      workplace: 'deep_forest', workStart: 5, workEnd: 13,
      appearance: {
        skinColor: 0xb87040, topColor: 0x3a5c2a, bottomColor: 0x2a3c1a,
        hat: { w: 0.5, h: 0.26, d: 0.5, color: 0x2a3c1a },
        accessories: [
          { geo: 'box', size: [0.06, 0.7, 0.06], color: 0x8b6914, pos: [0.42, 0.7, 0.05], rot: [-0.3, 0, 0.1] }
        ]
      }
    },
    {
      id: 'tanner', name: 'Hide Tanner', emoji: '🧶',
      produces: { clothing: 2, hide: 3 }, needs: ['meat', 'tools', 'charcoal'],
      workplace: 'bone_workshop', workStart: 8, workEnd: 17,
      appearance: {
        skinColor: 0xc4835a, topColor: 0xc4956a, bottomColor: 0x8b6040,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.22, 0.06, 0.18], color: 0xd4a870, pos: [0, 0.72, 0.2], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'elder', name: 'Elder', emoji: '🧙',
      produces: { wisdom: 1 }, needs: ['meat', 'berries', 'remedy', 'clothing'],
      workplace: 'sacred_circle', workStart: 9, workEnd: 18,
      appearance: {
        skinColor: 0xb87040, topColor: 0x8a7a6a, bottomColor: 0x5a4a3a,
        hat: { w: 0.52, h: 0.18, d: 0.52, color: 0x6a5a4a },
        accessories: [
          { geo: 'box', size: [0.08, 0.9, 0.08], color: 0x9b7b5b, pos: [0.42, 0.75, 0.05], rot: [0.05, 0, 0.05] },
          { geo: 'box', size: [0.35, 0.04, 0.04], color: 0xf0e0b0, pos: [0, 1.72, 0.12], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'fisher', name: 'Fisher', emoji: '🎣',
      produces: { fish: 4 }, needs: ['tools', 'berries'],
      workplace: 'river', workStart: 5, workEnd: 14,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x4a6a7a, bottomColor: 0x1a3a4a,
        hat: { w: 0.5, h: 0.2, d: 0.5, color: 0x3a5a6a },
        accessories: [
          { geo: 'box', size: [0.05, 0.75, 0.05], color: 0x8b5e2a, pos: [0.42, 0.8, 0.05], rot: [-0.3, 0, -0.1] }
        ]
      }
    }
  ],

  waypoints: {
    sacred_circle:  { x:  0,  z:  0 },
    fire_pit:       { x:  0,  z: 12 },
    bone_workshop:  { x: 20,  z:  6 },
    shaman_cave:    { x:-24,  z: -8 },
    cave_entrance:  { x: -5,  z:-22 },
    hunt_grounds:   { x: -5,  z:-40 },
    forest_edge:    { x: 28,  z:-18 },
    deep_forest:    { x: 38,  z:-28 },
    river:          { x:-12,  z: 42 },
    water_hole:     { x:-15,  z: 32 },
    grazing_plain:  { x: 26,  z: 20 },
    home_cave_1:    { x:-12,  z:  8 },
    home_cave_2:    { x: 12,  z:  8 },
    home_cave_3:    { x:-14,  z: 22 },
    home_cave_4:    { x: 14,  z: 22 },
    home_cave_5:    { x: -6,  z: 28 },
    home_cave_6:    { x:  8,  z: 28 },
    home_cave_7:    { x:-24,  z:  2 },
    home_cave_8:    { x: 24,  z: -2 },
    home_cave_9:    { x: -4,  z:-14 },
    home_cave_10:   { x:  6,  z:-14 },
    home_cave_11:   { x:-30,  z: 22 },
    home_cave_12:   { x: 32,  z: 10 },
  },

  edges: [
    ['sacred_circle','fire_pit'],['sacred_circle','bone_workshop'],['sacred_circle','shaman_cave'],
    ['sacred_circle','cave_entrance'],['sacred_circle','home_cave_1'],['sacred_circle','home_cave_2'],
    ['fire_pit','water_hole'],['fire_pit','home_cave_3'],['fire_pit','home_cave_4'],
    ['fire_pit','home_cave_5'],['fire_pit','home_cave_6'],['fire_pit','grazing_plain'],
    ['bone_workshop','home_cave_8'],['bone_workshop','forest_edge'],['bone_workshop','grazing_plain'],
    ['shaman_cave','home_cave_7'],['shaman_cave','home_cave_11'],['shaman_cave','cave_entrance'],
    ['cave_entrance','hunt_grounds'],['cave_entrance','home_cave_9'],['cave_entrance','home_cave_10'],
    ['hunt_grounds','forest_edge'],['forest_edge','deep_forest'],
    ['water_hole','river'],['water_hole','home_cave_5'],
    ['river','home_cave_5'],['river','home_cave_6'],
    ['grazing_plain','home_cave_12'],['grazing_plain','home_cave_4'],
    ['home_cave_11','home_cave_7'],['home_cave_12','home_cave_8'],
  ],

  weatherOptions: [
    { id: 'clear',       label: '☀️ Clear',     particleType: null,  speedMult: 1.0, fogColor: 0x8899bb, fogNear: 70, fogFar: 180, shelter: false },
    { id: 'rain',        label: '🌧 Rain',       particleType: 'rain', speedMult: 0.7, fogColor: 0x667799, fogNear: 40, fogFar: 110, shelter: true  },
    { id: 'blizzard',    label: '❄️ Blizzard',   particleType: 'snow', speedMult: 0.35, fogColor: 0xaabbcc, fogNear: 15, fogFar: 60, shelter: true },
    { id: 'volcanic_ash',label: '🌋 Ash Cloud',  particleType: 'ash',  speedMult: 0.5, fogColor: 0x886644, fogNear: 20, fogFar: 70,  shelter: false },
    { id: 'fog',         label: '🌫 Fog',        particleType: null,  speedMult: 0.6, fogColor: 0xaaaaaa, fogNear: 5,  fogFar: 35,  shelter: false },
  ],

  disasters: [
    { id: 'predator',   label: '🦁 Predator Attack!', state: 'fleeing' },
    { id: 'volcano',    label: '🌋 Volcanic Eruption!', state: 'fleeing' },
    { id: 'meteor',     label: '☄️ Meteor Shower!', state: 'fleeing' },
    { id: 'cave_collapse', label: '💥 Cave Collapse!', state: 'cowering' },
  ],

  socialEvents: [
    { id: 'tribal_hunt',  label: '🏹 Tribal Hunt',     state: 'celebrating', gather: 'hunt_grounds' },
    { id: 'shaman_ritual',label: '🔮 Shaman Ritual',   state: 'meeting',     gather: 'sacred_circle' },
    { id: 'tribal_dance', label: '💃 Tribal Dance',    state: 'celebrating', gather: 'fire_pit' },
    { id: 'coming_of_age',label: '🌟 Coming of Age',   state: 'celebrating', gather: 'sacred_circle' },
  ],

  homePrefix: 'home_cave_',
  homeCount: 12,
  gatherWaypoint: 'sacred_circle',
  socialWaypoints: ['fire_pit', 'water_hole', 'sacred_circle'],

  creatures: [
    { type: 'mammoth',    count: 2, aggressive: false, speed: 1.2, scale: 2.8, primaryColor: 0x7a5e40, secondaryColor: 0x5c3a18 },
    { type: 'saber_tooth',count: 1, aggressive: true,  speed: 3.5, scale: 1.6, primaryColor: 0xd4a853, secondaryColor: 0x8b6914 },
    { type: 'pterodactyl',count: 2, aggressive: false,  speed: 4.0, scale: 1.4, primaryColor: 0x4a6a5a, secondaryColor: 0x2a4a3a, flying: true },
    { type: 'cave_bear',  count: 1, aggressive: true,  speed: 2.5, scale: 2.0, primaryColor: 0x4a3020, secondaryColor: 0x3a2010 },
  ],

  buildScene(scene) {
    const group = new THREE.Group();
    group.userData.eraGroup = true;

    // Ground
    const g = ground(group, 200, 200, 0x8b7355);
    // Rocky texture variation
    const rockPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshLambertMaterial({ color: 0x7a6040 })
    );
    rockPatch.rotation.x = -Math.PI / 2; rockPatch.position.y = -0.01;
    group.add(rockPatch);

    // Dirt trails
    const trailColor = 0x6a5030;
    [[0, -20, 4, 40], [0, 10, 50, 4], [-12, 5, 4, 18], [12, 5, 4, 18], [-10, 22, 4, 28]].forEach(([x, z, w, l]) => {
      const trail = vbox(w, 0.05, l, trailColor); trail.position.set(x, 0.02, z); group.add(trail);
    });

    // Sacred circle (standing stones)
    const stonePositions = [[8,0,0],[7,3,5.7],[2.6,3,7.9],[-5.2,3,6.4],[-8.5,3,0],[-5.2,3,-6.4],[2.6,3,-7.9],[7,3,-5.7]];
    for (const [x,h,z] of stonePositions) {
      const s = standingStone(x, z, h, 0);
      group.add(s);
    }

    // Central fire pit
    group.add(campfire(0, 0));

    // Fire pit gathering area
    group.add(campfire(-2, 12)); group.add(campfire(2, 12));

    // Cave entrances (homes)
    const caves = [
      [-12,8,4,3.5],[-14,22,4,3.5],[12,8,4,3.5],[14,22,4,3.5],[-6,28,4,3.5],[8,28,4,3.5],
      [-24,2,4,3.5],[24,-2,4,3.5],[-4,-14,4,3.5],[6,-14,4,3.5],[-30,22,4,3.5],[32,10,4,3.5]
    ];
    caves.forEach(([x,z,w,h]) => group.add(caveEntrance(x, z, w, h)));

    // Special buildings
    group.add(caveEntrance(-24, -8, 6, 4.5)); // Shaman cave (larger)
    group.add(caveEntrance(-5, -22, 5, 4));   // Main cave entrance

    // Bone workshop (flat rock tables)
    const workshop = new THREE.Group();
    workshop.position.set(20, 0, 6);
    const wTable = vbox(4, 0.3, 3, 0x9a8870); wTable.position.y = 0.8;
    const wsupL = vbox(0.3, 0.8, 0.3, 0x7a6650); wsupL.position.set(-1.7, 0.4, 0);
    const wsupR = vbox(0.3, 0.8, 0.3, 0x7a6650); wsupR.position.set(1.7, 0.4, 0);
    workshop.add(wTable, wsupL, wsupR);
    group.add(workshop);

    // Water hole
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(6, 14),
      new THREE.MeshPhongMaterial({ color: 0x3366aa, transparent: true, opacity: 0.75 })
    );
    pond.rotation.x = -Math.PI / 2; pond.position.set(-15, 0.05, 32);
    group.add(pond);

    // River
    const river = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 28),
      new THREE.MeshPhongMaterial({ color: 0x2255aa, transparent: true, opacity: 0.7 })
    );
    river.rotation.x = -Math.PI / 2; river.rotation.z = 0.4; river.position.set(-12, 0.05, 42);
    group.add(river);

    // Dense forest
    const treePositions = [
      [35,-18],[38,-25],[42,-20],[34,-32],[40,-35],[36,-15],[44,-28],[32,-22],
      [-22,38],[-8,46],[-20,48],[-10,38],[-28,35],
      [-42,0],[-42,20],[42,5],[42,-15],[-28,-42],[28,-40],
      [-8,-12],[8,-12],[-12,4],[12,4],
    ];
    treePositions.forEach(([x, z]) => group.add(tree(x, z, 0x5c3a1e, 0x2e7d32, 0x1b5e20, 1 + Math.random() * 0.4)));

    // Boulders
    for (let i = 0; i < 20; i++) {
      const rx = (Math.random() - 0.5) * 160;
      const rz = (Math.random() - 0.5) * 160;
      if (Math.abs(rx) < 20 && Math.abs(rz) < 20) continue;
      const s = 0.5 + Math.random() * 1.5;
      const b = vbox(s, s * 0.7, s * 0.9, 0x888888);
      b.position.set(rx, s * 0.35, rz);
      b.rotation.y = Math.random() * Math.PI;
      group.add(b);
    }

    // Bones / skull decorations
    for (let i = 0; i < 8; i++) {
      const bx = (Math.random() - 0.5) * 30;
      const bz = (Math.random() - 0.5) * 30;
      const bone = vbox(1.2, 0.15, 0.2, 0xf0e0c0);
      bone.position.set(bx, 0.07, bz);
      bone.rotation.y = Math.random() * Math.PI;
      group.add(bone);
    }

    // Grass patches
    const grassMat = new THREE.MeshLambertMaterial({ color: 0x5a7030 });
    for (let i = 0; i < 25; i++) {
      const gx = (Math.random() - 0.5) * 150;
      const gz = (Math.random() - 0.5) * 150;
      const gp = new THREE.Mesh(new THREE.CircleGeometry(1 + Math.random() * 2, 6), grassMat);
      gp.rotation.x = -Math.PI / 2; gp.position.set(gx, 0.03, gz);
      group.add(gp);
    }

    scene.add(group);
    return group;
  }
};
