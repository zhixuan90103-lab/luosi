/**
 * Screw table. Orthographic camera looks along −Z.
 * Angle 0 is +X, counterclockwise, and mesh.rotation.z is that same θ.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DESIGN_HEIGHT, DESIGN_WIDTH, isInDesignBounds, type StageLayout } from '../adapt/design';
import { aimNut, nutMesh, PART, screwMesh } from './parts';
import { nutAt, nutAxis, nutSpin, nutWorld, screwAt, screwHeld, screwSlideAxis, seatedLayout, slideNut, slideScrew } from './screws';
import type { Board } from './board';
import { pulseHaptic } from './hapticFeel';
import {
  boardBounds,
  cameraForFit,
  FRAME_MARGIN,
  frameFor,
  viewSize,
  worldFromDesign,
  type Aabb,
  type Frame,
  type UsableRect,
} from './camera';

export type PlayHandles = {
  resize: () => void;
  dispose: () => void;
  replace: (next: Board) => void;
  frame: () => void;
  setEditing: (on: boolean) => void;
};

function disposeObject(object: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of list) materials.add(material);
    }
  });
  for (const material of materials) material.dispose();
}

export function mountPlay(options: {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  canvas: HTMLCanvasElement;
  getLayout: () => StageLayout | null;
  onStatus: (text: string) => void;
  onScore?: (points: number) => void;
  onCleared?: () => void;
}): PlayHandles {
  const { renderer, scene, camera, canvas, onCleared } = options;
  const root = new THREE.Group();
  scene.add(root);

  let board: Board = { screws: [] };

  let nutViews: { id: string; mesh: THREE.Mesh }[] = [];
  let screwViews: { id: string; mesh: THREE.Object3D }[] = [];
  let buckleViews: { screwId: string; mesh: THREE.Object3D }[] = [];
  let fallers: { mesh: THREE.Object3D; vx: number; vy: number; spin: number }[] = [];
  let nutDrag: { id: string; t0: number; x: number; y: number } | null = null;
  let nutStopped = false;
  let screwDrag: { id: string; x0: number; y0: number; x: number; y: number } | null = null;
  let screwStopped = false;
  let pointerId: number | null = null;
  let awaitingNext = false;
  let bounds: Aabb = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let limits: Frame = frameFor(bounds, {
    left: FRAME_MARGIN,
    top: FRAME_MARGIN,
    right: DESIGN_WIDTH - FRAME_MARGIN,
    bottom: DESIGN_HEIGHT - FRAME_MARGIN,
  });

  let last = performance.now();

  function designToWorld(dx: number, dy: number): { x: number; y: number } {
    return worldFromDesign(dx, dy, camera.position.x, camera.position.y, camera.zoom);
  }

  function worldFromEvent(event: PointerEvent): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const dx = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const dy = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    if (!isInDesignBounds(dx, dy)) return null;
    return designToWorld(dx, dy);
  }

  function clearViews(): void {
    for (const view of [...nutViews, ...screwViews, ...buckleViews]) {
      root.remove(view.mesh);
      disposeObject(view.mesh);
    }
    for (const faller of fallers) {
      root.remove(faller.mesh);
      disposeObject(faller.mesh);
    }
    nutViews = [];
    screwViews = [];
    buckleViews = [];
    fallers = [];
    nutDrag = null;
    screwDrag = null;
  }

  function showLevel(): void {
    clearViews();
    const { depth, scale } = PART;
    for (const screw of board.screws) {
      const mesh = screwMesh(screw.kind, depth * scale, screw.color ?? 0x9aa3a8, seatedLayout(screw.kind).buckles);
      mesh.position.set(screw.x, screw.y, 0);
      mesh.rotation.z = screw.theta;
      mesh.traverse((obj) => {
        obj.userData.pieceId = screw.id;
      });
      root.add(mesh);
      const buckles: THREE.Object3D[] = [];
      mesh.traverse((obj) => {
        if (obj.userData.buckle) buckles.push(obj);
      });
      for (const buckle of buckles) {
        root.attach(buckle);
        buckleViews.push({ screwId: screw.id, mesh: buckle });
      }
      screwViews.push({ id: screw.id, mesh });
    }
    for (const nut of board.nuts ?? []) {
      const screw = board.screws.find((item) => item.id === nut.screwId);
      if (!screw) continue;
      const mesh = nutMesh(depth * scale, nut.color);
      mesh.userData.pieceId = nut.id;
      const at = nutWorld(screw, nut);
      mesh.position.set(at.x, at.y, 0);
      const axis = nutAxis(screw, nut);
      aimNut(mesh, axis.x, axis.y);
      mesh.rotateZ(nutSpin(nut.t));
      root.add(mesh);
      nutViews.push({ id: nut.id, mesh });
    }
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && !obj.userData.fakeShadow && !obj.userData.noShadow) obj.castShadow = true;
    });
  }

  function placeNutMesh(id: string): void {
    const nut = board.nuts?.find((item) => item.id === id);
    const screw = board.screws.find((item) => item.id === nut?.screwId);
    const view = nutViews.find((item) => item.id === id);
    if (!nut || !screw || !view) return;
    const at = nutWorld(screw, nut);
    view.mesh.position.set(at.x, at.y, 0);
    const axis = nutAxis(screw, nut);
    aimNut(view.mesh, axis.x, axis.y);
    view.mesh.rotateZ(nutSpin(nut.t));
  }

  function dropMesh(mesh: THREE.Object3D, vx: number, vy: number): void {
    nutViews = nutViews.filter((item) => item.mesh !== mesh);
    screwViews = screwViews.filter((item) => item.mesh !== mesh);
    fallers.push({ mesh, vx, vy, spin: (Math.random() - 0.5) * 4 });
  }

  function placeScrew(id: string): void {
    const screw = board.screws.find((item) => item.id === id);
    const view = screwViews.find((item) => item.id === id);
    if (!screw || !view) return;
    view.mesh.position.set(screw.x, screw.y, 0);
    for (const nut of board.nuts ?? []) {
      if (nut.screwId === id) placeNutMesh(nut.id);
    }
  }

  function noteClear(): void {
    if (board.screws.length === 0 && (board.nuts?.length ?? 0) === 0) awaitingNext = true;
  }

  function dropScrew(id: string, vx: number, vy: number): void {
    const view = screwViews.find((item) => item.id === id);
    const nuts = (board.nuts ?? []).filter((nut) => nut.screwId === id);
    board.screws = board.screws.filter((screw) => screw.id !== id);
    board.nuts = (board.nuts ?? []).filter((nut) => nut.screwId !== id);
    if (view) dropMesh(view.mesh, vx, vy);
    for (const nut of nuts) {
      const nutView = nutViews.find((item) => item.id === nut.id);
      if (nutView) dropMesh(nutView.mesh, vx, vy);
    }
    for (const buckle of buckleViews) {
      if (buckle.screwId !== id) continue;
      dropMesh(buckle.mesh, vx, vy);
    }
    buckleViews = buckleViews.filter((buckle) => buckle.screwId !== id);
    noteClear();
  }

  function finishLoose(cancel: boolean): void {
    const drag = screwDrag;
    screwDrag = null;
    screwStopped = false;
    if (!drag) return;
    const screw = board.screws.find((item) => item.id === drag.id);
    if (!screw) return;
    if (cancel || screwHeld(screw, board.nuts ?? [])) {
      if (cancel) {
        screw.x = drag.x0;
        screw.y = drag.y0;
        placeScrew(screw.id);
      }
      return;
    }
    const axis = screwSlideAxis(screw);
    const along = (screw.x - drag.x0) * axis.x + (screw.y - drag.y0) * axis.y;
    const sign = Math.sign(along) || 1;
    dropScrew(screw.id, axis.x * sign * 0.8, axis.y * sign * 0.8);
    pulseHaptic('clear');
  }

  function moveScrew(world: { x: number; y: number }): void {
    if (!screwDrag) return;
    const dragId = screwDrag.id;
    const screw = board.screws.find((item) => item.id === dragId);
    if (!screw) return;
    const axis = screwSlideAxis(screw);
    const along = (world.x - screwDrag.x) * axis.x + (world.y - screwDrag.y) * axis.y;
    screw.x = screwDrag.x0;
    screw.y = screwDrag.y0;
    const result = slideScrew(board.screws, board.nuts ?? [], screw.id, axis.x * along, axis.y * along);
    if (result.blocked && !screwStopped) pulseHaptic('hit');
    screwStopped = result.blocked;
    placeScrew(screw.id);
  }

  function moveNut(world: { x: number; y: number }): void {
    if (!nutDrag || !board.nuts) return;
    const dragId = nutDrag.id;
    const nut = board.nuts.find((item) => item.id === dragId);
    const screw = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !screw) return;
    const axis = nutAxis(screw, nut);
    const target = nutDrag.t0 + (world.x - nutDrag.x) * axis.x + (world.y - nutDrag.y) * axis.y;
    const result = slideNut(board.nuts, board.screws, nut.id, target);
    if (result.exited) {
      const view = nutViews.find((item) => item.id === dragId);
      if (view) dropMesh(view.mesh, axis.x * 2.4, axis.y * 2.4);
      nutDrag = null;
      nutStopped = false;
      pulseHaptic('clear');
      noteClear();
      return;
    }
    if (result.blocked && !nutStopped) pulseHaptic('hit');
    nutStopped = result.blocked;
    placeNutMesh(nut.id);
  }

  function usableRect(): UsableRect {
    const stage = canvas.parentElement;
    const stageRect = stage?.getBoundingClientRect();
    let top = FRAME_MARGIN;
    let bottom = DESIGN_HEIGHT - FRAME_MARGIN;
    const left = FRAME_MARGIN;
    const right = DESIGN_WIDTH - FRAME_MARGIN;
    if (!stageRect || stageRect.width <= 0 || stageRect.height <= 0) {
      return { left, top, right, bottom };
    }
    const designY = (clientY: number) => ((clientY - stageRect.top) / stageRect.height) * DESIGN_HEIGHT;
    const header = document.querySelector('#ui-root header');
    const dock = document.querySelector('#dock');
    if (header) top = Math.max(top, designY(header.getBoundingClientRect().bottom) + FRAME_MARGIN);
    if (dock) {
      const dockRect = dock.getBoundingClientRect();
      if (dockRect.height > 0) bottom = Math.min(bottom, designY(dockRect.top) - FRAME_MARGIN);
    }
    if (bottom - top < 80) return { left, top: FRAME_MARGIN, right, bottom: DESIGN_HEIGHT - FRAME_MARGIN };
    return { left, top, right, bottom };
  }

  function applyFrame(): void {
    const { w, h } = viewSize();
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    bounds = boardBounds(board);
    limits = frameFor(bounds, usableRect());
    const fit = cameraForFit(bounds, limits);
    camera.zoom = fit.zoom;
    camera.position.set(fit.x, fit.y, 12);
    camera.lookAt(fit.x, fit.y, 0);
    camera.updateProjectionMatrix();
  }

  function onPointerDown(event: PointerEvent): void {
    if (pointerId !== null || awaitingNext) return;
    const world = worldFromEvent(event);
    if (!world) return;
    const nut = nutAt(board.nuts ?? [], board.screws, world.x, world.y);
    if (nut) {
      pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      nutDrag = { id: nut.id, t0: nut.t, x: world.x, y: world.y };
      nutStopped = false;
      pulseHaptic('grab');
      return;
    }
    const screw = screwAt(board.screws, board.nuts ?? [], world.x, world.y);
    if (!screw) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    screwDrag = { id: screw.id, x0: screw.x, y0: screw.y, x: world.x, y: world.y };
    screwStopped = false;
    pulseHaptic('grab');
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const world = worldFromEvent(event);
    if (!world) return;
    if (nutDrag) moveNut(world);
    else if (screwDrag) moveScrew(world);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointerId = null;
    nutDrag = null;
    finishLoose(false);
    if (awaitingNext) {
      awaitingNext = false;
      onCleared?.();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function tick(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const view = viewSize();
    const zoom = Math.max(camera.zoom, 1e-4);
    const viewBottom = camera.position.y - view.h / 2 / zoom;
    const viewTop = camera.position.y + view.h / 2 / zoom;
    const viewLeft = camera.position.x - view.w / 2 / zoom;
    const viewRight = camera.position.x + view.w / 2 / zoom;
    let alive = 0;
    for (const faller of fallers) {
      faller.vy += -30 * dt;
      faller.mesh.position.x += faller.vx * dt;
      faller.mesh.position.y += faller.vy * dt;
      faller.mesh.rotation.z += faller.spin * dt;
      const x = faller.mesh.position.x;
      const y = faller.mesh.position.y;
      if (x < viewLeft - 0.8 || x > viewRight + 0.8 || y < viewBottom - 0.8 || y > viewTop + 0.8) {
        disposeObject(faller.mesh);
        root.remove(faller.mesh);
        continue;
      }
      fallers[alive] = faller;
      alive += 1;
    }
    fallers.length = alive;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    resize: () => applyFrame(),
    dispose: () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      clearViews();
      scene.remove(root);
    },
    replace: (next) => {
      board = next;
      awaitingNext = false;
      showLevel();
    },
    frame: () => applyFrame(),
    setEditing: () => {},
  };
}
