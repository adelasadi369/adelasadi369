import type { VaseParams } from './params/schema';

export interface MaterialData {
  /** g/cm³ */
  density: number;
  /** Max volumetric flow, mm³/s (fast printer). */
  maxFlow: number;
  nozzleTemp: number;
  bedTemp: number;
  fan: number;
}

export const MATERIAL_DATA: Record<VaseParams['print']['material'], MaterialData> = {
  PLA: { density: 1.24, maxFlow: 18, nozzleTemp: 215, bedTemp: 60, fan: 100 },
  silkPLA: { density: 1.24, maxFlow: 12, nozzleTemp: 225, bedTemp: 60, fan: 100 },
  PETG: { density: 1.27, maxFlow: 12, nozzleTemp: 240, bedTemp: 75, fan: 40 },
  ASA: { density: 1.07, maxFlow: 14, nozzleTemp: 260, bedTemp: 95, fan: 20 },
  TPU: { density: 1.21, maxFlow: 4, nozzleTemp: 225, bedTemp: 40, fan: 60 },
};

/** Printer volumetric flow cap, mm³/s. */
export const PRINTER_FLOW: Record<VaseParams['print']['printer']['preset'], number> = {
  bambuA1: 22,
  bambuA1mini: 20,
  bambuP1S: 28,
  bambuX1C: 30,
  bambuH2D: 32,
  prusaMK4: 20,
  prusaCoreOne: 24,
  ender3: 10,
  crealityK1: 26,
  custom: 12,
};
