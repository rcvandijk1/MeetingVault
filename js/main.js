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

import { DNA } from './life/genetics.js';
import { LifecycleSystem, genesisName } from './life/lifecycle.js';
import { ChunkManager, CHUNK_SIZE } from './world/chunk-manager.js';
import { ExplorationSystem } from './exploration.js';

// ── Scene ──────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container');
const { renderer, scene, camera, controls: orbitControls, updateLighting } = setupScene(container);

// ── Systems ────────────────────────────────────────────────────────────────
const timeSystem    = new TimeSystem();
const barterSystem  = new BarterSystem();
const weatherSystem = new WeatherSystem(scene);
const eventSystem   = new EventSystem(scene);
const eraManager    = new EraManager(scene, [StoneAge, MiddleAges, Modern, Futuristic]);
const specials      = new SpecialEntities(scene);
const lifecycle     = new LifecycleSystem();
eventSystem.setCamera(camera);

let inhabitants = [];

// ── Genesis state ──────────────────────────────────────────────────────────
let genesisMode    = false;
let chunkManager   = null;
let explorationSys = null;
let maxGeneration  = 0;

// ── Era loading ────────────────────────────────────────────────────────────
function loadEra(eraId) {
  _clearWorld();
  genesisMode = false;

  const era = eraManager.load(eraId);
  if (!era) return;

  weatherSystem.loadEraWeather(era.weatherOptions);
  eventSystem.loadEra(era);
  resetNameIndex();

  const pf    = eraManager.pathfinding;
  const homes = eraManager.homeWaypoints;
  const count = Math.min(era.careers.length, homes.length);

  for (let i = 0; i < count; i++) {
    inhabitants.push(new Inhabitant(
      era.careers[i % era.careers.length],
      homes[i % homes.length],
      scene, barterSystem, pf
    ));
  }

  inhabitants.forEach(inh => { inh._animTimer = Math.random() * 10; });
  specials.spawn(era, era.waypoints);

  const titleEl = document.getElementById('era-title');
  if (titleEl) titleEl.textContent = `${era.emoji} ${era.name} — ${era.subtitle}`;
}

// ── Genesis loading ────────────────────────────────────────────────────────
function loadGenesis() {
  _clearWorld();
  genesisMode  = true;
  maxGeneration = 0;

  if (chunkManager) chunkManager.disposeAll();
  chunkManager   = new ChunkManager(scene);
  explorationSys = new ExplorationSystem(chunkManager);

  // Discover starting chunk
  chunkManager.discover(0, 0);

  // Apply Stone Age weather (mild)
  weatherSystem.loadEraWeather(StoneAge.weatherOptions);
  weatherSystem.setWeather('clear');

  // Genesis era for event system (Stone Age disasters)
  eventSystem.loadEra(StoneAge);

  const adamDNA = new DNA({ skinTone:0.55, strength:0.65, speed:0.55, intelligence:0.5, fertility:0.7 });
  const eveDNA  = new DNA({ skinTone:0.52, strength:0.45, speed:0.60, intelligence:0.62, fertility:0.75 });

  const adamCareer = StoneAge.careers.find(c=>c.id==='hunter') || StoneAge.careers[0];
  const eveCareer  = StoneAge.careers.find(c=>c.id==='gatherer') || StoneAge.careers[1];

  const adam = new Inhabitant(adamCareer, {x:0,z:0}, scene, barterSystem, null,
    { name:'Adam', dna:adamDNA, age:25, lifeStage:'adult', gender:'male',  generation:0, deathAge:75 });
  const eve  = new Inhabitant(eveCareer,  {x:2,z:2}, scene, barterSystem, null,
    { name:'Eve',  dna:eveDNA,  age:23, lifeStage:'adult', gender:'female', generation:0, deathAge:78 });

  inhabitants.push(adam, eve);

  const titleEl = document.getElementById('era-title');
  if (titleEl) titleEl.textContent = '🌱 Genesis — In the Beginning';
}

