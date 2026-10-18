import type { BuildResult } from '../geometry/mesh';
import { MATERIAL_DATA, PRINTER_FLOW } from '../materials';
import type { VaseParams } from '../params/schema';
import { ringMetrics, surfaceArea, surfaceOf, volumeCentroid } from './geometryStats';
import type { Stats } from './types';

export function computeStats(b: BuildResult, p: VaseParams, sx: number, sy: number): Stats {
  const { mesh } = b;
  const outer = surfaceOf(mesh, 'outer')!;
  const outerArea = surfaceArea(mesh, outer);
  const lw = p.print.lineWidth;
  let material: number;
  let capacity = 0;
  if (mesh.mode === 'solidVase') {
    const bottom = ringMetrics(mesh, outer, 0);
    const bt = Math.max(p.base.bottomThickness, 3 * p.print.layerHeight);
    material = outerArea * lw + bottom.area * bt;
    let prev: { a: number; z: number } | null = null;
    for (let r = 0; r < outer.rows; r++) {
      const m = ringMetrics(mesh, outer, r);
      if (m.z < bt) continue;
      const a = Math.max(0, m.area - m.perimeter * lw);
      if (prev) capacity += ((a + prev.a) / 2) * (m.z - prev.z);
      prev = { a, z: m.z };
    }
  } else {
    material = volumeCentroid(mesh).volume;
    const inner = surfaceOf(mesh, 'inner')!;
    for (let r = 1; r < inner.rows; r++) {
      const a = ringMetrics(mesh, inner, r - 1);
      const c = ringMetrics(mesh, inner, r);
      capacity += ((a.area + c.area) / 2) * Math.abs(a.z - c.z);
    }
  }
  const mat = MATERIAL_DATA[p.print.material];
  const flow = Math.min(mat.maxFlow, PRINTER_FLOW[p.print.printer.preset]) * 0.75;
  const layers = mesh.height / p.print.layerHeight;
  const seconds = material / flow + layers * 0.4 + 180;
  return {
    height: mesh.height,
    maxDiameter: Math.max(sx, sy),
    bboxX: sx,
    bboxY: sy,
    capacityMl: capacity / 1000,
    materialCm3: material / 1000,
    weightG: (material / 1000) * mat.density,
    printMinutes: seconds / 60,
    surfaceCm2: outerArea / 100,
    triangles: mesh.triangleCount,
    stlBytes: 84 + 50 * mesh.triangleCount,
    ...(mesh.bore && { boreDiameter: 2 * mesh.bore.radius }),
  };
}
