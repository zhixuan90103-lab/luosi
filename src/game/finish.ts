import * as THREE from 'three';

/** Live roughness and metalness. The gear writes these. New meshes read them. */
export type FinishKind = 'screw' | 'nut' | 'buckle';

type Pair = { roughness: number; metalness: number };

const defaults: Record<FinishKind, Pair> = {
  screw: { roughness: 0.55, metalness: 0.35 },
  nut: { roughness: 0.55, metalness: 0.35 },
  buckle: { roughness: 0.49, metalness: 0.04 },
};

const live: Record<FinishKind, Pair> = {
  screw: { ...defaults.screw },
  nut: { ...defaults.nut },
  buckle: { ...defaults.buckle },
};

const materials = new Set<THREE.MeshStandardMaterial>();

export function finishOf(kind: FinishKind): Pair {
  return live[kind];
}

export function metalMaterial(color: number, kind: FinishKind): THREE.MeshStandardMaterial {
  const pair = live[kind];
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: pair.roughness,
    metalness: pair.metalness,
  });
  material.userData.finish = kind;
  materials.add(material);
  return material;
}

export function setFinish(kind: FinishKind, patch: Partial<Pair>): void {
  const pair = live[kind];
  if (patch.roughness !== undefined) pair.roughness = patch.roughness;
  if (patch.metalness !== undefined) pair.metalness = patch.metalness;
  for (const material of materials) {
    if (material.userData.finish !== kind) continue;
    material.roughness = pair.roughness;
    material.metalness = pair.metalness;
  }
}

export function resetFinish(): void {
  (Object.keys(defaults) as FinishKind[]).forEach((kind) => {
    setFinish(kind, { ...defaults[kind] });
  });
}

export function releaseFinish(material: THREE.Material): void {
  if (material instanceof THREE.MeshStandardMaterial) materials.delete(material);
}
