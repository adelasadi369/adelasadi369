import { MATERIAL_DATA } from '../materials';
import type { VaseParams } from '../params/schema';

/** Recommended slicer settings for the chosen mode/material (stored as 3MF metadata). */
export function recommendedSettings(p: VaseParams): Record<string, string | number> {
  const m = MATERIAL_DATA[p.print.material];
  const { nozzle, lineWidth, layerHeight, outputMode } = p.print;
  const vase = outputMode !== 'shell';
  const bottomLayers = Math.max(3, Math.ceil(Math.max(p.base.bottomThickness, 0.8) / layerHeight));
  const s: Record<string, string | number> = {
    mode: outputMode,
    material: p.print.material,
    nozzle_diameter: nozzle,
    layer_height: layerHeight,
    line_width: lineWidth,
    nozzle_temperature: m.nozzleTemp,
    bed_temperature: m.bedTemp,
    fan_speed: m.fan,
    max_overhang_deg: p.print.maxOverhang,
  };
  if (vase) {
    Object.assign(s, {
      spiral_mode: 1,
      wall_loops: 1,
      top_shell_layers: 0,
      bottom_shell_layers: bottomLayers,
      sparse_infill_density: '0%',
      outer_wall_line_width: lineWidth,
    });
  } else {
    Object.assign(s, {
      spiral_mode: 0,
      wall_loops: Math.max(2, Math.round(p.print.wallThickness / lineWidth)),
      top_shell_layers: 0,
      bottom_shell_layers: bottomLayers,
      sparse_infill_density: '15%',
    });
  }
  if (p.print.useCase === 'freshFlowers')
    Object.assign(s, { flow_ratio: '1.04', note: 'PETG + 0.8 mm lines recommended for water' });
  return s;
}
