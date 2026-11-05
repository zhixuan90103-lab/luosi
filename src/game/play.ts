/**
 * Screw table. Orthographic camera looks along −Z.
 * Angle 0 is +X, counterclockwise, and mesh.rotation.z is that same θ.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DESIGN_HEIGHT, DESIGN_WIDTH, isInDesignBounds, type StageLayout } from '../adapt/design';
import { mountOutline } from './outline';
import { aimNut, nutMesh, PART, screwMesh } from './parts';
import { fallPastView, FALL_FRONT, nutDepartureSpin, parkInFront, stepFall, stillSpin, type FallMotion, type FallSpin } from './fall';
import { dragScrew, nutAt, nutAxis, nutPastTip, nutSpin, nutWorld, releaseSlack, screwAt, screwHeld, screwSlideAxis, seatedLayout, slideNut, slideScrew } from './screws';
import type { Board } from './board';
import { contactLatch, mountFeedback, stepContact } from './feedback';
import { pulseHaptic } from './hapticFeel';
import { INTENT_CLEAR, INTENT_SLEEVE, axesParallel, intentWorld, strokeChoice } from './intent';
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
  let fallers: ({ mesh: THREE.Object3D } & FallMotion)[] = [];
  const spinAxis = new THREE.Vector3();
  let fallerFront = FALL_FRONT;
  let nutDrag: { id: string; t0: number; x: number; y: number; armed: boolean; free: number } | null = null;
  let screwDrag: { id: string; x0: number; y0: number; x: number; y: number; armed: boolean; free: number; sign: number; broken: boolean } | null = null;
  let pending: { x: number; y: number; nutId: string; screwId: string } | null = null;
  const feedback = mountFeedback();
  const selectionOutline = mountOutline(renderer, scene, camera);
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
  const fpsEl = document.getElementById('hud-fps');
  let fpsWindow = 0;
  let fpsFrames = 0;
  let fpsShown = -1;

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
    fallerFront = FALL_FRONT;
    feedback.clear();
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

  function dropMesh(mesh: THREE.Object3D, spin: FallSpin | null): void {
    nutViews = nutViews.filter((item) => item.mesh !== mesh);
    screwViews = screwViews.filter((item) => item.mesh !== mesh);
    fallerFront = parkInFront(mesh, fallerFront);
    fallers.push({ mesh, ...(spin ?? stillSpin()), vy: 0 });
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

  function dropScrew(id: string): void {
    const screw = board.screws.find((item) => item.id === id);
    const view = screwViews.find((item) => item.id === id);
    const nuts = (board.nuts ?? []).filter((nut) => nut.screwId === id);
    const out = screw ? screwSlideAxis(screw) : { x: 1, y: 0 };
    board.screws = board.screws.filter((item) => item.id !== id);
    board.nuts = (board.nuts ?? []).filter((nut) => nut.screwId !== id);
    if (view) dropMesh(view.mesh, null);
    for (const nut of nuts) {
      const nutView = nutViews.find((item) => item.id === nut.id);
      if (nutView) dropMesh(nutView.mesh, nutDepartureSpin(screw ? nutAxis(screw, nut) : out));
    }
    for (const buckle of buckleViews) {
      if (buckle.screwId !== id) continue;
      dropMesh(buckle.mesh, null);
    }
    buckleViews = buckleViews.filter((buckle) => buckle.screwId !== id);
    noteClear();
  }

  function finishLoose(cancel: boolean): void {
    const drag = screwDrag;
    screwDrag = null;
    if (!drag) return;
    const screw = board.screws.find((item) => item.id === drag.id);
    if (!screw) return;
    if (!cancel && drag.sign !== 0 && !drag.broken && screwHeld(screw, board.nuts ?? [])) {
      const gap = releaseSlack(board.screws, board.nuts ?? [], screw.id, drag.sign, intentWorld(INTENT_SLEEVE, camera.zoom));
      if (gap !== null) {
        const axis = screwSlideAxis(screw);
        slideScrew(board.screws, board.nuts ?? [], screw.id, axis.x * drag.sign * (gap + 1e-3), axis.y * drag.sign * (gap + 1e-3));
        placeScrew(screw.id);
      }
    }
    if (cancel || screwHeld(screw, board.nuts ?? [])) {
      if (cancel) {
        screw.x = drag.x0;
        screw.y = drag.y0;
        placeScrew(screw.id);
      }
      return;
    }
    dropScrew(screw.id);
    pulseHaptic('clear');
  }

  function moveScrew(world: { x: number; y: number }): void {
    if (!screwDrag) return;
    const dragId = screwDrag.id;
    const screw = board.screws.find((item) => item.id === dragId);
    if (!screw) return;
    const from = { x: screwDrag.x, y: screwDrag.y };
    screwDrag.x = world.x;
    screwDrag.y = world.y;
    const axis = screwSlideAxis(screw);
    const pushed = (world.x - from.x) * axis.x + (world.y - from.y) * axis.y;
    const sign = Math.sign(pushed);
    if (sign !== 0) {
      if (screwDrag.sign === 0) screwDrag.sign = sign;
      else if (sign !== screwDrag.sign) screwDrag.broken = true;
    }
    const beforeX = screw.x;
    const beforeY = screw.y;
    const result = dragScrew(board.screws, board.nuts ?? [], screw.id, from, world);
    const moved = Math.hypot(screw.x - beforeX, screw.y - beforeY);
    if (stepContact(screwDrag, moved, result.blocked)) {
      pulseHaptic('hit');
      const view = screwViews.find((item) => item.id === screw.id);
      if (view) feedback.impact(view.mesh);
    }
    placeScrew(screw.id);
    const loose = !screwHeld(screw, board.nuts ?? []);
    const buckles = buckleViews.filter((item) => item.screwId === screw.id).map((item) => item.mesh);
    const mesh = screwViews.find((item) => item.id === screw.id)?.mesh;
    feedback.hint(loose && mesh ? [mesh, ...buckles] : []);
  }

  function moveNut(world: { x: number; y: number }): void {
    if (!nutDrag || !board.nuts) return;
    const dragId = nutDrag.id;
    const nut = board.nuts.find((item) => item.id === dragId);
    const screw = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !screw) return;
    const axis = nutAxis(screw, nut);
    const target = nutDrag.t0 + (world.x - nutDrag.x) * axis.x + (world.y - nutDrag.y) * axis.y;
    const before = nut.t;
    const result = slideNut(board.nuts, board.screws, nut.id, target);
    const moved = Math.abs(nut.t - before);
    if (stepContact(nutDrag, moved, result.blocked)) {
      pulseHaptic('hit');
      const view = nutViews.find((item) => item.id === nut.id);
      if (view) feedback.impact(view.mesh);
    }
    placeNutMesh(nut.id);
    const view = nutViews.find((item) => item.id === nut.id);
    feedback.hint(nutPastTip(screw, nut) && view ? [view.mesh] : []);
  }

  function releaseNut(): void {
    const drag = nutDrag;
    nutDrag = null;
    if (!drag || !board.nuts) return;
    const nut = board.nuts.find((item) => item.id === drag.id);
    const screw = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !screw || !nutPastTip(screw, nut)) return;
    const axis = nutAxis(screw, nut);
    const view = nutViews.find((item) => item.id === nut.id);
    board.nuts = board.nuts.filter((item) => item.id !== nut.id);
    if (view) dropMesh(view.mesh, nutDepartureSpin(axis));
    pulseHaptic('clear');
    noteClear();
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

  function beginNut(id: string, t0: number, x: number, y: number): void {
    nutDrag = { id, t0, x, y, ...contactLatch() };
    pulseHaptic('grab');
  }

  function beginScrew(id: string, x: number, y: number, at: { x: number; y: number }): void {
    screwDrag = { id, x0: at.x, y0: at.y, x, y, ...contactLatch(), sign: 0, broken: false };
    pulseHaptic('grab');
  }

  function onPointerDown(event: PointerEvent): void {
    if (pointerId !== null || awaitingNext) return;
    const world = worldFromEvent(event);
    if (!world) return;
    const nut = nutAt(board.nuts ?? [], board.screws, world.x, world.y);
    const screw = screwAt(board.screws, board.nuts ?? [], world.x, world.y);
    if (nut && screw) {
      const host = board.screws.find((item) => item.id === nut.screwId) ?? screw;
      if (!axesParallel(nutAxis(host, nut), screwSlideAxis(screw))) {
        pointerId = event.pointerId;
        canvas.setPointerCapture(event.pointerId);
        pending = { x: world.x, y: world.y, nutId: nut.id, screwId: screw.id };
        return;
      }
    }
    if (nut) {
      pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      beginNut(nut.id, nut.t, world.x, world.y);
      return;
    }
    if (!screw) return;
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    beginScrew(screw.id, world.x, world.y, screw);
  }

  function settlePending(world: { x: number; y: number }): void {
    const press = pending;
    if (!press) return;
    const nut = board.nuts?.find((item) => item.id === press.nutId);
    const screw = board.screws.find((item) => item.id === press.screwId);
    const host = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !screw || !host) {
      pending = null;
      return;
    }
    const choice = strokeChoice(
      nutAxis(host, nut),
      screwSlideAxis(screw),
      world.x - press.x,
      world.y - press.y,
      intentWorld(INTENT_CLEAR, camera.zoom),
    );
    if (!choice) return;
    pending = null;
    if (choice === 'nut') beginNut(nut.id, nut.t, world.x, world.y);
    else beginScrew(screw.id, world.x, world.y, screw);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const world = worldFromEvent(event);
    if (!world) return;
    if (pending) settlePending(world);
    if (nutDrag) moveNut(world);
    else if (screwDrag) moveScrew(world);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointerId = null;
    pending = null;
    releaseNut();
    feedback.hint([]);
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
    const frameDt = (now - last) / 1000;
    const dt = Math.min(0.05, frameDt);
    last = now;
    fpsWindow += frameDt;
    fpsFrames += 1;
    if (fpsEl && fpsWindow >= 0.25) {
      const fps = Math.round(fpsFrames / fpsWindow);
      if (fps !== fpsShown) {
        fpsShown = fps;
        fpsEl.textContent = `${fps} FPS`;
      }
      fpsWindow = 0;
      fpsFrames = 0;
    }
    const view = viewSize();
    let alive = 0;
    for (const faller of fallers) {
      stepFall(faller, dt);
      faller.mesh.position.y += faller.vy * dt;
      if (faller.speed !== 0) {
        spinAxis.set(faller.axisX, faller.axisY, 0);
        faller.mesh.rotateOnWorldAxis(spinAxis, faller.speed * dt);
      }
      const { x, y } = faller.mesh.position;
      if (fallPastView(x, y, view, { x: camera.position.x, y: camera.position.y, zoom: camera.zoom })) {
        disposeObject(faller.mesh);
        root.remove(faller.mesh);
        continue;
      }
      fallers[alive] = faller;
      alive += 1;
    }
    fallers.length = alive;
    if (alive === 0) fallerFront = FALL_FRONT;
    feedback.step(dt);
    const selected = nutDrag
      ? nutViews.find((item) => item.id === nutDrag?.id)?.mesh ?? null
      : screwDrag
        ? screwViews.find((item) => item.id === screwDrag?.id)?.mesh ?? null
        : null;
    selectionOutline.follow(selected, dt);
    selectionOutline.render();
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
      selectionOutline.dispose();
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
