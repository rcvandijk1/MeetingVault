import * as THREE from 'three';
import { setupScene } from './scene.js';
import { buildTerrain } from './terrain.js';
import { buildVillage } from './buildings.js';
import { Inhabitant } from './inhabitant.js';
import { TimeSystem } from './time.js';
import { BarterSystem } from './barter.js';
import { WeatherSystem } from './weather.js';
import { EventSystem } from './events.js';
import { buildUI } from './controls.js';
import { CAREERS } from './careers.js';

// ── Bootstrap ──────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const { renderer, scene, camera, controls, updateLighting } = setupScene(container);

const timeSystem    = new TimeSystem();
const barterSystem  = new BarterSystem();
const weatherSystem = new WeatherSystem(scene, renderer);
const eventSystem   = new EventSystem(scene);
eventSystem.setCamera(camera);

// ── World ──────────────────────────────────────────────────────────────────
buildTerrain(scene);
buildVillage(scene);

// ── Inhabitants ────────────────────────────────────────────────────────────
const NUM_INHABITANTS = Math.min(CAREERS.length, 12);
const inhabitants = [];
for (let i = 0; i < NUM_INHABITANTS; i++) {
  const career = CAREERS[i % CAREERS.length];
  inhabitants.push(new Inhabitant(career, scene, barterSystem));
}

// ── UI ─────────────────────────────────────────────────────────────────────
const ui = buildUI(weatherSystem, eventSystem, timeSystem, inhabitants);

// Raycasting for inhabitant selection
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let selectedInhabitant = null;
let _selectionHighlight = null;

renderer.domElement.addEventListener('click', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  // Map screen pixels to renderer pixels
  const scaleX = rect.width  / renderer.domElement.width;
  const scaleY = rect.height / renderer.domElement.height;
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const bodies = inhabitants.map(i => i.body);
  const hits = raycaster.intersectObjects(bodies, true);

  if (_selectionHighlight) { scene.remove(_selectionHighlight); _selectionHighlight = null; }

  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !inhabitants.find(i => i.body === obj)) obj = obj.parent;
    const inh = inhabitants.find(i => i.body === obj);
    if (inh) {
      selectedInhabitant = inh;
      // Selection ring
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.85, 16),
        new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(inh.pos.x, 0.05, inh.pos.z);
      scene.add(ring);
      _selectionHighlight = ring;
    } else {
      selectedInhabitant = null;
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
  const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = now;
  frameCount++;

  // Update systems
  timeSystem.update(dt);
  weatherSystem.update(dt, timeSystem);
  eventSystem.update(dt, inhabitants);

  // Update inhabitants
  for (const inh of inhabitants) {
    inh.update(dt, timeSystem, weatherSystem, inhabitants);
  }

  // Update lighting from time of day
  updateLighting(timeSystem, weatherSystem.current);

  // Move selection ring with selected inhabitant
  if (_selectionHighlight && selectedInhabitant) {
    _selectionHighlight.position.set(selectedInhabitant.pos.x, 0.05, selectedInhabitant.pos.z);
  }

  // UI updates (every 10 frames to save perf)
  if (frameCount % 10 === 0) {
    ui.updateTime(timeSystem);
    ui.updateTrades(barterSystem);
    if (selectedInhabitant) ui.showInhabitant(selectedInhabitant);
  }

  // Barter trigger: randomly attempt trades between nearby inhabitants
  if (frameCount % 60 === 0) {
    const atMarket = inhabitants.filter(i =>
      i.state === 'bartering' &&
      Math.abs(i.pos.x) < 20 && Math.abs(i.pos.z) < 20
    );
    for (let i = 0; i < atMarket.length; i++) {
      for (let j = i + 1; j < atMarket.length; j++) {
        if (Math.random() < 0.4) barterSystem.trade(atMarket[i], atMarket[j]);
      }
    }
    // Consume goods periodically
    for (const inh of inhabitants) {
      if (inh.state === 'eating' && Math.random() < 0.3) {
        barterSystem.consume(inh);
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
