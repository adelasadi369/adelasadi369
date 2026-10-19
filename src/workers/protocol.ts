import type { Quality } from '../core/geometry/grid';
import type { ExportFile, ExportFormat } from '../core/export';
import type { AutoFixResult } from '../core/printability/autofix';
import type { Report } from '../core/printability/types';
import type { VaseParams } from '../core/params/schema';

export interface MeshPayload {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Per-vertex overhang angle (deg), −1 where not applicable. */
  overhang: Float32Array;
  vertexCount: number;
  triangleCount: number;
  height: number;
  nTheta: number;
  nZ: number;
  quality: Quality;
  ms: number;
}

export type ReportPayload = Omit<Report, 'vertexOverhang'>;

export interface RegenResult {
  mesh: MeshPayload;
  report: ReportPayload;
  /** Saucer body, already placed beside the vase (+X). */
  saucer?: MeshPayload;
}

export interface GeometryApi {
  regen(params: VaseParams, quality: Quality): Promise<RegenResult>;
  autoFix(params: VaseParams): Promise<Omit<AutoFixResult, 'report'> & { report: ReportPayload }>;
  surprise(seed: number, base: VaseParams): Promise<VaseParams>;
  /** onProgress (0..1) is a Comlink proxy; sleeve exports report marching-cubes progress through it. */
  exportDesign(params: VaseParams, format: ExportFormat, onProgress?: (fraction: number) => void): Promise<ExportFile>;
  thumbnail(params: VaseParams): Promise<MeshPayload>;
  /** 6 printable seed/mutation variants of a design (auto-fixed when needed). */
  variations(params: VaseParams, seed: number): Promise<VaseParams[]>;
  /** Validate + auto-fix AI output before it becomes the current design. */
  fixForAi(params: VaseParams): Promise<{ params: VaseParams; changed: number; score: number }>;
}
