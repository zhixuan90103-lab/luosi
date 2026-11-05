import * as THREE from 'three';
import { applyStageTransform, computeStageLayout, watchStageLayout } from '../adapt/design';
import { createRenderer, resizeToDesign } from '../create-renderer';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../adapt/design';
import type { Board, ScrewBody } from '../game/board';
import { STAGE_ZOOM, designFromWorld, worldFromDesign } from '../game/camera';
import {
  PART,
  SCREW,
  aimNut,
  authoredBuckles,
  headSilhouette,
  nutMesh,
  screwLocalBounds,
  screwMesh,
  shapeRuns,
} from '../game/parts';
import { nutAxis, nutWorld, seatedLayout, toWorld } from '../game/screws';
import {
  PALETTE,
  addNut,
  centerLevel,
  deleteBuckle,
  deleteNut,
  deleteScrew,
  levelPayload,
  paletteHex,
  rotateLevelClockwise,
  setBuckleT,
  shiftLevel,
  setNutT,
  spaceNuts,
  setEdgeLength,
  shownNuts,
  spawnScrew,
} from './edit';

type Drag =
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'rotate'; id: string }
  | { kind: 'edge'; id: string; index: number; fromDead: boolean }
  | { kind: 'buckle'; id: string; index: number }
  | { kind: 'nut'; id: string; nutId: string };

const shell = document.getElementById('shell')!;
const viewport = document.getElementById('viewport')!;
const stage = document.getElementById('stage')!;
const listEl = document.getElementById('level-list')!;
const statusEl = document.getElementById('editor-status')!;
const angleInput = document.getElementById('screw-angle') as HTMLInputElement;
const xInput = document.getElementById('screw-x') as HTMLInputElement;
const yInput = document.getElementById('screw-y') as HTMLInputElement;

let order: string[] = [];
let levelId = '1';
let board: Board = { screws: [] };
let savedText = '';
let tracking = false;
let selectedId: string | null = null;
let selectedNutId: string | null = null;
let selectedBuckle: { id: string; edge: number } | null = null;
let drag: Drag | null = null;
let pendingNut: { id: string; run: number; along: number; x: number; y: number } | null = null;
let brush: number | null = null;
const handleRoot = new THREE.Group();

