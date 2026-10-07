import type { ArrangementSchedule } from '../core/arrangement';

export interface ArrangementInput {
  schedule: ArrangementSchedule;
  sources: Record<string, Blob>;
}
export interface ArrangementRenderResult {
  blob: Blob;
  duration: number;
}
/**
 * 把同一份编排离线合成为一个音频文件：试听与最终保存都调用它，
 * 保证听到的和存下的永远一致。
 */
export interface AudioArrangerPort {
  render(input: ArrangementInput): Promise<ArrangementRenderResult>;
}
