import { setStageZoom, stageZoomValue } from './camera';
import { finishOf, resetFinish, setFinish, type FinishKind } from './finish';
import { hapticFeel, hapticLabel, nutTurnTune, resetHapticFeel, rumbleFloor, setHapticPair, setNutTurnTune, setRumbleFloor, TURN_STEP_DEFAULT, type HapticKind } from './hapticFeel';

/** Phone gear: haptic test and the play intensities. Not the level editor. */
export function mountPhoneSettings(): void {
  const gear = document.getElementById('hud-settings');
  const panel = document.getElementById('haptic-panel');
  const tune = document.getElementById('haptic-tune');
  if (!(gear instanceof HTMLButtonElement) || !panel || !tune) return;

  fillTune(tune);

  gear.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    panel.classList.toggle('is-open', open);
    panel.toggleAttribute('hidden', !open);
    gear.classList.toggle('is-on', open);
    gear.setAttribute('aria-pressed', open ? 'true' : 'false');
  });
}

function fillTune(tune: HTMLElement): void {
  tune.replaceChildren();
  const kinds: HapticKind[] = ['grab', 'hit', 'ready', 'clear'];
  const cameraTitle = document.createElement('p');
  cameraTitle.className = 'panel-title';
  cameraTitle.textContent = '摄像机';
  tune.append(cameraTitle, zoomSlider());
  const finishTitle = document.createElement('p');
  finishTitle.className = 'panel-title';
  finishTitle.textContent = '光泽';
  tune.append(finishTitle);
  for (const kind of ['screw', 'nut', 'buckle'] as FinishKind[]) tune.append(finishRow(kind));
  const title = document.createElement('p');
  title.className = 'panel-title';
  title.textContent = '试玩震动';
  tune.append(title);
  tune.append(rumbleRow(), row('turn'), turnTuneRow());
  for (const kind of kinds) tune.append(row(kind));
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = '恢复默认';
  reset.addEventListener('click', () => {
    resetHapticFeel();
    resetFinish();
    fillTune(tune);
  });
  tune.append(reset);
}

function zoomSlider(): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'editor-slider';
  const caption = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0.4';
  input.max = '2.5';
  input.step = '0.05';
  input.value = String(stageZoomValue());
  const show = () => {
    caption.textContent = `缩放 ${Number(input.value).toFixed(2)}`;
  };
  show();
  input.addEventListener('input', () => {
    show();
    setStageZoom(Number(input.value));
  });
  node.append(caption, input);
  return node;
}

const finishName: Record<FinishKind, string> = {
  screw: '螺丝',
  nut: '螺丝扣',
  buckle: '银卡扣',
};

function finishRow(kind: FinishKind): HTMLDivElement {
  const pair = finishOf(kind);
  const line = document.createElement('div');
  line.className = 'haptic-row';
  const head = document.createElement('div');
  head.className = 'haptic-head';
  const name = document.createElement('span');
  name.textContent = finishName[kind];
  head.append(name);
  line.append(head, unitSlider('粗糙', pair.roughness, (value) => {
    setFinish(kind, { roughness: value });
  }), unitSlider('金属', pair.metalness, (value) => {
    setFinish(kind, { metalness: value });
  }));
  return line;
}

function unitSlider(label: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'editor-slider';
  const caption = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  const show = () => {
    caption.textContent = `${label} ${Number(input.value).toFixed(2)}`;
  };
  show();
  input.addEventListener('input', () => {
    show();
    onInput(Number(input.value));
  });
  node.append(caption, input);
  return node;
}

function turnTuneRow(): HTMLDivElement {
  const tune = nutTurnTune();
  const line = document.createElement('div');
  line.className = 'haptic-row';
  const head = document.createElement('div');
  head.className = 'haptic-head';
  const name = document.createElement('span');
  name.textContent = '转动节奏';
  head.append(name);
  line.append(head, rangeSlider('格距', tune.step / TURN_STEP_DEFAULT, 0.25, 4, 0.05, (value) => `${value.toFixed(2)} 格`, (value) => {
    setNutTurnTune({ step: value * TURN_STEP_DEFAULT });
  }), rangeSlider('最快', tune.gapMs, 16, 200, 1, (value) => `${Math.round(value)} ms`, (value) => {
    setNutTurnTune({ gapMs: value });
  }));
  return line;
}

function rumbleRow(): HTMLDivElement {
  const feel = hapticFeel().rumble;
  const line = document.createElement('div');
  line.className = 'haptic-row';
  const head = document.createElement('div');
  head.className = 'haptic-head';
  const name = document.createElement('span');
  name.textContent = hapticLabel('rumble');
  head.append(name);
  line.append(head, slider('下限', rumbleFloor(), (value) => {
    setRumbleFloor(value);
  }), slider('上限', feel.intensity, (value) => {
    setHapticPair('rumble', { intensity: Math.max(value, rumbleFloor()), sharpness: hapticFeel().rumble.sharpness });
  }), slider('锐度', feel.sharpness, (value) => {
    setHapticPair('rumble', { intensity: hapticFeel().rumble.intensity, sharpness: value });
  }));
  return line;
}

function row(kind: HapticKind): HTMLDivElement {
  const feel = hapticFeel()[kind];
  const line = document.createElement('div');
  line.className = 'haptic-row';
  const head = document.createElement('div');
  head.className = 'haptic-head';
  const name = document.createElement('span');
  name.textContent = hapticLabel(kind);
  head.append(name);
  line.append(head, slider('强度', feel.intensity, (value) => {
    setHapticPair(kind, { intensity: value, sharpness: hapticFeel()[kind].sharpness });
  }), slider('锐度', feel.sharpness, (value) => {
    setHapticPair(kind, { intensity: hapticFeel()[kind].intensity, sharpness: value });
  }));
  return line;
}

function rangeSlider(
  name: string,
  value: number,
  min: number,
  max: number,
  step: number,
  captionFor: (value: number) => string,
  onInput: (value: number) => void,
): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'editor-slider';
  const caption = document.createElement('span');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const show = () => {
    caption.textContent = `${name} ${captionFor(Number(input.value))}`;
  };
  show();
  input.addEventListener('input', () => {
    show();
    onInput(Number(input.value));
  });
  node.append(caption, input);
  return node;
}

function slider(name: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
  const node = document.createElement('label');
  node.className = 'editor-slider';
  const caption = document.createElement('span');
  caption.textContent = `${name} ${value.toFixed(2)}`;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    caption.textContent = `${name} ${next.toFixed(2)}`;
    onInput(next);
  });
  node.append(caption, input);
  return node;
}