function dirty(): boolean {
  return tracking && JSON.stringify(levelPayload(board)) !== savedText;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

async function boot(): Promise<void> {
  const renderer = await createRenderer({ container: stage });
  renderer.domElement.style.pointerEvents = 'auto';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf6f1e8);
  scene.add(new THREE.HemisphereLight(0xfff8f2, 0xf3d7be, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(-0.55, 0.9, 12);
  scene.add(key);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
  camera.position.set(0, 0, 12);
  camera.lookAt(0, 0, 0);
  scene.add(handleRoot);
  const root = new THREE.Group();
  scene.add(root);

  const fitCamera = () => {
    const { w, h } = { w: 10 * (DESIGN_WIDTH / DESIGN_HEIGHT), h: 10 };
    camera.left = -w / 2;
    camera.right = w / 2;
    camera.top = h / 2;
    camera.bottom = -h / 2;
    camera.zoom = STAGE_ZOOM;
    camera.updateProjectionMatrix();
  };
  fitCamera();

  const onLayout = () => {
    const size = { width: shell.clientWidth, height: shell.clientHeight };
    viewport.style.width = `${size.width}px`;
    viewport.style.height = `${size.height}px`;
    applyStageTransform(stage, computeStageLayout(size.width, size.height, 'contain'));
    resizeToDesign(renderer);
    fitCamera();
  };
  watchStageLayout(onLayout, { getViewSize: () => ({ width: shell.clientWidth, height: shell.clientHeight }) });

  const draw = () => {
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const material = obj.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      });
    }
    handleRoot.clear();
    const { depth, scale } = PART;
    for (const screw of board.screws) {
      const seats = screw.edges && screw.buckleT
        ? authoredBuckles(screw.kind, screw.edges, screw.buckleT)
        : seatedLayout(screw.kind).buckles;
      const mesh = screwMesh(screw.kind, depth * scale, screw.color ?? 0x9aa3a8, seats, screw.edges);
      mesh.position.set(screw.x, screw.y, 0);
      mesh.rotation.z = screw.theta;
      root.add(mesh);
    }
    for (const nut of shownNuts(board)) {
      const screw = board.screws.find((item) => item.id === nut.screwId);
      if (!screw) continue;
      const mesh = nutMesh(depth * scale, nut.color);
      const at = nutWorld(screw, nut);
      mesh.position.set(at.x, at.y, 0.02);
      const axis = nutAxis(screw, nut);
      aimNut(mesh, axis.x, axis.y);
      mesh.rotateZ(0);
      root.add(mesh);
    }
    const selected = board.screws.find((screw) => screw.id === selectedId);
    if (selected) drawHandles(selected);
    const pickedNut = shownNuts(board).find((nut) => nut.id === selectedNutId);
    const pickedScrew = pickedNut ? board.screws.find((screw) => screw.id === pickedNut.screwId) : undefined;
    if (pickedNut && pickedScrew) {
      const at = nutWorld(pickedScrew, pickedNut);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.12, 0.16, 24),
        new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, side: THREE.DoubleSide }),
      );
      ring.position.set(at.x, at.y, 0.25);
      ring.renderOrder = 3;
      handleRoot.add(ring);
    }
    const write = (input: HTMLInputElement, value: string) => {
      if (document.activeElement === input) return;
      input.value = value;
    };
    angleInput.disabled = !selected;
    xInput.disabled = !selected;
    yInput.disabled = !selected;
    write(angleInput, selected ? String(Math.round((selected.theta * 180) / Math.PI)) : '');
    if (selected) {
      const center = screwCenter(selected);
      const design = designFromWorld(center.x, center.y, camera.position.x, camera.position.y, camera.zoom);
      write(xInput, String(Math.round(design.x - DESIGN_WIDTH / 2)));
      write(yInput, String(Math.round(design.y - DESIGN_HEIGHT / 2)));
    } else {
      write(xInput, '');
      write(yInput, '');
    }
  };

  const screwCenter = (screw: ScrewBody) => {
    const bounds = screwLocalBounds(screw.kind, screw.edges);
    return toWorld(screw, (bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
  };

  const placeCenter = (screw: ScrewBody, x: number, y: number) => {
    const center = screwCenter(screw);
    screw.x += x - center.x;
    screw.y += y - center.y;
  };

  const drawHandles = (screw: ScrewBody) => {
    const runs = shapeRuns(screw.kind, screw.edges);
    const addDot = (x: number, y: number, color: number) => {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 12, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      const at = toWorld(screw, x, y);
      dot.position.set(at.x, at.y, 0.2);
      dot.renderOrder = 2;
      handleRoot.add(dot);
    };
    addDot(0, 0.72, 0x111111);
    runs.forEach((run, index) => {
      addDot(run.x1, run.y1, 0xe67e22);
      if (screw.kind === 'u' && index === 1) addDot(run.x0, run.y0, 0xe67e22);
    });
  };

  const pointer = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const dx = ((event.clientX - rect.left) / rect.width) * DESIGN_WIDTH;
    const dy = ((event.clientY - rect.top) / rect.height) * DESIGN_HEIGHT;
    return worldFromDesign(dx, dy, camera.position.x, camera.position.y, camera.zoom);
  };

  const localOf = (screw: ScrewBody, x: number, y: number) => {
    const dx = x - screw.x;
    const dy = y - screw.y;
    const c = Math.cos(screw.theta);
    const s = Math.sin(screw.theta);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  };

  const near = (x: number, y: number, px: number, py: number, radius: number) => Math.hypot(x - px, y - py) <= radius;

  renderer.domElement.addEventListener('pointerdown', (event) => {
    const at = pointer(event);
    const selected = board.screws.find((screw) => screw.id === selectedId);
    if (selected) {
      const spin = toWorld(selected, 0, 0.72);
      if (near(at.x, at.y, spin.x, spin.y, 0.12)) {
        drag = { kind: 'rotate', id: selected.id };
        return;
      }
      const runs = shapeRuns(selected.kind, selected.edges);
      for (let index = 0; index < runs.length; index += 1) {
        const tip = toWorld(selected, runs[index].x1, runs[index].y1);
        if (near(at.x, at.y, tip.x, tip.y, 0.12)) {
          drag = { kind: 'edge', id: selected.id, index, fromDead: false };
          return;
        }
        if (selected.kind === 'u' && index === 1) {
          const dead = toWorld(selected, runs[index].x0, runs[index].y0);
          if (near(at.x, at.y, dead.x, dead.y, 0.12)) {
            drag = { kind: 'edge', id: selected.id, index, fromDead: true };
            return;
          }
        }
      }
    }
    for (const screw of board.screws) {
      if (screw.kind !== 'straight') continue;
      const cap = headSilhouette();
      const local = localOf(screw, at.x, at.y);
      const onHead = Math.abs(local.x - cap.shift) <= cap.halfAlong + 0.05 && Math.abs(local.y) <= cap.halfAcross + 0.04;
      if (!onHead) continue;
      selectedId = screw.id;
      selectedNutId = null;
      selectedBuckle = null;
      drag = { kind: 'move', id: screw.id, dx: at.x - screw.x, dy: at.y - screw.y };
      draw();
      return;
    }
    for (const screw of board.screws) {
      const seats = screw.edges && screw.buckleT
        ? authoredBuckles(screw.kind, screw.edges, screw.buckleT)
        : seatedLayout(screw.kind).buckles;
      for (let index = 0; index < seats.length; index += 1) {
        const buckle = seats[index];
        const seat = toWorld(screw, buckle.x, buckle.y);
        if (near(at.x, at.y, seat.x, seat.y, 0.16)) {
          const edge = 'edge' in buckle && typeof buckle.edge === 'number' ? buckle.edge : index;
          selectedId = screw.id;
          selectedBuckle = { id: screw.id, edge };
          drag = { kind: 'buckle', id: screw.id, index: edge };
          draw();
          return;
        }
      }
    }
    for (const nut of shownNuts(board)) {
      const screw = board.screws.find((item) => item.id === nut.screwId);
      if (!screw) continue;
      const pos = nutWorld(screw, nut);
      if (near(at.x, at.y, pos.x, pos.y, 0.16)) {
        if (!board.nuts) board.nuts = shownNuts(board);
        selectedId = screw.id;
        selectedNutId = nut.id;
        drag = { kind: 'nut', id: screw.id, nutId: nut.id };
        draw();
        return;
      }
    }
    let hit: ScrewBody | null = null;
    let hitRun = -1;
    let hitAlong = 0;
    let best = 0.14;
    for (const screw of board.screws) {
      const local = localOf(screw, at.x, at.y);
      const runs = shapeRuns(screw.kind, screw.edges);
      runs.forEach((run, index) => {
        const dx = run.x1 - run.x0;
        const dy = run.y1 - run.y0;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((local.x - run.x0) * dx + (local.y - run.y0) * dy) / len2));
        const qx = run.x0 + dx * t;
        const qy = run.y0 + dy * t;
        const dist = Math.hypot(local.x - qx, local.y - qy);
        if (dist < best) {
          best = dist;
          hit = screw;
          hitRun = index;
          hitAlong = Math.hypot(qx - run.x0, qy - run.y0);
        }
      });
      if (screw.kind === 'straight' && Math.hypot(local.x, local.y) < SCREW.head) hit = screw;
    }
    if (hit) {
      selectedId = hit.id;
      selectedNutId = null;
      const local = localOf(hit, at.x, at.y);
      const onHead = hit.kind === 'straight' && Math.hypot(local.x, local.y) <= SCREW.head;
      if (!onHead && hitRun >= 0 && best < 0.12) {
        pendingNut = { id: hit.id, run: hitRun, along: hitAlong, x: at.x, y: at.y };
      } else {
        drag = { kind: 'move', id: hit.id, dx: at.x - hit.x, dy: at.y - hit.y };
      }
      draw();
      return;
    }
    selectedId = null;
    selectedNutId = null;
    draw();
  });

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (pendingNut && !drag) {
      const at = pointer(event);
      if (Math.hypot(at.x - pendingNut.x, at.y - pendingNut.y) > 0.04) {
        const screw = board.screws.find((item) => item.id === pendingNut?.id);
        if (screw) drag = { kind: 'move', id: screw.id, dx: pendingNut.x - screw.x, dy: pendingNut.y - screw.y };
        pendingNut = null;
      }
    }
    if (!drag) return;
    const action = drag;
    const at = pointer(event);
    const screw = board.screws.find((item) => item.id === action.id);
    if (!screw) return;
    if (action.kind === 'move') {
      screw.x = at.x - action.dx;
      screw.y = at.y - action.dy;
    } else if (action.kind === 'rotate') {
      screw.theta = Math.atan2(at.y - screw.y, at.x - screw.x) - Math.PI / 2;
    } else if (action.kind === 'nut') {
      const nut = board.nuts?.find((item) => item.id === action.nutId);
      const run = nut ? shapeRuns(screw.kind, screw.edges)[nut.run] : undefined;
      if (nut && run) {
        const local = localOf(screw, at.x, at.y);
        const dx = run.x1 - run.x0;
        const dy = run.y1 - run.y0;
        const length = Math.hypot(dx, dy) || 1;
        const along = ((local.x - run.x0) * dx + (local.y - run.y0) * dy) / length;
        setNutT(board, screw, nut.id, along);
      }
    } else if (action.kind === 'buckle') {
      const run = shapeRuns(screw.kind, screw.edges)[action.index];
      const local = localOf(screw, at.x, at.y);
      const dx = run.x1 - run.x0;
      const dy = run.y1 - run.y0;
      const length = Math.hypot(dx, dy) || 1;
      const along = ((local.x - run.x0) * dx + (local.y - run.y0) * dy) / length;
      setBuckleT(board, screw, action.index, along);
    } else {
      const run = shapeRuns(screw.kind, screw.edges)[action.index];
      const local = localOf(screw, at.x, at.y);
      const dx = run.x1 - run.x0;
      const dy = run.y1 - run.y0;
      const length = Math.hypot(dx, dy) || 1;
      const along = ((local.x - run.x0) * dx + (local.y - run.y0) * dy) / length;
      const nextAlong = action.fromDead ? length - along : along;
      setEdgeLength(board, screw, action.index, nextAlong, action.fromDead);
    }
    draw();
  });

  renderer.domElement.addEventListener('pointerup', () => {
    if (pendingNut && !drag) {
      const screw = board.screws.find((item) => item.id === pendingNut?.id);
      if (screw && pendingNut) addNut(board, screw, pendingNut.run, pendingNut.along, brush ?? undefined);
      draw();
    }
    pendingNut = null;
    drag = null;
  });

  const renderLoop = () => {
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  };
  renderLoop();

  const paintPalette = () => {
    const host = document.getElementById('palette')!;
    host.replaceChildren();
    for (const color of PALETTE) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.background = paletteHex(color);
      button.addEventListener('click', () => {
        brush = color;
        for (const swatch of host.querySelectorAll('button')) swatch.classList.remove('picked');
        button.classList.add('picked');
        const nut = board.nuts?.find((item) => item.id === selectedNutId);
        if (nut) nut.color = color;
        else {
          const screw = board.screws.find((item) => item.id === selectedId);
          if (screw) screw.color = color;
        }
        draw();
      });
      host.appendChild(button);
    }
  };
  paintPalette();

  document.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      const kind = button.dataset.kind as ScrewBody['kind'];
      const screw = spawnScrew(board, kind, camera.position.x, camera.position.y, brush ?? undefined);
      placeCenter(screw, camera.position.x, camera.position.y);
      selectedId = screw.id;
      selectedNutId = null;
      draw();
    });
  });

  document.getElementById('screw-delete')!.addEventListener('click', () => {
    if (!selectedId) return;
    deleteScrew(board, selectedId);
    selectedId = null;
    selectedNutId = null;
    draw();
  });

  document.getElementById('buckle-delete')!.addEventListener('click', () => {
    if (!selectedBuckle) {
      setStatus('先点中一颗银卡扣');
      return;
    }
    const screw = board.screws.find((item) => item.id === selectedBuckle?.id);
    if (!screw) return;
    deleteBuckle(board, screw, selectedBuckle.edge);
    selectedBuckle = null;
    draw();
  });

  document.getElementById('nut-delete')!.addEventListener('click', () => {
    if (!selectedNutId) return;
    deleteNut(board, selectedNutId);
    selectedNutId = null;
    draw();
  });

  document.getElementById('nut-space')!.addEventListener('click', () => {
    const screw = board.screws.find((item) => item.id === selectedId);
    if (!screw) return;
    spaceNuts(board, screw);
    draw();
  });

  const applyPose = () => {
    const screw = board.screws.find((item) => item.id === selectedId);
    if (!screw) return;
    const x = Number(xInput.value);
    const y = Number(yInput.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const world = worldFromDesign(x + DESIGN_WIDTH / 2, y + DESIGN_HEIGHT / 2, camera.position.x, camera.position.y, camera.zoom);
    placeCenter(screw, world.x, world.y);
    draw();
  };
  xInput.addEventListener('change', applyPose);
  yInput.addEventListener('change', applyPose);

  angleInput.addEventListener('change', () => {
    const screw = board.screws.find((item) => item.id === selectedId);
    if (!screw) return;
    const degrees = Number(angleInput.value);
    if (!Number.isFinite(degrees)) return;
    screw.theta = (degrees * Math.PI) / 180;
    draw();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (event.target instanceof HTMLInputElement) return;
    if (selectedNutId) {
      deleteNut(board, selectedNutId);
      selectedNutId = null;
      draw();
      return;
    }
    if (!selectedId) return;
    deleteScrew(board, selectedId);
    selectedId = null;
    draw();
  });

  const renderList = () => {
    listEl.replaceChildren();
    order.forEach((id, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `关卡 ${index + 1} · ${id}`;
      button.draggable = true;
      if (id === levelId) button.classList.add('active');
      button.addEventListener('click', () => {
        void openLevel(id);
      });
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', id);
      });
      button.addEventListener('dragover', (event) => event.preventDefault());
      button.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = event.dataTransfer?.getData('text/plain');
        if (!from || from === id) return;
        const next = order.filter((itemId) => itemId !== from);
        const at = next.indexOf(id);
        next.splice(at, 0, from);
        order = next;
        renderList();
      });
      item.appendChild(button);
      listEl.appendChild(item);
    });
  };

  const loadOrder = async () => {
    const response = await fetch('./levels/order.json', { cache: 'no-store' });
    order = (await response.json()) as string[];
    if (!order.includes(levelId)) levelId = order[0];
    renderList();
  };

  const openLevel = async (id: string) => {
    if (dirty() && !window.confirm('这一关还没保存，离开就丢掉改动。')) return;
    const response = await fetch(`./levels/${id}.json`, { cache: 'no-store' });
    board = (await response.json()) as Board;
    board.screws ??= [];
    levelId = id;
    selectedId = null;
    selectedNutId = null;
    savedText = JSON.stringify(levelPayload(board));
    tracking = true;
    renderList();
    draw();
    setStatus(`正在编辑 ${id}`);
  };

  document.getElementById('level-add')!.addEventListener('click', async () => {
    if (dirty() && !window.confirm('这一关还没保存，离开就丢掉改动。')) return;
    const response = await fetch('./__levels', { method: 'POST' });
    const created = (await response.json()) as { id: string };
    await loadOrder();
    await openLevel(created.id);
  });

  document.getElementById('level-delete')!.addEventListener('click', async () => {
    if (order.length <= 1) {
      setStatus('至少留一关');
      return;
    }
    if (!window.confirm(`删除关卡 ${levelId}？`)) return;
    const response = await fetch(`./__levels/${levelId}`, { method: 'DELETE' });
    if (!response.ok) {
      setStatus('删除失败');
      return;
    }
    savedText = JSON.stringify(levelPayload(board));
    await loadOrder();
    await openLevel(order[0]);
  });

  const moveLevel = (dir: -1 | 1) => {
    const index = order.indexOf(levelId);
    const next = index + dir;
    if (next < 0 || next >= order.length) return;
    const copy = [...order];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    order = copy;
    renderList();
  };
  document.getElementById('level-center')!.addEventListener('click', () => {
    centerLevel(board);
    draw();
    setStatus('已把这一关挪到画面中心');
  });
  const nudgeLevel = (designY: number) => {
    const origin = worldFromDesign(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, camera.position.x, camera.position.y, camera.zoom);
    const shifted = worldFromDesign(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2 + designY, camera.position.x, camera.position.y, camera.zoom);
    shiftLevel(board, shifted.x - origin.x, shifted.y - origin.y);
    draw();
  };
  document.getElementById('level-nudge-up')!.addEventListener('click', () => {
    nudgeLevel(-10);
    setStatus('已上移 10');
  });
  document.getElementById('level-nudge-down')!.addEventListener('click', () => {
    nudgeLevel(10);
    setStatus('已下移 10');
  });
  document.getElementById('level-rotate')!.addEventListener('click', () => {
    rotateLevelClockwise(board);
    draw();
    setStatus('已顺时针转 90°');
  });
  document.getElementById('level-up')!.addEventListener('click', () => moveLevel(-1));
  document.getElementById('level-down')!.addEventListener('click', () => moveLevel(1));

  document.getElementById('save')!.addEventListener('click', async () => {
    const payload = levelPayload(board);
    const levelRes = await fetch(`./__levels/${levelId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    });
    const orderRes = await fetch('./__levels/order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order),
    });
    if (!levelRes.ok || !orderRes.ok) {
      setStatus('保存失败。编辑只在 npm run dev 里写入文件。');
      return;
    }
    savedText = JSON.stringify(payload);
    setStatus(`已保存 ${levelId}`);
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty()) return;
    event.preventDefault();
  });

  await loadOrder();
  await openLevel(levelId);
  draw();
}

void boot();
