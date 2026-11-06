/**
 * Screw table. Orthographic camera looks along −Z.
 * Angle 0 is +X, counterclockwise, and mesh.rotation.z is that same θ.
 */

import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { DESIGN_HEIGHT, DESIGN_WIDTH, isInDesignBounds, type StageLayout } from '../adapt/design';
import { mountOutline } from './outline';
import { aimNut, authoredLayout, nutMesh, PART, screwMassCenter, screwMesh } from './parts';
import { fallPastView, FALL_FRONT, nutDepartureSpin, parkInFront, screwDepartureSpin, stepFall, stillSpin, type FallMotion, type FallSpin } from './fall';
import { dragScrew, nutAxis, nutBlocker, nutPastTip, nutSpin, nutWorld, piecesNear, releaseSlack, screwBlocker, screwHeld, screwSlideAxis, seatedLayout, slideNut, slideScrew, toWorld, type Blocker } from './screws';
import type { Board } from './board';
import { contactLatch, mountFeedback, stepContact, stepStall, type ContactLatch } from './feedback';
import { playHaptics } from './hapticsPlay';
import { INTENT_CLEAR, INTENT_FINGER, INTENT_FLICK, INTENT_NEAR, intentWorld, moveAim, pressAim, releaseFlick, releasePad, rememberStroke, type Aim, type AimPiece, type StrokeSample } from './intent';
import { designFromWorld, onStageZoom, stageZoomValue, viewSize, worldFromDesign } from './camera';
import { awardPraise, breakPraise, freshPraise, resetPraise, showPraise, type PraiseCombo } from './praise';
import { releaseFinish } from './finish';

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
  for (const material of materials) {
    releaseFinish(material);
    material.dispose();
  }
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
  const { renderer, scene, camera, canvas, onScore, onCleared } = options;
  const root = new THREE.Group();
  scene.add(root);

  let board: Board = { screws: [] };

  let nutViews: { id: string; mesh: THREE.Mesh }[] = [];
  let screwViews: { id: string; mesh: THREE.Object3D }[] = [];
  let buckleViews: { screwId: string; mesh: THREE.Object3D }[] = [];
  let fallers: ({ mesh: THREE.Object3D } & FallMotion)[] = [];
  const spinAxis = new THREE.Vector3();
  let fallerFront = FALL_FRONT;
  let nutDrag: { id: string; t0: number; x: number; y: number; armed: boolean; free: number; stall: ContactLatch } | null = null;
  let screwDrag: { id: string; x0: number; y0: number; x: number; y: number; armed: boolean; free: number; stall: ContactLatch; sign: number; samples: StrokeSample[] } | null = null;
  let aim: Aim = { phase: 'off' };
  const feedback = mountFeedback();
  const selectionOutline = mountOutline(renderer, scene, camera);
  let pointerId: number | null = null;
  let awaitingNext = false;
  const praise: PraiseCombo = freshPraise();

  let last = performance.now();

  function designToWorld(dx: number, dy: number): { x: number; y: number } {
    return worldFromDesign(dx, dy, camera.position.x, camera.position.y, camera.zoom);
  }

  /** Design pixels of this event, including a point past the stage edge. */
  function pointerDesign(event: PointerEvent): { x: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT,
    };
  }

  function worldFromEvent(event: PointerEvent): { x: number; y: number } | null {
    const design = pointerDesign(event);
    if (!design || !isInDesignBounds(design.x, design.y)) return null;
    return designToWorld(design.x, design.y);
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
    resetPraise(praise);
    playHaptics.stop();
  }

  function showLevel(): void {
    clearViews();
    const { depth, scale } = PART;
    for (const screw of board.screws) {
      const seats = screw.edges && screw.buckleT
        ? authoredLayout(screw.kind, screw.edges, screw.buckleT).buckles
        : seatedLayout(screw.kind).buckles;
      const mesh = screwMesh(screw.kind, depth * scale, screw.color ?? 0x9aa3a8, seats, screw.edges);
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

  function designOf(x: number, y: number): { x: number; y: number } {
    return designFromWorld(x, y, camera.position.x, camera.position.y, camera.zoom);
  }

  /** One screw, or one nut pulled off its rod. Nuts that fall with their screw are not a second award. */
  function praiseAt(design: { x: number; y: number }): void {
    const award = awardPraise(praise);
    if (!award) return;
    showPraise(design.x, design.y, award.rank);
    onScore?.(award.points);
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
    if (view && screw) {
      const mass = screwMassCenter(screw.kind, screw.edges);
      const at = toWorld(screw, mass.x, mass.y);
      dropMesh(view.mesh, screwDepartureSpin({ x: at.x - screw.x, y: at.y - screw.y }));
    } else if (view) dropMesh(view.mesh, null);
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

  function finishLoose(cancel: boolean, lift: { x: number; y: number } | null): void {
    playHaptics.stop();
    const drag = screwDrag;
    screwDrag = null;
    if (!drag) return;
    const screw = board.screws.find((item) => item.id === drag.id);
    if (!screw) return;
    const axis = screwSlideAxis(screw);
    const flick = cancel ? null : releaseFlick(drag.samples, axis, drag.sign, camera.zoom, performance.now());
    if (flick && screwHeld(screw, board.nuts ?? [])) {
      const gap = releaseSlack(board.screws, board.nuts ?? [], screw.id, flick.sign, intentWorld(releasePad(flick.speed), camera.zoom));
      if (gap !== null) {
        slideScrew(board.screws, board.nuts ?? [], screw.id, axis.x * flick.sign * (gap + 1e-3), axis.y * flick.sign * (gap + 1e-3));
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
    praiseAt(lift ?? designOf(drag.x, drag.y));
    playHaptics.pulse('clear');
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
    if (sign !== 0 && screwDrag.sign === 0) screwDrag.sign = sign;
    rememberStroke(screwDrag.samples, { t: performance.now(), x: world.x, y: world.y });
    const beforeX = screw.x;
    const beforeY = screw.y;
    const result = dragScrew(board.screws, board.nuts ?? [], screw.id, from, world);
    const moved = Math.hypot(screw.x - beforeX, screw.y - beforeY);
    playHaptics.slide({ x: world.x, y: world.y, nowMs: performance.now(), halted: result.blocked });
    const stopped = screwBlocker(board.screws, board.nuts ?? [], screw.id, sign);
    if (stepContact(screwDrag, moved, result.blocked)) {
      playHaptics.pulse('hit');
      breakPraise(praise);
      glanceBlocker(stopped);
    } else if (stepStall(screwDrag.stall, moved, result.blocked, sign !== 0)) {
      breakPraise(praise);
      glanceBlocker(stopped);
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
    const offRod = nutPastTip(screw, nut);
    playHaptics.slide({
      x: world.x,
      y: world.y,
      nowMs: performance.now(),
      halted: offRod || result.blocked,
      spinDelta: offRod || result.blocked ? undefined : nutSpin(nut.t) - nutSpin(before),
    });
    const push = Math.sign(target - before);
    const stopped = nutBlocker(board.nuts, board.screws, nut.id, push);
    if (!offRod && stepContact(nutDrag, moved, result.blocked)) {
      playHaptics.pulse('hit');
      breakPraise(praise);
      glanceBlocker(stopped);
    } else if (!offRod && stepStall(nutDrag.stall, moved, result.blocked, push !== 0)) {
      breakPraise(praise);
      glanceBlocker(stopped);
    }
    placeNutMesh(nut.id);
    const view = nutViews.find((item) => item.id === nut.id);
    feedback.hint(nutPastTip(screw, nut) && view ? [view.mesh] : []);
  }

  function releaseNut(lift: { x: number; y: number } | null): void {
    playHaptics.stop();
    const drag = nutDrag;
    nutDrag = null;
    if (!drag || !board.nuts) return;
    const nut = board.nuts.find((item) => item.id === drag.id);
    const screw = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !screw || !nutPastTip(screw, nut)) return;
    const axis = nutAxis(screw, nut);
    const at = nutWorld(screw, nut);
    const view = nutViews.find((item) => item.id === nut.id);
    board.nuts = board.nuts.filter((item) => item.id !== nut.id);
    if (view) dropMesh(view.mesh, nutDepartureSpin(axis));
    praiseAt(lift ?? designOf(at.x, at.y));
    playHaptics.pulse('clear');
    noteClear();
  }

  function applyFrame(): void {
    const { w, h } = viewSize();
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.zoom = stageZoomValue();
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  function glanceBlocker(blocker: Blocker | null): void {
    if (!blocker) return;
    if (blocker.kind === 'nut') {
      const view = nutViews.find((item) => item.id === blocker.id);
      if (view) feedback.glance([view.mesh]);
      return;
    }
    if (blocker.kind === 'screw') {
      const view = screwViews.find((item) => item.id === blocker.id);
      if (view) feedback.glance([view.mesh]);
      return;
    }
    const meshes = buckleViews.filter((item) => item.screwId === blocker.id).map((item) => item.mesh);
    if (meshes.length > 0) feedback.glance(meshes);
  }

  function beginNut(id: string, t0: number, x: number, y: number): void {
    nutDrag = { id, t0, x, y, ...contactLatch(), stall: contactLatch() };
    playHaptics.pulse('grab');
  }

  function beginScrew(id: string, x: number, y: number, at: { x: number; y: number }): void {
    screwDrag = { id, x0: at.x, y0: at.y, x, y, ...contactLatch(), stall: contactLatch(), sign: 0, samples: [{ t: performance.now(), x, y }] };
    playHaptics.pulse('grab');
  }

  /** A screw still in its buckle that one flick pad can free. A nut that can still step toward the tip. */
  function pieceOpen(kind: 'nut' | 'screw', id: string): boolean {
    const nuts = board.nuts ?? [];
    if (kind === 'screw') {
      const pad = intentWorld(INTENT_FLICK, camera.zoom);
      return releaseSlack(board.screws, nuts, id, 1, pad) !== null || releaseSlack(board.screws, nuts, id, -1, pad) !== null;
    }
    const nut = nuts.find((item) => item.id === id);
    const host = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
    if (!nut || !host || nutPastTip(host, nut)) return false;
    const copy = nuts.map((item) => ({ ...item }));
    const moved = copy.find((item) => item.id === id);
    if (!moved) return false;
    const from = moved.t;
    slideNut(copy, board.screws, id, from + 0.05);
    return moved.t > from + 1e-4;
  }

  function aimPieces(world: { x: number; y: number }): AimPiece[] {
    const finger = intentWorld(INTENT_FINGER, camera.zoom);
    const pieces: AimPiece[] = [];
    for (const hit of piecesNear(board.screws, board.nuts ?? [], world.x, world.y, finger)) {
      if (hit.kind === 'nut') {
        const nut = board.nuts?.find((item) => item.id === hit.id);
        const host = nut ? board.screws.find((item) => item.id === nut.screwId) : undefined;
        if (!nut || !host) continue;
        pieces.push({
          kind: 'nut',
          id: nut.id,
          hostId: host.id,
          axis: nutAxis(host, nut),
          inside: hit.distance <= 0,
          distance: hit.distance,
          open: pieceOpen('nut', nut.id),
        });
      } else {
        const screw = board.screws.find((item) => item.id === hit.id);
        if (!screw) continue;
        pieces.push({
          kind: 'screw',
          id: screw.id,
          axis: screwSlideAxis(screw),
          inside: hit.distance <= 0,
          distance: hit.distance,
          open: pieceOpen('screw', screw.id),
        });
      }
    }
    return pieces;
  }

  function lockAim(piece: AimPiece, world: { x: number; y: number }): void {
    aim = { phase: 'off' };
    if (piece.kind === 'nut') {
      const nut = board.nuts?.find((item) => item.id === piece.id);
      if (nut) beginNut(nut.id, nut.t, world.x, world.y);
      return;
    }
    const screw = board.screws.find((item) => item.id === piece.id);
    if (screw) beginScrew(screw.id, world.x, world.y, screw);
  }

  function capturePointer(event: PointerEvent): void {
    pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
  }

  /** A finger on empty space is not a gesture. Aiming or dragging owns the pointer. */
  function gestureOwnsPointer(): boolean {
    return pointerId !== null && (nutDrag !== null || screwDrag !== null || aim.phase !== 'open');
  }

  function dropPointer(): void {
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }

  function onPointerDown(event: PointerEvent): void {
    if (awaitingNext || gestureOwnsPointer()) return;
    dropPointer();
    aim = { phase: 'off' };
    const world = worldFromEvent(event);
    if (!world) return;
    const stepped = pressAim(aimPieces(world), world.x, world.y);
    capturePointer(event);
    if (stepped.lock) lockAim(stepped.lock, world);
    else aim = stepped.aim;
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    const world = worldFromEvent(event);
    if (!world) return;
    if (aim.phase !== 'off') {
      const stepped = moveAim(
        aim,
        aimPieces(world),
        world.x,
        world.y,
        intentWorld(INTENT_CLEAR, camera.zoom),
        intentWorld(INTENT_NEAR, camera.zoom),
      );
      aim = stepped.aim;
      if (stepped.lock) lockAim(stepped.lock, world);
    }
    if (nutDrag) moveNut(world);
    else if (screwDrag) moveScrew(world);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    dropPointer();
    aim = { phase: 'off' };
    const lift = pointerDesign(event);
    if (screwDrag) {
      const world = lift ? designToWorld(lift.x, lift.y) : { x: screwDrag.x, y: screwDrag.y };
      rememberStroke(screwDrag.samples, { t: performance.now(), x: world.x, y: world.y });
    }
    releaseNut(lift);
    feedback.hint([]);
    finishLoose(false, lift);
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
    playHaptics.settle(now);
    const frameDt = (now - last) / 1000;
    const dt = Math.min(0.05, frameDt);
    last = now;
    const view = viewSize();
    let alive = 0;
    for (const faller of fallers) {
      stepFall(faller, dt);
      faller.mesh.position.y += faller.vy * dt;
      if (faller.speed !== 0) {
        spinAxis.set(faller.axisX, faller.axisY, faller.axisZ);
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
  const stopZoom = onStageZoom(() => applyFrame());
  requestAnimationFrame(tick);

  return {
    resize: () => applyFrame(),
    dispose: () => {
      stopZoom();
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
