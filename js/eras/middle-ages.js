import * as THREE from 'three';
import { ground, pathStrip, medievalBuilding, tree, vbox, campfire } from '../building-utils.js';

export default {
  id: 'middle-ages',
  name: 'Middle Ages',
  subtitle: '~1200 AD',
  emoji: '⚔️',
  economyLabel: 'Barter',
  moodLabel: 'Mood',

  careers: [
    {
      id: 'farmer', name: 'Farmer', emoji: '🌾',
      produces: { grain: 3, vegetables: 2 }, needs: ['tools', 'bread'],
      workplace: 'fields', workStart: 6, workEnd: 18,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x4a7c59, bottomColor: 0x8b6914,
        hat: { w: 0.5, h: 0.18, d: 0.5, color: 0xd4a853, brim: { w: 0.82, d: 0.82 } },
        accessories: []
      }
    },
    {
      id: 'blacksmith', name: 'Blacksmith', emoji: '⚒️',
      produces: { tools: 2, nails: 4 }, needs: ['grain', 'wood', 'beer'],
      workplace: 'smithy', workStart: 7, workEnd: 17,
      appearance: {
        skinColor: 0xc87941, topColor: 0x333333, bottomColor: 0x4a3728,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.22, 0.14, 0.14], color: 0x777777, pos: [0.42, 0.76, 0.1], rot: [0, 0, 0] },
          { geo: 'box', size: [0.12, 0.4, 0.12], color: 0x888888, pos: [0.42, 0.55, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'baker', name: 'Baker', emoji: '🍞',
      produces: { bread: 4, pastry: 2 }, needs: ['grain', 'wood'],
      workplace: 'bakery', workStart: 5, workEnd: 14,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xf5f0e8, bottomColor: 0x8b7355,
        hat: { w: 0.5, h: 0.26, d: 0.5, color: 0xffffff },
        accessories: []
      }
    },
    {
      id: 'merchant', name: 'Merchant', emoji: '💰',
      produces: { coins: 2 }, needs: ['bread', 'tools', 'cloth'],
      workplace: 'market', workStart: 8, workEnd: 19,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x7b2d8b, bottomColor: 0x3d1a5c,
        hat: { w: 0.52, h: 0.3, d: 0.52, color: 0x5a1f6e },
        accessories: [
          { geo: 'box', size: [0.28, 0.28, 0.28], color: 0xc8a040, pos: [0.4, 0.55, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'woodcutter', name: 'Woodcutter', emoji: '🪓',
      produces: { wood: 5, planks: 2 }, needs: ['bread', 'beer'],
      workplace: 'forest', workStart: 7, workEnd: 16,
      appearance: {
        skinColor: 0xd4956a, topColor: 0x6b4c2a, bottomColor: 0x3d2b16,
        hat: { w: 0.5, h: 0.22, d: 0.5, color: 0x5a3e22 },
        accessories: [
          { geo: 'box', size: [0.18, 0.22, 0.06], color: 0x999999, pos: [0.5, 0.76, 0.1], rot: [0, 0, 0] },
          { geo: 'box', size: [0.06, 0.45, 0.06], color: 0x8b5e2a, pos: [0.42, 0.55, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'fisher', name: 'Fisher', emoji: '🎣',
      produces: { fish: 4 }, needs: ['bread', 'tools'],
      workplace: 'dock', workStart: 5, workEnd: 15,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x2c6e9e, bottomColor: 0x1a4a6b,
        hat: { w: 0.5, h: 0.2, d: 0.5, color: 0x1a4a6b },
        accessories: [
          { geo: 'box', size: [0.05, 0.8, 0.05], color: 0x8b5e2a, pos: [0.42, 0.8, 0.05], rot: [-0.3, 0, -0.1] }
        ]
      }
    },
    {
      id: 'healer', name: 'Healer', emoji: '⚕️',
      produces: { medicine: 2, remedy: 1 }, needs: ['grain', 'vegetables', 'coins'],
      workplace: 'healers_hut', workStart: 8, workEnd: 20,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xffffff, bottomColor: 0xd0d0d0,
        hat: { w: 0.5, h: 0.2, d: 0.5, color: 0xe8e8e8 },
        accessories: [
          { geo: 'box', size: [0.28, 0.06, 0.05], color: 0xff0000, pos: [0, 0.72, 0.17], rot: [0, 0, 0] },
          { geo: 'box', size: [0.06, 0.28, 0.05], color: 0xff0000, pos: [0, 0.72, 0.17], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'hunter', name: 'Hunter', emoji: '🏹',
      produces: { meat: 3, leather: 2 }, needs: ['bread', 'tools'],
      workplace: 'forest', workStart: 5, workEnd: 14,
      appearance: {
        skinColor: 0xd4956a, topColor: 0x5c4a2a, bottomColor: 0x3d3020,
        hat: { w: 0.5, h: 0.22, d: 0.5, color: 0x4a3820 },
        accessories: [
          { geo: 'box', size: [0.06, 0.7, 0.06], color: 0x8b5e2a, pos: [0.42, 0.7, 0.05], rot: [-0.2, 0, 0.1] }
        ]
      }
    },
    {
      id: 'shepherd', name: 'Shepherd', emoji: '🐑',
      produces: { wool: 3, milk: 2 }, needs: ['grain', 'bread'],
      workplace: 'pasture', workStart: 6, workEnd: 17,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x9eb87a, bottomColor: 0x6b8a5a,
        hat: { w: 0.5, h: 0.2, d: 0.5, color: 0x7a9a6a },
        accessories: [
          { geo: 'box', size: [0.07, 0.9, 0.07], color: 0x8b5e2a, pos: [0.42, 0.75, 0.05], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'innkeeper', name: 'Innkeeper', emoji: '🍺',
      produces: { beer: 4, meals: 3 }, needs: ['grain', 'vegetables', 'meat', 'wood'],
      workplace: 'tavern', workStart: 10, workEnd: 23,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xaa3333, bottomColor: 0x6b2020,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.3, 0.22, 0.1], color: 0xffcc44, pos: [0.38, 0.65, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'potter', name: 'Potter', emoji: '🏺',
      produces: { pottery: 3, tiles: 2 }, needs: ['wood', 'grain', 'vegetables'],
      workplace: 'pottery', workStart: 8, workEnd: 17,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xc47a3a, bottomColor: 0x8b5e2a,
        hat: null,
        accessories: [
          { geo: 'cylinder', size: [0.12, 0.18, 0.22], color: 0xcc6633, pos: [0.38, 0.62, 0.05], rot: [0, 0, 0.2] }
        ]
      }
    },
    {
      id: 'weaver', name: 'Weaver', emoji: '🧵',
      produces: { cloth: 3, thread: 2 }, needs: ['wool', 'vegetables', 'bread'],
      workplace: 'weavery', workStart: 7, workEnd: 16,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xe8a0c8, bottomColor: 0xb06090,
        hat: { w: 0.5, h: 0.2, d: 0.5, color: 0xd080a0 },
        accessories: []
      }
    }
  ],

  waypoints: {
    market:       { x:  0, z:  0 },
    well:         { x: -4, z: -4 },
    smithy:       { x: 18, z: -5 },
    bakery:       { x:-18, z: -5 },
    tavern:       { x:  2, z: 16 },
    fields_near:  { x:  0, z:-28 },
    fields:       { x:  0, z:-40 },
    forest:       { x: 38, z:-28 },
    forest_edge:  { x: 30, z:-20 },
    dock:         { x:-10, z: 36 },
    pond:         { x:-15, z: 42 },
    pasture:      { x: 28, z: 20 },
    healers_hut:  { x:-26, z: 10 },
    pottery:      { x: 26, z:  6 },
    weavery:      { x:-22, z:-18 },
    home_1:       { x:-12, z:  8 },
    home_2:       { x: 12, z:  8 },
    home_3:       { x:-14, z: 22 },
    home_4:       { x: 14, z: 22 },
    home_5:       { x: -6, z: 28 },
    home_6:       { x:  8, z: 28 },
    home_7:       { x:-24, z:  0 },
    home_8:       { x: 24, z: -2 },
    home_9:       { x: -4, z:-16 },
    home_10:      { x:  6, z:-16 },
    home_11:      { x:-30, z: 22 },
    home_12:      { x: 32, z: 10 },
  },

  edges: [
    ['market','well'],['market','smithy'],['market','bakery'],['market','tavern'],
    ['market','fields_near'],['market','pottery'],['market','home_2'],['market','home_1'],
    ['well','healers_hut'],['well','home_1'],['well','home_9'],['well','home_10'],
    ['smithy','pottery'],['smithy','forest_edge'],['smithy','home_8'],
    ['bakery','weavery'],['bakery','healers_hut'],['bakery','home_7'],
    ['tavern','home_3'],['tavern','home_4'],['tavern','home_5'],['tavern','home_6'],['tavern','dock'],
    ['fields_near','fields'],['fields_near','home_9'],['fields_near','home_10'],['fields_near','weavery'],
    ['forest_edge','forest'],['forest_edge','pasture'],
    ['pasture','home_12'],['pasture','dock'],
    ['dock','pond'],['dock','home_5'],['dock','home_6'],
    ['healers_hut','home_7'],['healers_hut','home_11'],
    ['weavery','home_7'],['weavery','home_9'],
    ['pottery','home_8'],['pottery','home_2'],
    ['home_3','home_11'],['home_11','home_7'],
    ['home_12','home_8'],['home_4','home_12'],
  ],

  weatherOptions: [
    { id: 'clear',  label: '☀️ Clear',  particleType: null,  speedMult: 1.0, fogColor: 0x87ceeb, fogNear: 80, fogFar: 200, shelter: false },
    { id: 'cloudy', label: '☁️ Cloudy', particleType: null,  speedMult: 0.9, fogColor: 0xaabbcc, fogNear: 60, fogFar: 160, shelter: false },
    { id: 'rain',   label: '🌧 Rain',   particleType: 'rain', speedMult: 0.65, fogColor: 0x7a8a99, fogNear: 40, fogFar: 120, shelter: true },
    { id: 'storm',  label: '⛈ Storm',  particleType: 'rain', speedMult: 0.3, fogColor: 0x445566, fogNear: 20, fogFar: 80,  shelter: true, lightning: true, windX: 0.08, windZ: 0.04 },
    { id: 'snow',   label: '❄️ Snow',   particleType: 'snow', speedMult: 0.5, fogColor: 0xddeeff, fogNear: 30, fogFar: 100, shelter: false },
    { id: 'fog',    label: '🌫 Fog',    particleType: null,  speedMult: 0.6, fogColor: 0xccddcc, fogNear: 5,  fogFar: 40,  shelter: false },
  ],

  disasters: [
    { id: 'fire',       label: '🔥 Fire!',       state: 'fleeing'  },
    { id: 'flood',      label: '🌊 Flood!',      state: 'fleeing'  },
    { id: 'earthquake', label: '⚡ Earthquake!', state: 'cowering' },
    { id: 'plague',     label: '☠️ Plague',       state: null       },
    { id: 'tournament', label: '⚔️ Tournament!',  state: 'celebrating' },
  ],

  socialEvents: [
    { id: 'festival',     label: '🎉 Festival!',    state: 'celebrating', gather: 'market' },
    { id: 'market_day',   label: '🏪 Market Day',   state: 'bartering',   gather: 'market' },
    { id: 'wedding',      label: '💒 Wedding!',     state: 'celebrating', gather: 'market' },
    { id: 'town_meeting', label: '📣 Town Meeting', state: 'meeting',     gather: 'market' },
  ],

  homePrefix: 'home_',
  homeCount: 12,
  gatherWaypoint: 'market',
  socialWaypoints: ['tavern', 'well', 'market'],
  creatures: [],

  buildScene(scene) {
    const group = new THREE.Group();
    group.userData.eraGroup = true;

    ground(group, 200, 200, 0x6aaa55);

    // Paths
    [[0,-20,4,40],[0,10,60,4],[-18,-12,4,20],[18,-12,4,20],[-10,22,4,30],[25,13,4,20]].forEach(([x,z,w,l]) => {
      pathStrip(group, x, z, w, l, 0xc4a265);
    });

    // Market square
    const sq = vbox(22, 0.05, 22, 0xb09070); sq.position.set(0, 0.01, 0); group.add(sq);
    group.add(campfire(0, 0));

    // Buildings
    const buildingDefs = [
      [18,-5,8,7,4.5,0x555555,0x333333],[- 18,-5,7,6,4,0xf0e0c0,0xcc7733],
      [2,16,10,8,5,0xd2a679,0x8b2500],[-26,10,6,5,3.5,0xeeeedd,0x779977],
      [26,6,6,5,3.5,0xd4935a,0xaa6633],[-22,-18,7,5,3.5,0xddccee,0x9966aa],
      [-10,36,6,5,3,0xc8a870,0x5c3a1e],[0,-36,8,6,4,0xc8a060,0x663300],[28,20,6,5,3,0xbba080,0x664422],
      [-12,8,5,4,3.5,0xe8d5b7,0xaa3333],[12,8,5,4,3.5,0xd7e8b7,0x337733],
      [-14,22,5,4,3.5,0xe8e2b7,0x887733],[14,22,5,4,3.5,0xb7d5e8,0x336688],
      [-6,28,5,4,3.5,0xe8c0b7,0x883333],[8,28,5,4,3.5,0xd0e8b7,0x558833],
      [-24,0,5,4,3.5,0xe8d0b7,0xaa6633],[24,-2,5,4,3.5,0xb7c8e8,0x4455aa],
      [-4,-16,5,4,3.5,0xe8d5c8,0x996644],[6,-16,5,4,3.5,0xc8e8d5,0x449966],
      [-30,22,5,4,3.5,0xe8d5b7,0xaa5522],[32,10,5,4,3.5,0xd5e8b7,0x557733],
    ];
    buildingDefs.forEach(([x,z,w,d,h,wall,roof]) => group.add(medievalBuilding(x,z,w,d,h,wall,roof)));

    // Market stalls
    [[- 5,-2,3,2,2.5,0xf5deb3,0xcc4444],[5,-2,3,2,2.5,0xf5deb3,0x4444cc],[0,5,3,2,2.5,0xf5deb3,0x44aa44]].forEach(([x,z,w,d,h,wall,roof]) => group.add(medievalBuilding(x,z,w,d,h,wall,roof)));

    // Well
    const well = vbox(1.5,1.5,1.5,0x999999); well.position.set(-4,0.75,-4); group.add(well);

    // Smithy chimney
    const chim = vbox(0.8,3,0.8,0x444444); chim.position.set(20,6,-5); group.add(chim);

    // Pond
    const pond = new THREE.Mesh(new THREE.CircleGeometry(8,16), new THREE.MeshPhongMaterial({color:0x3399cc,transparent:true,opacity:0.8}));
    pond.rotation.x = -Math.PI/2; pond.position.set(-15,0.05,42); group.add(pond);

    // Dock
    const pier = vbox(1.5,0.3,12,0x8b5e2a); pier.position.set(-10,0.15,43); group.add(pier);

    // Fence posts
    [[22,14],[28,14],[34,14],[34,20],[34,26],[28,26],[22,26],[22,20]].forEach(([fx,fz]) => {
      const post = vbox(0.2,1.2,0.2,0x9b7b5b); post.position.set(fx,0.6,fz); group.add(post);
    });

    // Trees
    [[35,-28],[38,-32],[42,-26],[34,-35],[40,-38],[-8,-12],[8,-12],[-14,4],[14,4],[-22,38],[-8,46],[-45,0],[-45,20],[45,5],[45,-15]].forEach(([x,z]) => {
      group.add(tree(x, z, 0x7b5226, 0x2e7d32, 0x1b5e20, 1 + Math.random() * 0.3));
    });

    scene.add(group);
    return group;
  }
};
