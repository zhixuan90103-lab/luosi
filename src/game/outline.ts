/**
 * Selection stroke for a held screw or nut.
 * Screen-space mask edge (OutlineNode). A scaled shell and a plan-view
 * grid both fail on a concave rod: the shell grows from the origin, and
 * the grid stair-steps. The mask follows whatever mesh is actually drawn.
 */

import * as THREE from 'three';
import { PostProcessing, type WebGPURenderer } from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';

const EDGE_THICKNESS = 1;
const EDGE_STRENGTH = 3;

function pieceColor(root: THREE.Object3D, out: THREE.Color): void {
  out.set(0xffffff);
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = obj.material;
    if (material instanceof THREE.MeshStandardMaterial) out.copy(material.color);
  });
}

export function mountOutline(
  renderer: WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): {
  show: (root: THREE.Object3D | null, opacity: number) => void;
  render: () => void;
  dispose: () => void;
} {
  const selected: THREE.Object3D[] = [];
  const edgeColor = uniform(new THREE.Color(0xffffff));
  const edgeStrength = uniform(0);
  const outlinePass = outline(scene, camera, {
    selectedObjects: selected,
    edgeThickness: uniform(EDGE_THICKNESS),
    edgeGlow: uniform(0),
  });
  const mask = outlinePass.visibleEdge.add(outlinePass.hiddenEdge);
  const post = new PostProcessing(renderer);
  post.outputNode = mask.mul(edgeColor).mul(edgeStrength).add(pass(scene, camera));

  const color = new THREE.Color();
  let active = false;

  return {
    show(root, opacity) {
      selected.length = 0;
      active = root !== null && opacity > 0.02;
      if (!active || !root) {
        edgeStrength.value = 0;
        return;
      }
      selected.push(root);
      pieceColor(root, color);
      edgeColor.value.copy(color);
      edgeStrength.value = opacity * EDGE_STRENGTH;
    },
    render() {
      if (active) post.render();
      else renderer.render(scene, camera);
    },
    dispose() {
      selected.length = 0;
      outlinePass.dispose();
      post.dispose();
    },
  };
}
