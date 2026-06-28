import * as THREE from 'three';
import { ground, futureBuilding, energyTower, bioDome, vbox } from '../building-utils.js';

export default {
  id: 'futuristic',
  name: 'Futuristic',
  subtitle: '2387 AD',
  emoji: '🚀',
  economyLabel: 'Energy Credits',
  moodLabel: 'Efficiency',

  careers: [
    {
      id: 'engineer', name: 'Engineer', emoji: '🔬',
      produces: { tech_parts: 3, devices: 1 }, needs: ['synth_food', 'energy', 'coffee'],
      workplace: 'research_lab', workStart: 8, workEnd: 18,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x4488aa, bottomColor: 0x1a3356,
        hat: { w: 0.52, h: 0.16, d: 0.52, color: 0x336688 },
        accessories: [
          { geo: 'box', size: [0.22, 0.07, 0.07], color: 0x88ccff, pos: [0.42, 0.72, 0.05], rot: [0, 0, -0.4] }
        ]
      }
    },
    {
      id: 'ai_researcher', name: 'AI Researcher', emoji: '🤖',
      produces: { algorithms: 2, ai_cores: 1 }, needs: ['tech_parts', 'energy', 'coffee'],
      workplace: 'research_lab', workStart: 9, workEnd: 22,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xeeeeff, bottomColor: 0x445566,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.44, 0.1, 0.44], color: 0x4499ff, pos: [0, 1.42, 0], rot: [0, 0, 0] },
          { geo: 'box', size: [0.48, 0.06, 0.1], color: 0x22ddff, pos: [0, 1.34, 0.22], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'space_pilot', name: 'Space Pilot', emoji: '🚀',
      produces: { fuel: 3, routes: 1 }, needs: ['energy', 'synth_food', 'tech_parts'],
      workplace: 'space_port', workStart: 6, workEnd: 18,
      appearance: {
        skinColor: 0xd4956a, topColor: 0xee6600, bottomColor: 0x333333,
        hat: { w: 0.55, h: 0.32, d: 0.55, color: 0xcc5500 },
        accessories: [
          { geo: 'box', size: [0.52, 0.52, 0.52], color: 0xcc660000, pos: [0, 1.2, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'robot_tech', name: 'Robot Technician', emoji: '⚙️',
      produces: { repairs: 3, upgrades: 1 }, needs: ['tech_parts', 'energy'],
      workplace: 'upload_terminal', workStart: 7, workEnd: 17,
      appearance: {
        skinColor: 0xb87040, topColor: 0x777788, bottomColor: 0x444455,
        hat: { w: 0.52, h: 0.2, d: 0.52, color: 0x558899 },
        accessories: [
          { geo: 'box', size: [0.22, 0.07, 0.07], color: 0xaaaacc, pos: [0.42, 0.72, 0.05], rot: [0, 0, -0.3] }
        ]
      }
    },
    {
      id: 'bio_engineer', name: 'Bio-Engineer', emoji: '🧬',
      produces: { bio_mods: 2, treatments: 2 }, needs: ['energy', 'tech_parts', 'synth_food'],
      workplace: 'bio_dome', workStart: 8, workEnd: 17,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xaaddaa, bottomColor: 0x335533,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.06, 0.28, 0.06], color: 0x44ff88, pos: [0.38, 0.62, 0.1], rot: [0, 0, 0] },
          { geo: 'box', size: [0.16, 0.06, 0.16], color: 0x44ff88, pos: [0.38, 0.76, 0.1], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'energy_trader', name: 'Energy Trader', emoji: '⚡',
      produces: { energy: 5, power_cells: 2 }, needs: ['tech_parts', 'routes'],
      workplace: 'energy_nexus', workStart: 8, workEnd: 20,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xddaa00, bottomColor: 0x222244,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.3, 0.22, 0.12], color: 0xffcc00, pos: [-0.38, 0.6, 0], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'hacker', name: 'Hacker', emoji: '💾',
      produces: { data: 4, exploits: 1 }, needs: ['coffee', 'energy', 'synth_food'],
      workplace: 'hacker_den', workStart: 14, workEnd: 4,
      appearance: {
        skinColor: 0xd4956a, topColor: 0x111122, bottomColor: 0x0a0a15,
        hat: { w: 0.52, h: 0.22, d: 0.52, color: 0x111122 },
        accessories: [
          { geo: 'box', size: [0.14, 0.04, 0.14], color: 0x00ff44, pos: [0, 1.53, 0.1], rot: [0, 0, 0] },
          { geo: 'box', size: [0.28, 0.18, 0.04], color: 0x001100, pos: [0, 0.72, 0.18], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'terraformer', name: 'Terraformer', emoji: '🌍',
      produces: { terra_units: 2, minerals: 3 }, needs: ['energy', 'tech_parts'],
      workplace: 'space_port', workStart: 6, workEnd: 16,
      appearance: {
        skinColor: 0xc87941, topColor: 0x7a6050, bottomColor: 0x555555,
        hat: { w: 0.55, h: 0.28, d: 0.55, color: 0x5a5050 },
        accessories: [
          { geo: 'box', size: [0.38, 0.38, 0.16], color: 0x444444, pos: [0, 0.72, 0.14], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'xenologist', name: 'Xenologist', emoji: '👽',
      produces: { xenodata: 2, artifacts: 1 }, needs: ['energy', 'tech_parts', 'data'],
      workplace: 'alien_landing', workStart: 9, workEnd: 20,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x6633aa, bottomColor: 0x2a1a44,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.52, 0.12, 0.52], color: 0x8844cc, pos: [0, 1.5, 0], rot: [0, 0, 0] },
          { geo: 'box', size: [0.12, 0.06, 0.52], color: 0xaa66ff, pos: [0, 1.5, 0], rot: [0, Math.PI / 2, 0] }
        ]
      }
    },
    {
      id: 'quantum_arch', name: 'Quantum Architect', emoji: '🔷',
      produces: { quantum_chips: 2, blueprints: 1 }, needs: ['energy', 'algorithms', 'tech_parts'],
      workplace: 'quantum_lab', workStart: 9, workEnd: 18,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0xaabbff, bottomColor: 0x2233aa,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.5, 0.08, 0.5], color: 0x4466ff, pos: [0, 1.5, 0], rot: [0, 0.4, 0] },
          { geo: 'box', size: [0.5, 0.08, 0.5], color: 0x6688ff, pos: [0, 1.5, 0], rot: [0, -0.4, 0] }
        ]
      }
    },
    {
      id: 'android', name: 'Android', emoji: '🤖',
      produces: { labor: 5, data: 2 }, needs: ['energy', 'repairs'],
      workplace: 'upload_terminal', workStart: 0, workEnd: 24,
      appearance: {
        skinColor: 0x889999, topColor: 0x778888, bottomColor: 0x556677,
        hat: { w: 0.54, h: 0.24, d: 0.54, color: 0x667788 },
        accessories: [
          { geo: 'box', size: [0.12, 0.04, 0.12], color: 0x00ccff, pos: [0, 1.24, 0.22], rot: [0, 0, 0] },
          { geo: 'box', size: [0.12, 0.04, 0.12], color: 0x00ccff, pos: [-0.16, 1.24, 0.22], rot: [0, 0, 0] }
        ]
      }
    },
    {
      id: 'holographer', name: 'Holographer', emoji: '🌈',
      produces: { holos: 3, media: 2 }, needs: ['energy', 'data', 'synth_food'],
      workplace: 'energy_nexus', workStart: 10, workEnd: 22,
      appearance: {
        skinColor: 0xf4c88a, topColor: 0x88ccff, bottomColor: 0x223355,
        hat: null,
        accessories: [
          { geo: 'box', size: [0.4, 0.08, 0.08], color: 0xff44cc, pos: [0, 1.5, 0.12], rot: [0, 0, 0] },
          { geo: 'box', size: [0.08, 0.08, 0.4], color: 0x44ffcc, pos: [0, 1.5, 0.12], rot: [0, 0, 0] }
        ]
      }
    }
  ],

  waypoints: {
    energy_nexus:    { x:  0, z:  0 },
    market:          { x:  0, z: 14 },
    space_port:      { x:  0, z:-38 },
    research_lab:    { x: 22, z:-10 },
    bio_dome:        { x:-24, z:-12 },
    hacker_den:      { x:-28, z:  6 },
    quantum_lab:     { x: 28, z:  6 },
    alien_landing:   { x:  6, z: 28 },
    upload_terminal: { x: -8, z:-15 },
    energy_tower:    { x: 30, z:-30 },
    hab_1:           { x:-12, z:  8 },
    hab_2:           { x: 12, z:  8 },
    hab_3:           { x:-14, z: 22 },
    hab_4:           { x: 14, z: 22 },
    hab_5:           { x: -6, z: 30 },
    hab_6:           { x:  8, z: 32 },
    hab_7:           { x:-26, z:  0 },
    hab_8:           { x: 26, z: -2 },
    hab_9:           { x: -4, z:-18 },
    hab_10:          { x:  6, z:-18 },
    hab_11:          { x:-32, z: 20 },
    hab_12:          { x: 34, z: 10 },
  },

  edges: [
    ['energy_nexus','market'],['energy_nexus','research_lab'],['energy_nexus','bio_dome'],
    ['energy_nexus','hacker_den'],['energy_nexus','quantum_lab'],['energy_nexus','hab_1'],['energy_nexus','hab_2'],
    ['market','alien_landing'],['market','hab_3'],['market','hab_4'],['market','hab_5'],['market','hab_6'],
    ['space_port','upload_terminal'],['space_port','hab_9'],['space_port','energy_tower'],
    ['research_lab','energy_tower'],['research_lab','quantum_lab'],['research_lab','hab_8'],
    ['bio_dome','hacker_den'],['bio_dome','hab_7'],['bio_dome','hab_11'],
    ['hacker_den','hab_7'],['hacker_den','hab_11'],
    ['quantum_lab','hab_8'],['quantum_lab','hab_12'],
    ['alien_landing','hab_5'],['alien_landing','hab_6'],
    ['upload_terminal','hab_9'],['upload_terminal','hab_10'],
    ['hab_3','hab_11'],['hab_4','hab_12'],['hab_5','hab_6'],['hab_9','hab_10'],
  ],

  weatherOptions: [
    { id: 'clear',          label: '🌟 Clear',         particleType: null,   speedMult: 1.0, fogColor: 0x111133, fogNear: 80, fogFar: 220, shelter: false },
    { id: 'ion_storm',      label: '⚡ Ion Storm',     particleType: 'spark', speedMult: 0.5, fogColor: 0x222244, fogNear: 30, fogFar: 90,  shelter: true,  lightning: true },
    { id: 'solar_radiation',label: '☀️ Solar Flare',   particleType: 'solar', speedMult: 0.6, fogColor: 0x664422, fogNear: 40, fogFar: 130, shelter: false, moodPenalty: 0.001 },
    { id: 'nebula_dust',    label: '🌌 Nebula Dust',   particleType: 'dust',  speedMult: 0.7, fogColor: 0x441166, fogNear: 15, fogFar: 60,  shelter: false },
    { id: 'gravity_anomaly',label: '🌀 Gravity Anomaly',particleType: null,  speedMult: 0.4, fogColor: 0x113322, fogNear: 50, fogFar: 160, shelter: false, gravityMode: true },
  ],

  disasters: [
    { id: 'solar_flare',   label: '☀️ Solar Flare!',    state: 'cowering'  },
    { id: 'alien_invasion',label: '👽 Alien Invasion!',  state: 'fleeing'   },
    { id: 'ai_rebellion',  label: '🤖 AI Rebellion!',    state: 'fleeing'   },
    { id: 'quantum_glitch',label: '🌀 Quantum Glitch!',  state: 'cowering'  },
  ],

  socialEvents: [
    { id: 'space_launch',  label: '🚀 Space Launch!',  state: 'celebrating', gather: 'space_port'   },
    { id: 'first_contact', label: '👽 First Contact',  state: 'celebrating', gather: 'alien_landing' },
    { id: 'tech_conf',     label: '🔬 Tech Conference',state: 'meeting',     gather: 'research_lab'  },
    { id: 'holo_concert',  label: '🎶 Holo-Concert',   state: 'celebrating', gather: 'energy_nexus'  },
  ],

  homePrefix: 'hab_',
  homeCount: 12,
  gatherWaypoint: 'energy_nexus',
  socialWaypoints: ['market', 'energy_nexus', 'alien_landing'],

  creatures: [
    { type: 'alien',       count: 3, aggressive: false, speed: 2.0, scale: 0.9, primaryColor: 0x44cc66, secondaryColor: 0x226644 },
    { type: 'alien_scout', count: 1, aggressive: false, speed: 4.0, scale: 0.8, primaryColor: 0xaaddaa, secondaryColor: 0x55aa77 },
  ],

  vehicles: [
    { color: 0x00ccff, glow: true }, { color: 0xff6600, glow: true },
    { color: 0xaa44ff, glow: true }, { color: 0x44ffaa, glow: true },
  ],

  buildScene(scene) {
    const group = new THREE.Group();
    group.userData.eraGroup = true;

    // Dark metallic ground with grid
    ground(group, 200, 200, 0x1a1a2e);
    // Grid lines
    const gridMat = new THREE.MeshLambertMaterial({ color: 0x224466, emissive: 0x112233 });
    for (let i = -9; i <= 9; i++) {
      const hLine = new THREE.Mesh(new THREE.PlaneGeometry(200, 0.3), gridMat);
      hLine.rotation.x = -Math.PI / 2; hLine.position.set(0, 0.02, i * 10); group.add(hLine);
      const vLine = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 200), gridMat);
      vLine.rotation.x = -Math.PI / 2; vLine.position.set(i * 10, 0.02, 0); group.add(vLine);
    }

    // Energy nexus - central glowing platform
    const nexus = vbox(20, 0.5, 20, 0x223344); nexus.position.set(0, 0.25, 0); group.add(nexus);
    const nexusGlow = new THREE.Mesh(new THREE.PlaneGeometry(18, 18),
      new THREE.MeshLambertMaterial({ color: 0x00aaff, emissive: 0x0066cc, transparent: true, opacity: 0.5 }));
    nexusGlow.rotation.x = -Math.PI / 2; nexusGlow.position.set(0, 0.51, 0); group.add(nexusGlow);

    // Central energy spire
    const spire = vbox(1, 12, 1, 0x334455); spire.position.set(0, 6, 0); group.add(spire);
    const spireTop = new THREE.Mesh(new THREE.OctahedronGeometry(1.5),
      new THREE.MeshLambertMaterial({ color: 0x00ccff, emissive: 0x0088ff, emissiveIntensity: 1 }));
    spireTop.position.set(0, 12, 0); group.add(spireTop);
    const spireLight = new THREE.PointLight(0x00aaff, 2, 30); spireLight.position.set(0, 12, 0); group.add(spireLight);

    // Skyscrapers - office/research
    group.add(futureBuilding(22, -10, 12, 10, 22, 0x223344, 0x00aaff));
    group.add(futureBuilding(28, -6, 8, 8, 30, 0x1a2a3a, 0x0088ff));  // tallest
    group.add(futureBuilding(16, -16, 8, 8, 15, 0x2a3a4a, 0x44aaff));

    // Bio-dome
    group.add(bioDome(-24, -12, 9, 0x44ffaa, 0x335544));
    const innerPlant = vbox(6, 5, 6, 0x225533); innerPlant.position.set(-24, 2.5, -12); group.add(innerPlant);

    // Hacker den (low, dark)
    group.add(futureBuilding(-28, 6, 10, 8, 4, 0x111122, 0x00ff44));

    // Quantum lab
    group.add(futureBuilding(28, 6, 10, 9, 8, 0x1a2266, 0x8866ff));

    // Alien landing zone
    const landPad = vbox(18, 0.3, 18, 0x2a3a2a); landPad.position.set(6, 0.15, 28); group.add(landPad);
    const padGlow = new THREE.Mesh(new THREE.CircleGeometry(7, 16),
      new THREE.MeshLambertMaterial({ color: 0x44ff88, emissive: 0x22cc44, transparent: true, opacity: 0.6 }));
    padGlow.rotation.x = -Math.PI / 2; padGlow.position.set(6, 0.46, 28); group.add(padGlow);
    // Landing beacons
    [[0,-7],[7,0],[0,7],[-7,0]].forEach(([dx,dz]) => {
      const beacon = vbox(0.3, 1.5, 0.3, 0x44ff88); beacon.position.set(6 + dx, 0.75, 28 + dz); group.add(beacon);
    });

    // Space port
    const spaceBase = vbox(30, 0.5, 20, 0x223344); spaceBase.position.set(0, 0.25, -38); group.add(spaceBase);
    const launchPad = vbox(10, 0.4, 10, 0x334455); launchPad.position.set(0, 0.7, -38); group.add(launchPad);
    const launchGlow = new THREE.Mesh(new THREE.CircleGeometry(4, 12),
      new THREE.MeshLambertMaterial({ color: 0xff6600, emissive: 0xcc4400, transparent: true, opacity: 0.7 }));
    launchGlow.rotation.x = -Math.PI / 2; launchGlow.position.set(0, 1.12, -38); group.add(launchGlow);
    // Rocket on pad
    const rocketBody = vbox(2, 8, 2, 0xddddee); rocketBody.position.set(0, 5, -38); group.add(rocketBody);
    const rocketNose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 8),
      new THREE.MeshLambertMaterial({ color: 0xccccdd })); rocketNose.position.set(0, 10, -38); group.add(rocketNose);
    const rocketGlow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 8),
      new THREE.MeshLambertMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 1, transparent: true, opacity: 0.8 }));
    rocketGlow.rotation.z = Math.PI; rocketGlow.position.set(0, 0.5, -38); group.add(rocketGlow);

    // Upload terminal (data center)
    group.add(futureBuilding(-8, -15, 10, 8, 6, 0x334455, 0x44aaff));

    // Energy towers
    [[30,-30,14,0xff6600],[- 32,-25,12,0x00aaff],[32,25,10,0xaa44ff],[-28,30,11,0x44ffaa]].forEach(([x,z,h,c]) => group.add(energyTower(x, z, h, c)));

    // Market platform
    const mkt = vbox(16, 0.4, 12, 0x223344); mkt.position.set(0, 0.2, 14); group.add(mkt);
    const mktGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 10),
      new THREE.MeshLambertMaterial({ color: 0xaa44ff, emissive: 0x6622aa, transparent: true, opacity: 0.4 }));
    mktGlow.rotation.x = -Math.PI / 2; mktGlow.position.set(0, 0.62, 14); group.add(mktGlow);

    // Hab pods (homes) - sleek rounded boxes
    [[-12,8],[12,8],[-14,22],[14,22],[-6,30],[8,32],[-26,0],[26,-2],[-4,-18],[6,-18],[-32,20],[34,10]].forEach(([x,z]) => {
      const hab = vbox(5, 3, 4, 0x223344); hab.position.set(x, 1.5, z); group.add(hab);
      const habGlow = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.1, 4.1),
        new THREE.MeshLambertMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.5 }));
      habGlow.position.set(x, 0.05, z); group.add(habGlow);
      const habTop = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.1, 4.1),
        new THREE.MeshLambertMaterial({ color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.5 }));
      habTop.position.set(x, 3.05, z); group.add(habTop);
    });

    // Energy beam pillars
    const beamMat = new THREE.MeshLambertMaterial({ color: 0x00ccff, emissive: 0x0088ff, transparent: true, opacity: 0.3 });
    [[0,0,22,-10],[0,0,-24,-12],[22,-10,28,6]].forEach(([x1,z1,x2,z2]) => {
      const len = Math.sqrt((x2-x1)**2 + (z2-z1)**2);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, len, 6), beamMat);
      beam.position.set((x1+x2)/2, 3, (z1+z2)/2);
      beam.rotation.z = Math.PI / 2;
      beam.rotation.y = Math.atan2(z2-z1, x2-x1);
      group.add(beam);
    });

    scene.add(group);
    return group;
  }
};
