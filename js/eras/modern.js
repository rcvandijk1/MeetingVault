import * as THREE from 'three';
import { ground, modernBuilding, vbox, streetLight, roadMarkings } from '../building-utils.js';

export default {
  id: 'modern',
  name: 'Modern Age',
  subtitle: '2024 AD',
  emoji: '🏙️',
  economyLabel: 'Money',
  moodLabel: 'Stress',
  invertMood: true, // display mood as stress (inverted)

  careers: [
    {
      id: 'office_worker', name: 'Office Worker', emoji: '💼',
      produces: { reports: 3, data: 2 }, needs: ['coffee', 'lunch', 'phone'],
      workplace: 'office', workStart: 9, workEnd: 17,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xfafafa, bottomColor: 0x111122,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.25, 0.18, 0.04], color: 0x334455, pos: [-0.38, 0.68, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'factory_worker', name: 'Factory Worker', emoji: '🏭',
      produces: { goods: 4, parts: 2 }, needs: ['lunch', 'coffee', 'transport'],
      workplace: 'factory', workStart: 7, workEnd: 15,
      appearance: {
        skinColor: 0xd4956a, topColor: 0xff6600, bottomColor: 0x002244,
        hat: { w: 0.52, h: 0.22, d: 0.52, color: 0xffcc00 },
        accessories: []
      }
    },
    {
      id: 'doctor', name: 'Doctor', emoji: '🩺',
      produces: { treatment: 2, prescription: 1 }, needs: ['lunch', 'coffee', 'reports'],
      workplace: 'hospital', workStart: 8, workEnd: 18,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xffffff, bottomColor: 0xaaccff,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.12, 0.04, 0.1], color: 0x333333, pos: [0, 1.06, 0.16], rot: [0, 0, 0] },
          { geo: 'box', size: [0.04, 0.18, 0.04], color: 0x666666, pos: [0, 0.92, 0.18], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'teacher', name: 'Teacher', emoji: '📚',
      produces: { knowledge: 2, grades: 2 }, needs: ['coffee', 'lunch', 'reports'],
      workplace: 'school', workStart: 8, workEnd: 16,
      appearance: {
        skinColor: 0xf0c080, topColor: 0xddbb88, bottomColor: 0x6b4a2a,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.22, 0.28, 0.04], color: 0x2244aa, pos: [-0.38, 0.66, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'police', name: 'Police Officer', emoji: '👮',
      produces: { order: 2, tickets: 1 }, needs: ['coffee', 'lunch'],
      workplace: 'police_station', workStart: 8, workEnd: 20,
      appearance: {
        skinColor: 0xd4956a, topColor: 0x1a1a66, bottomColor: 0x111144,
        hat: { w: 0.54, h: 0.2, d: 0.54, color: 0x1a1a44 },
        accessories: [
          { geo: 'box', size: [0.12, 0.1, 0.04], color: 0xddcc00, pos: [0, 0.82, 0.16], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'delivery_driver', name: 'Delivery Driver', emoji: '📦',
      produces: { deliveries: 4, transport: 2 }, needs: ['coffee', 'fuel', 'lunch'],
      workplace: 'mall', workStart: 8, workEnd: 18,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x8b6b00, bottomColor: 0x442200,
        hat: { w: 0.52, h: 0.18, d: 0.52, color: 0x664400 },
        accessories: [
          { geo: 'box', size: [0.26, 0.2, 0.18], color: 0x8b6b00, pos: [-0.38, 0.58, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'programmer', name: 'Programmer', emoji: '💻',
      produces: { code: 3, apps: 1 }, needs: ['coffee', 'coffee', 'pizza'],
      workplace: 'office', workStart: 10, workEnd: 22,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x555577, bottomColor: 0x222233,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.3, 0.2, 0.04], color: 0x111133, pos: [0, 0.72, 0.18], rot: [0.3, 0, 0] }
        ]
      }
    },
    {
      id: 'barista', name: 'Barista', emoji: '☕',
      produces: { coffee: 5, snacks: 2 }, needs: ['goods', 'transport'],
      workplace: 'cafe', workStart: 6, workEnd: 15,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x2d6a4a, bottomColor: 0x1a3a2a,
        hat: { w: 0.5, h: 0.22, d: 0.5, color: 0x1e4e36 },
        accessories: [
          { geo: 'box', size: [0.18, 0.22, 0.16], color: 0x333333, pos: [0.38, 0.62, 0.08], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'manager', name: 'Manager', emoji: '📊',
      produces: { meetings: 2, memos: 3 }, needs: ['coffee', 'reports', 'phone'],
      workplace: 'office', workStart: 8, workEnd: 19,
      appearance: {
        skinColor: 0xd4956a, topColor: 0x444455, bottomColor: 0x222233,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.08, 0.35, 0.04], color: 0xaa2233, pos: [0, 0.77, 0.16], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'mechanic', name: 'Mechanic', emoji: '🔧',
      produces: { repairs: 3, fuel: 2 }, needs: ['coffee', 'lunch', 'parts'],
      workplace: 'garage', workStart: 8, workEnd: 17,
      appearance: {
        skinColor: 0xc87941, topColor: 0x2255aa, bottomColor: 0x112244,
        hat: { w: 0.52, h: 0.18, d: 0.52, color: 0x2255aa },
        accessories: [
          { geo: 'box', size: [0.22, 0.07, 0.07], color: 0x888888, pos: [0.42, 0.72, 0.05], rot: [0, 0, -0.4] }
        ]
      }
    },
    {
      id: 'nurse', name: 'Nurse', emoji: '💊',
      produces: { treatment: 2, care: 3 }, needs: ['coffee', 'lunch', 'reports'],
      workplace: 'hospital', workStart: 7, workEnd: 19,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x5599bb, bottomColor: 0x224466,
        hat: { w: 0.52, h: 0.18, d: 0.52, color: 0xffffff },
        accessories: []
      }
    },
    {
      id: 'influencer', name: 'Influencer', emoji: '📱',
      produces: { content: 3, trends: 1 }, needs: ['coffee', 'snacks', 'lunch'],
      workplace: 'park', workStart: 10, workEnd: 20,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xff6699, bottomColor: 0xffffff,
        hat: { w: 0.5, h: 0.22, d: 0.5, color: 0xff99bb },
        accessories: [
          { geo: 'box', size: [0.16, 0.28, 0.04], color: 0x111111, pos: [0.38, 0.62, 0.12], rot: [0, 0, 0] }
        ]
      }
    }
  ],

  waypoints: {
    city_center:    { x:  0, z:  0 },
    office:         { x: 18, z: -8 },
    factory:        { x:-22, z:-22 },
    hospital:       { x:-22, z:  5 },
    school:         { x: 22, z:  8 },
    cafe:           { x:  6, z: 12 },
    police_station: { x:-10, z: -6 },
    mall:           { x:  0, z: 22 },
    park:           { x: -8, z: 14 },
    garage:         { x: 18, z: 20 },
    home_1:         { x:-12, z:  8 },
    home_2:         { x: 12, z:  8 },
    home_3:         { x:-14, z: 22 },
    home_4:         { x: 14, z: 24 },
    home_5:         { x: -6, z: 30 },
    home_6:         { x:  8, z: 30 },
    home_7:         { x:-26, z:  0 },
    home_8:         { x: 26, z: -2 },
    home_9:         { x: -4, z:-16 },
    home_10:        { x:  6, z:-16 },
    home_11:        { x:-30, z: 24 },
    home_12:        { x: 32, z: 12 },
  },

  edges: [
    ['city_center','office'],['city_center','hospital'],['city_center','school'],['city_center','cafe'],
    ['city_center','police_station'],['city_center','mall'],['city_center','park'],
    ['city_center','home_1'],['city_center','home_2'],
    ['office','home_8'],['office','school'],['office','home_10'],
    ['factory','police_station'],['factory','home_7'],['factory','home_9'],
    ['hospital','home_7'],['hospital','home_11'],['hospital','park'],
    ['school','home_8'],['school','home_12'],
    ['cafe','park'],['cafe','home_1'],['cafe','home_2'],
    ['mall','home_3'],['mall','home_4'],['mall','home_5'],['mall','home_6'],
    ['park','home_3'],['park','home_1'],
    ['garage','home_12'],['garage','mall'],
    ['police_station','home_9'],['police_station','home_1'],
    ['home_11','home_7'],['home_3','home_11'],['home_4','home_12'],['home_12','home_8'],
    ['home_5','home_6'],['home_9','home_10'],
  ],

  weatherOptions: [
    { id: 'clear',      label: '☀️ Clear',       particleType: null,  speedMult: 1.0, fogColor: 0x99aacc, fogNear: 80, fogFar: 200, shelter: false },
    { id: 'cloudy',     label: '☁️ Overcast',    particleType: null,  speedMult: 0.9, fogColor: 0x889aaa, fogNear: 60, fogFar: 160, shelter: false },
    { id: 'rain',       label: '🌧 Rain',         particleType: 'rain', speedMult: 0.7, fogColor: 0x6a7a88, fogNear: 40, fogFar: 100, shelter: true },
    { id: 'storm',      label: '⛈ Storm',        particleType: 'rain', speedMult: 0.3, fogColor: 0x334455, fogNear: 20, fogFar: 60,  shelter: true, lightning: true, windX: 0.06 },
    { id: 'smog',       label: '🌫 Smog',         particleType: 'smog', speedMult: 0.75, fogColor: 0xaaaa66, fogNear: 15, fogFar: 55, shelter: false, moodPenalty: 0.001 },
    { id: 'heat_wave',  label: '🌡 Heat Wave',    particleType: null,  speedMult: 0.55, fogColor: 0xddaa55, fogNear: 50, fogFar: 140, shelter: false, moodPenalty: 0.0005 },
  ],

  disasters: [
    { id: 'strike',       label: '✊ Workers Strike!',    state: 'striking'  },
    { id: 'power_outage', label: '🔌 Power Outage!',      state: 'cowering'  },
    { id: 'traffic_jam',  label: '🚗 Traffic Jam!',       state: null        },
    { id: 'market_crash', label: '📉 Market Crash!',      state: null, moodHit: -0.4 },
    { id: 'factory_fire', label: '🏭 Factory Fire!',      state: 'fleeing'   },
  ],

  socialEvents: [
    { id: 'protest',      label: '📢 Protest March',  state: 'marching',    gather: 'city_center' },
    { id: 'office_party', label: '🎉 Office Party',   state: 'celebrating', gather: 'office'      },
    { id: 'concert',      label: '🎸 Concert',        state: 'celebrating', gather: 'park'        },
    { id: 'sports_event', label: '⚽ Sports Event',   state: 'celebrating', gather: 'mall'        },
  ],

  homePrefix: 'home_',
  homeCount: 12,
  gatherWaypoint: 'city_center',
  socialWaypoints: ['cafe', 'park', 'mall'],
  creatures: [], // vehicles instead, handled by special entities

  vehicles: [
    { color: 0xcc2222 }, { color: 0x2244cc }, { color: 0xddcc22 },
    { color: 0x888888 }, { color: 0x22aa44 }, { color: 0xcc6622 },
  ],

  buildScene(scene) {
    const group = new THREE.Group();
    group.userData.eraGroup = true;

    // Concrete ground
    ground(group, 200, 200, 0x888890);

    // Road network
    const roadColor = 0x444450;
    [
      [0, -10, 8, 60], [0, 12, 8, 70],     // E-W roads
      [-8, 0, 60, 8],  [12, 0, 60, 8],     // N-S roads
      [0, -32, 8, 40], [-30, -5, 8, 30],
    ].forEach(([x, z, w, l]) => {
      const road = vbox(w, 0.04, l, roadColor);
      road.position.set(x, 0.02, z); group.add(road);
    });

    // Lane markings
    roadMarkings(scene, 0, -10, 0, 60, true);
    roadMarkings(scene, 0, 12, 0, 70, true);

    // Sidewalks
    [
      [0, -14, 70, 2], [0, 16, 70, 2], [-12, 0, 2, 55], [16, 0, 2, 55]
    ].forEach(([x, z, w, l]) => {
      const sw = vbox(w, 0.06, l, 0xaaaaaa); sw.position.set(x, 0.03, z); group.add(sw);
    });

    // City center plaza
    const plaza = vbox(20, 0.06, 20, 0x9999aa); plaza.position.set(0, 0.03, 0); group.add(plaza);

    // Office building (tall, glassy)
    group.add(modernBuilding(18, -8, 12, 10, 5, 0x445566));
    group.add(modernBuilding(22, -8, 8, 8, 8, 0x334455)); // taller tower beside it

    // Factory (large, industrial)
    const factoryBase = modernBuilding(-22, -22, 18, 14, 2, 0x888888);
    group.add(factoryBase);
    // Chimneys
    for (let i = 0; i < 3; i++) {
      const chim = vbox(1.2, 8, 1.2, 0x666666); chim.position.set(-26 + i * 3, 4, -22); group.add(chim);
      const smoke = vbox(1.4, 0.4, 1.4, 0x555555); smoke.position.set(-26 + i * 3, 8.2, -22); group.add(smoke);
    }

    // Hospital (white, red cross)
    group.add(modernBuilding(-22, 5, 10, 9, 3, 0xeeeeff));
    const crossH = vbox(4, 0.4, 0.8, 0xff2222); crossH.position.set(-22, 10.2, 5); group.add(crossH);
    const crossV = vbox(0.8, 0.4, 4, 0xff2222); crossV.position.set(-22, 10.2, 5); group.add(crossV);

    // School
    group.add(modernBuilding(22, 8, 12, 9, 2, 0xddccaa));

    // Cafe
    group.add(modernBuilding(6, 12, 6, 5, 1, 0xcc8844));
    const sign = vbox(4, 0.8, 0.1, 0x2d6a4a); sign.position.set(6, 4.4, 14.55); group.add(sign);

    // Police station
    group.add(modernBuilding(-10, -6, 8, 7, 2, 0x334466));

    // Mall (wide, single floor)
    group.add(modernBuilding(0, 22, 22, 14, 1, 0xccbbaa));

    // Park (green area)
    const park = vbox(16, 0.06, 14, 0x448833); park.position.set(-8, 0.03, 14); group.add(park);
    // Benches
    for (let i = 0; i < 3; i++) {
      const bench = vbox(2, 0.3, 0.5, 0x8b5e2a); bench.position.set(-10 + i * 4, 0.3, 14); group.add(bench);
    }
    // Park trees
    [[-12,10],[-6,10],[-14,16],[-4,18],[-10,18]].forEach(([x,z]) => {
      const trunk = vbox(0.4, 3, 0.4, 0x5c3a1e); trunk.position.set(x, 1.5, z); group.add(trunk);
      const leaves = vbox(2.5, 2, 2.5, 0x226633); leaves.position.set(x, 3.5, z); group.add(leaves);
    });

    // Garage
    group.add(modernBuilding(18, 20, 10, 8, 1, 0x666677));

    // Apartment homes
    [[- 12,8,6,5,3,0xe8d5b7],[12,8,6,5,3,0xd7e8b7],[-14,22,6,5,3,0xe8e2b7],[14,24,6,5,3,0xb7d5e8],
     [-6,30,6,5,3,0xe8c0b7],[8,30,6,5,3,0xd0e8b7],[-26,0,6,5,3,0xddc0a0],[26,-2,6,5,3,0xb7c8d8],
     [-4,-16,6,5,3,0xddd0b0],[6,-16,6,5,3,0xc8e0d0],[-30,24,6,5,3,0xe0cca0],[32,12,6,5,3,0xd0e0b7],
    ].forEach(([x,z,w,d,fl,color]) => group.add(modernBuilding(x, z, w, d, fl, color)));

    // Street lights
    [[-6,-14],[6,-14],[-6,16],[6,16],[-14,0],[-14,12],[14,-8],[14,12]].forEach(([x,z]) => {
      group.add(streetLight(x, z));
    });

    // Traffic lights
    [[0,-15,0xcc2222],[0,17,0x22cc22]].forEach(([x,z,color]) => {
      const pole = vbox(0.15, 4, 0.15, 0x333333); pole.position.set(x, 2, z); group.add(pole);
      const head = vbox(0.5, 1.2, 0.4, 0x222222); head.position.set(x, 4.2, z); group.add(head);
      const light = vbox(0.25, 0.25, 0.1, color); light.position.set(x, 4.2, z + 0.2); group.add(light);
    });

    scene.add(group);
    return group;
  }
};
