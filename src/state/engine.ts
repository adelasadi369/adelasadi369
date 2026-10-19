import * as Comlink from 'comlink';
import type { Quality } from '../core/geometry/grid';
import type { VaseParams } from '../core/params/schema';
import type { GeometryApi, RegenResult } from '../workers/protocol';

function spawnWorker() {
  const worker = new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' });
  return { worker, api: Comlink.wrap<GeometryApi>(worker) };
}

/** Preview worker (regen, autofix) and a separate export worker so exports never block the preview. */
export const previewWorker = spawnWorker().api;
let exportWorker: ReturnType<typeof spawnWorker> | null = null;
export const getExportWorker = () => (exportWorker ??= spawnWorker()).api;
/** Cancel a running export: the export worker is terminated and a fresh one spawns on the next export. */
export function terminateExportWorker() {
  exportWorker?.worker.terminate();
  exportWorker = null;
}

/**
 * Latest-wins scheduler: at most one regen in flight and one pending; newer requests overwrite
 * the pending slot so slow frames drop intermediate states instead of queueing.
 */
export class RegenScheduler {
  private inFlight = false;
  private pending: { params: VaseParams; quality: Quality } | null = null;
  constructor(
    private onResult: (r: RegenResult, params: VaseParams) => void,
    private onError: (e: unknown) => void,
  ) {}

  request(params: VaseParams, quality: Quality) {
    this.pending = { params, quality };
    if (!this.inFlight) void this.pump();
  }

  private async pump() {
    while (this.pending) {
      const job = this.pending;
      this.pending = null;
      this.inFlight = true;
      try {
        const r = await previewWorker.regen(job.params, job.quality);
        this.onResult(r, job.params);
      } catch (e) {
        this.onError(e);
      } finally {
        this.inFlight = false;
      }
    }
  }
}