// ── Birth callback ─────────────────────────────────────────────────────────
function onBirth(mother, father) {
  const childDNA = father?.dna
    ? DNA.combine(mother.dna, father.dna)
    : new DNA({ ...mother.dna, skinTone: mother.dna.skinTone + (Math.random()-0.5)*0.1 });

  const generation = Math.max(mother.generation, father?.generation ?? 0) + 1;
  if (generation > maxGeneration) maxGeneration = generation;

  const gender  = Math.random() < 0.5 ? 'male' : 'female';
  const name    = genesisName(gender);

  // Assign career by DNA traits
  const career = _pickCareer(childDNA);

  const child = new Inhabitant(career, { x: mother.pos.x, z: mother.pos.z }, scene, barterSystem, null, {
    name, dna: childDNA, age: 0, lifeStage: 'infant', gender, generation,
    parents: { mother: mother.name, father: father?.name ?? '?' },
    deathAge: 65 + Math.random() * 25,
  });

  child.homePos = { x: mother.pos.x, z: mother.pos.z };
  inhabitants.push(child);
}

// ── Death callback ─────────────────────────────────────────────────────────
function onDeath(inh) {
  inh.dispose();
  inhabitants = inhabitants.filter(i => i !== inh);
  if (inh.spouse) inh.spouse.spouse = null;
}

// ── Career assignment by DNA ───────────────────────────────────────────────
function _pickCareer(dna) {
  const careers = StoneAge.careers;
  if (dna.strength > 0.65)     return careers.find(c=>c.id==='hunter')    || careers[0];
  if (dna.intelligence > 0.65) return careers.find(c=>c.id==='shaman')    || careers[0];
  if (dna.speed > 0.65)        return careers.find(c=>c.id==='gatherer')  || careers[0];
  return careers[Math.floor(Math.random() * careers.length)];
}

// ── World cleanup ──────────────────────────────────────────────────────────
function _clearWorld() {
  inhabitants.forEach(i => i.dispose());
  inhabitants = [];
  specials.clear();
  if (eraManager._sceneGroup) {
    eraManager.scene.remove(eraManager._sceneGroup);
    eraManager._disposeGroup(eraManager._sceneGroup);
    eraManager._sceneGroup = null;
  }
  if (chunkManager) { chunkManager.disposeAll(); chunkManager = null; }
}

// ── UI ─────────────────────────────────────────────────────────────────────
const systems = {
  weather:     weatherSystem,
  events:      eventSystem,
  time:        timeSystem,
  inhabitants: () => inhabitants,
  isGenesis:   () => genesisMode,
  chunkManager:() => chunkManager,
  maxGeneration:()  => maxGeneration,
};
const ui = buildUI(systems, eraManager, (eraId) => {
  if (eraId === 'genesis') { loadGenesis(); }
  else                     { loadEra(eraId); }
  ui.rerender?.();
});

// ── Raycasting ─────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let selectedInhabitant = null;
let _selectionRing     = null;

renderer.domElement.addEventListener('click', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((e.clientX-rect.left)/rect.width)  * 2 - 1;
  mouse.y = -((e.clientY-rect.top) /rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(inhabitants.map(i=>i.body), true);

  if (_selectionRing) { scene.remove(_selectionRing); _selectionRing=null; }

  if (hits.length>0) {
    let obj=hits[0].object;
    while (obj.parent&&!inhabitants.find(i=>i.body===obj)) obj=obj.parent;
    const inh=inhabitants.find(i=>i.body===obj);
    selectedInhabitant=inh||null;
    if (inh) {
      _selectionRing=new THREE.Mesh(
        new THREE.RingGeometry(0.6,0.85,16),
        new THREE.MeshBasicMaterial({color:0xffff00,side:THREE.DoubleSide,depthWrite:false})
      );
      _selectionRing.rotation.x=-Math.PI/2;
      _selectionRing.position.set(inh.pos.x,0.05,inh.pos.z);
      scene.add(_selectionRing);
    }
  } else { selectedInhabitant=null; }
  ui.showInhabitant(selectedInhabitant);
});

