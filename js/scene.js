import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function setupScene(container) {
  // Renderer — low-res for pixel art look
  const W = window.innerWidth, H = window.innerHeight;
  const SCALE = 2; // render at half res, scale up (higher = more pixel-arty)
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(Math.floor(W / SCALE), Math.floor(H / SCALE));
  renderer.domElement.style.width  = W + 'px';
  renderer.domElement.style.height = H + 'px';
  renderer.domElement.style.imageRendering = 'pixelated';
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  container.appendChild(renderer.domElement);

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 80, 200);

  // Camera
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 400);
  camera.position.set(0, 45, 65);
  camera.lookAt(0, 0, 0);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 15;
  controls.maxDistance = 160;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  // Lights
  const ambient = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5cc, 1.2);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  scene.add(sun);

  const moonLight = new THREE.DirectionalLight(0x2244aa, 0.1);
  moonLight.position.set(-40, 30, -20);
  scene.add(moonLight);

  // Stars (visible at night)
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1000 * 3);
  for (let i = 0; i < 1000; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 180;
    starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi));
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4 }));
  scene.add(stars);

  function updateLighting(timeSystem, weather, nightscope) {
    const sky = timeSystem.skyColor;
    const isNight = timeSystem.isNight;

    if (nightscope) {
      // Night vision: dark scene with green-cast ambient — CSS filter does the rest
      scene.background.setRGB(0.01, 0.04, 0.01);
      scene.fog.color.setRGB(0.01, 0.04, 0.01);
      ambient.intensity = 0.75;
      ambient.color.setHex(0x103010);
      sun.intensity = 0.05;
      moonLight.intensity = 0.55;
      moonLight.color.setHex(0x103010);
      stars.visible = true;
    } else {
      // Normal lighting
      scene.background.setRGB(
        weather === 'storm' ? sky.r * 0.4 : sky.r,
        weather === 'storm' ? sky.g * 0.4 : sky.g,
        weather === 'storm' ? sky.b * 0.4 : sky.b
      );
      scene.fog.color.copy(scene.background);
      ambient.color.setHex(0x404060);
      moonLight.color.setHex(0x2244aa);

      const h = timeSystem.hour + timeSystem.minute / 60;
      const sunIntensity = Math.max(0, Math.sin(((h - 6) / 14) * Math.PI)) * 1.2;
      sun.intensity = sunIntensity * (weather === 'storm' ? 0.1 : weather === 'cloudy' ? 0.4 : 1);
      ambient.intensity = 0.25 + sunIntensity * 0.4;
      moonLight.intensity = isNight ? 0.15 : 0.0;
      stars.visible = isNight;

      const angle = (h / 24) * Math.PI * 2 - Math.PI / 2;
      sun.position.set(Math.cos(angle) * 60, Math.sin(angle) * 60, 20);
    }
  }

  function onResize() {
    const W = window.innerWidth, H = window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.floor(W / SCALE), Math.floor(H / SCALE));
    renderer.domElement.style.width  = W + 'px';
    renderer.domElement.style.height = H + 'px';
  }
  window.addEventListener('resize', onResize);

  return { renderer, scene, camera, controls, sun, ambient, stars, updateLighting };
}
