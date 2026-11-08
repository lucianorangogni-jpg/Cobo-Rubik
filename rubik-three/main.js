import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- 1. Inicialización y Escena ---
const container = document.getElementById('canvas-container') || document.body;
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(6, 5, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Iluminación
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
dirLight.position.set(10, 15, 10);
scene.add(dirLight);

// --- 2. Construcción de los 27 Cubos ---
const SPACING = 1.05;
const geometry = new THREE.BoxGeometry(1, 1, 1);

const COLORS = {
  R: 0xb71234, // Rojo (+X)
  O: 0xff5800, // Naranja (-X)
  W: 0xffffff, // Blanco (+Y)
  Y: 0xffd500, // Amarillo (-Y)
  G: 0x009b48, // Verde (+Z)
  B: 0x0046ad, // Azul (-Z)
  K: 0x181818  // Interior negro
};

const cubies = [];

for (let x = -1; x <= 1; x++) {
  for (let y = -1; y <= 1; y++) {
    for (let z = -1; z <= 1; z++) {
      const materials = [
        new THREE.MeshStandardMaterial({ color: x === 1  ? COLORS.R : COLORS.K, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: x === -1 ? COLORS.O : COLORS.K, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: y === 1  ? COLORS.W : COLORS.K, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: y === -1 ? COLORS.Y : COLORS.K, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: z === 1  ? COLORS.G : COLORS.K, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: z === -1 ? COLORS.B : COLORS.K, roughness: 0.2 }),
      ];

      const cubie = new THREE.Mesh(geometry, materials);
      cubie.position.set(x * SPACING, y * SPACING, z * SPACING);
      scene.add(cubie);
      cubies.push(cubie);
    }
  }
}

// --- 3. Motor de Animación y Cola de Movimientos ---
const pivot = new THREE.Object3D();
scene.add(pivot);

const moveQueue = [];
let isProcessingQueue = false;

/**
 * Añade un movimiento a la cola de ejecución.
 * @param {'x'|'y'|'z'} axis Eje de giro
 * @param {number} layer Índice de capa (-1, 0, 1)
 * @param {number} angle Ángulo en radianes (Math.PI / 2 o -Math.PI / 2)
 * @param {number} duration Duración de la animación en milisegundos
 */
function queueMove(axis, layer, angle, duration = 200) {
  moveQueue.push({ axis, layer, angle, duration });
  processQueue();
}

async function processQueue() {
  if (isProcessingQueue || moveQueue.length === 0) return;
  isProcessingQueue = true;

  while (moveQueue.length > 0) {
    const move = moveQueue.shift();
    await executeRotation(move.axis, move.layer, move.angle, move.duration);
  }

  isProcessingQueue = false;
}

function executeRotation(axis, layer, angle, duration) {
  return new Promise((resolve) => {
    // 1. Resetear el pivote central
    pivot.rotation.set(0, 0, 0);
    pivot.position.set(0, 0, 0);
    pivot.updateMatrixWorld();

    // 2. Filtrar y adjuntar las 9 piezas de la capa indicada
    const activeCubies = cubies.filter((c) => {
      const worldPos = new THREE.Vector3();
      c.getWorldPosition(worldPos);
      return Math.round(worldPos[axis] / SPACING) === layer;
    });

    activeCubies.forEach((c) => pivot.attach(c));

    // 3. Animación por interpolación
    const startTime = performance.now();

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing suave (quad out)
      const ease = 1 - Math.pow(1 - progress, 2);
      pivot.rotation[axis] = angle * ease;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        pivot.rotation[axis] = angle;
        pivot.updateMatrixWorld();

        // 4. Desvincular cubitos y consolidar posición en coordenadas discretas
        activeCubies.forEach((c) => {
          scene.attach(c);
          c.position.x = Math.round(c.position.x / SPACING) * SPACING;
          c.position.y = Math.round(c.position.y / SPACING) * SPACING;
          c.position.z = Math.round(c.position.z / SPACING) * SPACING;
        });

        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

// --- 4. Algoritmo para Desordenar (Scramble) ---
function scrambleCube(movesCount = 20) {
  if (isProcessingQueue) return;

  const axes = ['x', 'y', 'z'];
  const layers = [-1, 1]; // Capas exteriores
  const angles = [Math.PI / 2, -Math.PI / 2];

  let lastMove = null;

  for (let i = 0; i < movesCount; i++) {
    let axis, layer, angle;

    // Evitar anular de inmediato el movimiento anterior en el mismo eje y capa
    do {
      axis = axes[Math.floor(Math.random() * axes.length)];
      layer = layers[Math.floor(Math.random() * layers.length)];
      angle = angles[Math.floor(Math.random() * angles.length)];
    } while (
      lastMove &&
      lastMove.axis === axis &&
      lastMove.layer === layer &&
      lastMove.angle === -angle
    );

    lastMove = { axis, layer, angle };
    // Animación más rápida para la mezcla (80ms por giro)
    queueMove(axis, layer, angle, 80);
  }
}

// --- 5. Interacción de Arrastre con Raycaster ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let startMousePos = { x: 0, y: 0 };
let clickedCubie = null;
let clickedNormal = null;

function getNormalizedCoords(event) {
  return {
    x: (event.clientX / window.innerWidth) * 2 - 1,
    y: -(event.clientY / window.innerHeight) * 2 + 1,
  };
}

window.addEventListener('pointerdown', (e) => {
  // Ignorar clics si el cubo está procesando movimientos o el clic fue sobre botones UI
  if (isProcessingQueue || (e.target.tagName && e.target.tagName.toLowerCase() === 'button')) {
    return;
  }

  const coords = getNormalizedCoords(e);
  mouse.x = coords.x;
  mouse.y = coords.y;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(cubies);

  if (intersects.length > 0) {
    const hit = intersects[0];
    clickedCubie = hit.object;

    // Obtener la normal en coordenadas del mundo
    clickedNormal = hit.face.normal.clone();
    clickedNormal.transformDirection(clickedCubie.matrixWorld).round();

    startMousePos = { x: e.clientX, y: e.clientY };
    controls.enabled = false; // Detener rotación de cámara
  }
});

window.addEventListener('pointerup', (e) => {
  if (!clickedCubie) {
    controls.enabled = true;
    return;
  }

  const deltaX = e.clientX - startMousePos.x;
  const deltaY = e.clientY - startMousePos.y;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance > 20 && !isProcessingQueue) {
    handleDrag(deltaX, deltaY);
  }

  clickedCubie = null;
  clickedNormal = null;
  controls.enabled = true;
});

function handleDrag(deltaX, deltaY) {
  // Orientación de la cámara para proyectar el arrastre 2D en el espacio 3D
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  camera.matrixWorld.extractBasis(camRight, camUp, new THREE.Vector3());

  const dragDir = new THREE.Vector3()
    .addScaledVector(camRight, deltaX)
    .addScaledVector(camUp, -deltaY)
    .normalize();

  // Producto vectorial: perpendicular a la cara y a la dirección de arrastre
  const rawAxis = new THREE.Vector3().crossVectors(clickedNormal, dragDir);

  const absX = Math.abs(rawAxis.x);
  const absY = Math.abs(rawAxis.y);
  const absZ = Math.abs(rawAxis.z);

  let axis = 'x';
  let maxComponent = rawAxis.x;

  if (absY > absX && absY > absZ) {
    axis = 'y';
    maxComponent = rawAxis.y;
  } else if (absZ > absX && absZ > absY) {
    axis = 'z';
    maxComponent = rawAxis.z;
  }

  const direction = maxComponent > 0 ? 1 : -1;
  const angle = direction * (Math.PI / 2);

  const worldPos = new THREE.Vector3();
  clickedCubie.getWorldPosition(worldPos);
  const layer = Math.round(worldPos[axis] / SPACING);

  queueMove(axis, layer, angle, 200);
}

// --- 6. Atajos de Teclado y Botón en Interfaz ---
window.addEventListener('keydown', (e) => {
  const key = e.key.toUpperCase();
  if (key === 'S') scrambleCube(20);
  if (key === 'U') queueMove('y', 1, -Math.PI / 2, 200);
  if (key === 'R') queueMove('x', 1, -Math.PI / 2, 200);
  if (key === 'F') queueMove('z', 1, -Math.PI / 2, 200);
});

// Inyección automática del botón Desordenar en el panel UI
const uiContainer = document.getElementById('ui');
if (uiContainer) {
  const btn = document.createElement('button');
  btn.textContent = '🎲 Desordenar Cubo (S)';
  btn.style.marginTop = '10px';
  btn.style.padding = '8px 12px';
  btn.style.background = '#00ff88';
  btn.style.color = '#121212';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.fontWeight = 'bold';
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => scrambleCube(20));
  uiContainer.appendChild(btn);
}

// --- 7. Evento Resize y Loop de Render ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();