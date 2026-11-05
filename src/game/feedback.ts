/**
 * Glow only. It never writes the board pose.
 * A hit flashes the piece. A screw that is already clear of its buckles
 * eases brighter until the finger lets go.
 */

import * as THREE from 'three';

const GLOW = 0.16;
const GLOW_SECONDS = 0.18;
const HINT_GLOW = 0.22;
const HINT_SECONDS = 0.08;
/** Free travel, in world units, before another hit may flash. */
export const HIT_REARM = 0.03;

export function contactFeel(
  armed: boolean,
  free: number,
  moved: number,
  blocked: boolean,
): { fire: boolean; armed: boolean; free: number } {
  if (blocked) {
    const fire = armed && moved > 1e-4;
    return { fire, armed: fire ? false : armed, free: fire ? 0 : free };
  }
  const next = free + moved;
  return { fire: false, armed: armed || next > HIT_REARM, free: next };
}

export function mountFeedback() {
  let glow: { mesh: THREE.Object3D; left: number } | null = null;
  let hints: { mesh: THREE.Object3D; level: number; target: number }[] = [];
  const baseColors = new WeakMap<THREE.MeshStandardMaterial, THREE.Color>();

  function eachMaterial(mesh: THREE.Object3D, visit: (material: THREE.MeshStandardMaterial) => void): void {
    mesh.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        if (item instanceof THREE.MeshStandardMaterial) visit(item);
      }
    });
  }

  function setGlow(mesh: THREE.Object3D, intensity: number): void {
    eachMaterial(mesh, (material) => {
      material.emissive.copy(material.color);
      material.emissiveIntensity = intensity;
    });
  }

  function paintHint(mesh: THREE.Object3D, level: number): void {
    eachMaterial(mesh, (material) => {
      let base = baseColors.get(material);
      if (!base) {
        base = material.color.clone();
        baseColors.set(material, base);
      }
      material.color.copy(base);
      material.emissive.copy(base);
      material.emissiveIntensity = level <= 0 ? 0 : HINT_GLOW * level;
    });
  }

  function hintLevel(mesh: THREE.Object3D): number {
    return hints.find((item) => item.mesh === mesh)?.level ?? 0;
  }

  function releaseImpact(mesh: THREE.Object3D): void {
    const level = hintLevel(mesh);
    if (level > 0) paintHint(mesh, level);
    else setGlow(mesh, 0);
  }

  return {
    impact(mesh: THREE.Object3D): void {
      if (glow && glow.mesh !== mesh) releaseImpact(glow.mesh);
      setGlow(mesh, GLOW);
      glow = { mesh, left: GLOW_SECONDS };
    },
    /** Pieces that will fall when the finger lets go. */
    hint(meshes: THREE.Object3D[]): void {
      for (const item of hints) item.target = meshes.includes(item.mesh) ? 1 : 0;
      for (const mesh of meshes) {
        if (!hints.some((item) => item.mesh === mesh)) hints.push({ mesh, level: 0, target: 1 });
      }
      hints = hints.filter((item) => item.target > 0 || item.level > 0);
    },
    step(dt: number): void {
      if (glow) {
        glow.left -= dt;
        setGlow(glow.mesh, Math.max(0, glow.left / GLOW_SECONDS) * GLOW);
        if (glow.left <= 0) {
          const mesh = glow.mesh;
          glow = null;
          releaseImpact(mesh);
        }
      }
      const hintStep = dt / HINT_SECONDS;
      for (const item of hints) {
        if (item.level < item.target) item.level = Math.min(item.target, item.level + hintStep);
        else if (item.level > item.target) item.level = Math.max(item.target, item.level - hintStep);
        if (glow?.mesh === item.mesh) continue;
        paintHint(item.mesh, item.level);
      }
      hints = hints.filter((item) => item.target > 0 || item.level > 0);
    },
    clear(): void {
      if (glow) setGlow(glow.mesh, 0);
      glow = null;
      for (const item of hints) paintHint(item.mesh, 0);
      hints = [];
    },
  };
}