// ── Game Loop ──────────────────────────────────────────────────────────────
let lastTime   = performance.now();
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt  = Math.min((now-lastTime)/1000, 0.1);
  lastTime  = now;
  frameCount++;

  timeSystem.update(dt);
  weatherSystem.update(dt);
  eventSystem.update(dt, inhabitants);

  const era      = eraManager.current;
  const pf       = eraManager.pathfinding;
  const socialWPs = eraManager.socialWaypoints;

  // Weather mood penalty
  const moodHit = weatherSystem.moodPenalty;
  if (moodHit>0 && frameCount%30===0) {
    inhabitants.forEach(i => { i.mood=Math.max(0,i.mood-moodHit); });
  }

  // Gravity anomaly (futuristic)
  if (weatherSystem.gravityMode) {
    inhabitants.forEach(i => {
      if (i.state!=='sleeping') i.body.position.y=0.5+0.3*Math.abs(Math.sin(frameCount*0.02+i.pos.x));
    });
  }

  // Inhabitant updates
  for (const inh of inhabitants) {
    inh.update(dt, timeSystem, weatherSystem, inhabitants, socialWPs);
  }

  specials.update(dt, inhabitants, !!eventSystem.activeEvent &&
    ['predator','alien_invasion','ai_rebellion','fire','saber_tooth'].includes(eventSystem.activeEvent));

  // Era auto-barter
  if (!genesisMode && frameCount%60===0 && pf) {
    const gatherWP  = eraManager.gatherWaypoint;
    const gatherPos = pf.waypointPos(gatherWP);
    const atGather  = inhabitants.filter(i=>i.state==='bartering'&&
      Math.abs(i.pos.x-gatherPos.x)<22&&Math.abs(i.pos.z-gatherPos.z)<22);
    for (let i=0;i<atGather.length;i++)
      for (let j=i+1;j<atGather.length;j++)
        if (Math.random()<0.35) barterSystem.trade(atGather[i],atGather[j]);
    inhabitants.forEach(i=>{ if (i.state==='eating'&&Math.random()<0.3) barterSystem.consume(i); });
    if (era?.id==='modern') {
      inhabitants.filter(i=>i.state==='working'&&!i.isOnStrike).forEach(i=>{
        i.mood=Math.max(0,i.mood-0.008);
        if (i.mood<0.15&&Math.random()<0.1) { i.isOnStrike=true; i.clearOverride(); }
      });
    }
  }

  // Genesis systems
  if (genesisMode) {
    // Lifecycle tick
    if (inhabitants.length > 0) {
      lifecycle.tick(dt, timeSystem.speed, inhabitants, onBirth, onDeath);
    }

    // Exploration
    explorationSys?.update(dt, inhabitants);

    // Biome adaptation — update _biomePressure for each inhabitant
    if (frameCount % 30 === 0 && chunkManager) {
      for (const inh of inhabitants) {
        if (!inh.dna) continue;
        const biome = chunkManager.biomeAt(inh.pos.x, inh.pos.z);
        inh._biomePressure = biome?.pressure ?? null;
      }
    }

    // Post-disaster exploration push
    if (eventSystem.activeEvent && frameCount % 120 === 0) {
      explorationSys?.onDisasterFlee(inhabitants.filter(i=>i._override==='fleeing'));
    }
  }

  // Selection ring tracking
  if (_selectionRing&&selectedInhabitant) {
    _selectionRing.position.set(selectedInhabitant.pos.x,0.05,selectedInhabitant.pos.z);
  }

  updateLighting(timeSystem, weatherSystem.current);

  if (frameCount%10===0) {
    ui.updateTime(timeSystem);
    ui.updateTrades(barterSystem);
    if (selectedInhabitant) ui.showInhabitant(selectedInhabitant);
    if (genesisMode && frameCount%60===0) ui.updateGenesis?.();
  }

  orbitControls.update();
  renderer.render(scene, camera);
}

// ── Start ──────────────────────────────────────────────────────────────────
loadEra('middle-ages');
animate();
