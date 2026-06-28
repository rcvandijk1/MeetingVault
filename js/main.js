import * as THREE from 'three';
import { setupScene } from './scene.js';
import { Inhabitant, resetNameIndex } from './inhabitant.js';
import { TimeSystem } from './time.js';
import { BarterSystem } from './barter.js';
import { WeatherSystem } from './weather.js';
import { EventSystem } from './events.js';
import { EraManager } from './era-manager.js';
import { SpecialEntities } from './special-entities.js';
import { buildUI } from './controls.js';

import StoneAge   from './eras/stone-age.js';
import MiddleAges from './eras/middle-ages.js';
import Modern     from './eras/modern.js';
import Futuristic from './eras/futuristic.js';

// ── Scene ──────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const { renderer, scene, camera, controls, updateLighting } = setupScene(container);

// ── Systems ────────────────────────────────────────────────────────────────
const timeSystem    = new TimeSystem();
const barterSystem  = new BarterSystem();
const weatherSystem = new WeatherSystem(scene);
const eventSystem   = new EventSystem(scene);
const eraManager    = new EraManager(scene, [StoneAge, MiddleAges, Modern, Futuristic]);
const specials      = new SpecialEntities(scene);
eventSystem.setCamera(camera);

let inhabitants = [];

// ── Era loading ────────────────────────────────────────────────────────────
function loadEra(eraId) {
  // Clear previous inhabitants
  inhabitants.forEach(i => i.dispose());
  inhabitants = [];
  specials.clear();

  // Load era config & rebuild scene
  const era = eraManager.load(eraId);
  if (!era) return;

  weatherSystem.loadEraWeather(era.weatherOptions);
  eventSystem.loadEra(era);

  resetNameIndex();
  const pf = eraManager.pathfinding;
  const homes = eraManager.homeWaypoints;
  const numInhabitants = Math.min(era.careers.length, homes.length);

  for (let i = 0; i < numInhabitants; i++) {
    const career = era.careers[i % era.careers.length];
    const home   = homes[i % homes.length];
    inhabitants.push(new Inhabitant(career, home, scene, barterSystem, pf));
  }

  // Offset start times so they're spread across states
  inhabitants.forEach((inh, idx) => {
    const offset = (idx / inhabitants.length) * 18; // spread over 18 hours
    inh._animTimer = Math.random() * 10;
  });

  specials.spawn(era, era.waypoints);

  // Update era title
  const titleEl = document.getElementById('era-title');
  if (titleEl) titleEl.textContent = `${era.emoji} ${era.name} — ${era.subtitle}`;
}

// ── UI ─────────────────────────────────────────────────────────────────────
const systems = {
  weather: weatherSystem,
  events: eventSystem,
  time: timeSystem,
  inhabitants: () => inhabitants,
};
const ui = buildUI(systems, eraManager, (eraId) => {
  loadEra(eraId);
  ui.rerender?.();
});

// ── Raycasting (click to select inhabitant) ────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedInhabitant = null;
let _selectionRing = null;

renderer.domElement.addEventListener('click', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(inhabitants.map(i => i.body), true);

  if (_selectionRing) { scene.remove(_selectionRing); _selectionRing = null; }

  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !inhabitants.find(i => i.body === obj)) obj = obj.parent;
    const inh = inhabitants.find(i => i.body === obj);
    selectedInhabitant = inh || null;
    if (inh) {
      _selectionRing = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.85, 16),
        new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, depthWrite: false })
      );
      _selectionRing.rotation.x = -Math.PI / 2;
      _selectionRing.position.set(inh.pos.x, 0.05, inh.pos.z);
      scene.add(_selectionRing);
    }
  } else {
    selectedInhabitant = null;
  }
  ui.showInhabitant(selectedInhabitant);
});

// ── Game Loop ──────────────────────────────────────────────────────────────
let lastTime = performance.now();
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt  = Math.min((now - lastTime) / 1000, 0.1);
  lastTime  = now;
  frameCount++;

  timeSystem.update(dt);
  weatherSystem.update(dt);
  eventSystem.update(dt, inhabitants);

  const era = eraManager.current;
  const pf  = eraManager.pathfinding;
  const socialWPs = eraManager.socialWaypoints;

  // Weather mood penalty
  const moodHit = weatherSystem.moodPenalty;
  if (moodHit > 0 && frameCount % 30 === 0) {
    inhabitants.forEach(i => { i.mood = Math.max(0, i.mood - moodHit); });
  }

  // Gravity anomaly (futuristic): inhabitants hover
  if (weatherSystem.gravityMode) {
    inhabitants.forEach(i => {
      if (i.state !== 'sleeping') i.body.position.y = 0.5 + 0.3 * Math.abs(Math.sin(frameCount * 0.02 + i.pos.x));
    });
  }

  for (const inh of inhabitants) {
    inh.update(dt, timeSystem, weatherSystem, inhabitants, socialWPs);
  }

  specials.update(dt, inhabitants, !!eventSystem.activeEvent && ['predator','alien_invasion','ai_rebellion','fire','saber_tooth'].includes(eventSystem.activeEvent));

  // Auto-barter at gathering point
  if (frameCount % 60 === 0 && pf) {
    const gatherWP = eraManager.gatherWaypoint;
    const gatherPos = pf.waypointPos(gatherWP);
    const atGather = inhabitants.filter(i =>
      i.state === 'bartering' &&
      Math.abs(i.pos.x - gatherPos.x) < 22 && Math.abs(i.pos.z - gatherPos.z) < 22
    );
    for (let i = 0; i < atGather.length; i++) {
      for (let j = i + 1; j < atGather.length; j++) {
        if (Math.random() < 0.35) barterSystem.trade(atGather[i], atGather[j]);
      }
    }
    // Consume goods
    inhabitants.forEach(i => { if (i.state === 'eating' && Math.random() < 0.3) barterSystem.consume(i); });

    // Modern: stress accumulation from overwork
    if (era?.id === 'modern') {
      inhabitants.filter(i => i.state === 'working' && !i.isOnStrike).forEach(i => {
        i.mood = Math.max(0, i.mood - 0.008);
        if (i.mood < 0.15 && Math.random() < 0.1) { i.isOnStrike = true; i.clearOverride(); }
      });
    }
  }

  // Selection ring tracking
  if (_selectionRing && selectedInhabitant) {
    _selectionRing.position.set(selectedInhabitant.pos.x, 0.05, selectedInhabitant.pos.z);
  }

  updateLighting(timeSystem, weatherSystem.current);

  if (frameCount % 10 === 0) {
    ui.updateTime(timeSystem);
    ui.updateTrades(barterSystem);
    if (selectedInhabitant) ui.showInhabitant(selectedInhabitant);
  }

  controls.update();
  renderer.render(scene, camera);
}

// ── Start ──────────────────────────────────────────────────────────────────
loadEra('middle-ages');
animate();
