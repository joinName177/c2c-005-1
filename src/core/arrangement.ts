import { validateCropRange } from './models';

/** 素材池中的原始素材：录音或导入文件，永不被剪辑覆盖。 */
export interface AudioSource {
  id: string;
  name: string;
  duration: number;
  kind: 'record' | 'import';
}

/** 时间线上的一个编排片段，只记录对素材的选择，不改动原素材。 */
export interface ArrangementClip {
  id: string;
  sourceId: string;
  /** 在原素材中的保留起点（秒）。 */
  start: number;
  /** 在原素材中的保留终点（秒）。 */
  end: number;
  /** 片段结束后插入的静音时长（秒）。 */
  silenceAfter: number;
  /** 与下一片段重叠交叉淡化的时长（秒），末段忽略。 */
  crossfade: number;
}

export interface ArrangementDraft {
  title: string;
  clips: ArrangementClip[];
}

/** 带时间线位置信息的片段（重排后计算得出，不持久化）。 */
export interface PositionedClip extends ArrangementClip {
  /** 片段在最终时间线上的起点。 */
  at: number;
  /** 片段在最终时间线上的终点。 */
  out: number;
}

export interface ArrangementSchedule {
  clips: PositionedClip[];
  /** 总时长 = Σ片段 + Σ静音 − Σ重叠（交叉淡化）。 */
  duration: number;
}

export const MAX_WORK_SECONDS = 10;

export function clipDuration(clip: ArrangementClip): number {
  return Math.max(0, clip.end - clip.start);
}

/**
 * 按顺序累加位置：前一段改长（保留范围、静音、交叉淡化）后，后续位置全部随之重排。
 * 交叉淡化即下一片段与当前片段末尾的重叠，从总时长中扣除。
 */
export function scheduleClips(clips: ArrangementClip[]): ArrangementSchedule {
  let cursor = 0;
  const positioned: PositionedClip[] = clips.map((clip, index) => {
    const length = clipDuration(clip);
    const at = cursor;
    const out = at + length;
    // 默认顺序排列；下一段若存在，再在间隙上叠加静音、扣除交叉淡化重叠。
    // 交叉淡化最多抵消片段自身长度，保证后续起点不早于本段起点。
    cursor = out;
    const next = clips[index + 1];
    if (next) {
      const overlap = Math.min(clip.crossfade, length, clipDuration(next), length + Math.max(0, clip.silenceAfter));
      cursor += Math.max(0, clip.silenceAfter) - overlap;
    }
    return { ...clip, at, out };
  });
  return { clips: positioned, duration: positioned.length ? Math.max(0, cursor) : 0 };
}

export interface ArrangementIssue {
  clipId: string;
  message: string;
}

/** 汇总每个片段在其所属素材内的范围错误，并校验扣除重叠后的总时长。 */
export function validateArrangement(
  clips: ArrangementClip[],
  durations: Record<string, number>,
): ArrangementIssue[] {
  const issues: ArrangementIssue[] = [];
  for (const clip of clips) {
    const duration = durations[clip.sourceId];
    if (duration === undefined) {
      issues.push({ clipId: clip.id, message: '素材已删除，请重新选择' });
      continue;
    }
    const message = validateCropRange({ start: clip.start, end: clip.end }, duration);
    if (message) issues.push({ clipId: clip.id, message });
    if (clip.silenceAfter < 0) issues.push({ clipId: clip.id, message: '静音时长不能小于 0' });
    if (clip.crossfade < 0) issues.push({ clipId: clip.id, message: '交叉淡化不能小于 0' });
  }
  if (scheduleClips(clips).duration > MAX_WORK_SECONDS + 1e-6) {
    issues.push({ clipId: '*', message: `总时长扣除重叠后不能超过 ${MAX_WORK_SECONDS} 秒` });
  }
  return issues;
}

/** 编辑后令旧合成/分析结果失效的签名：任一保留范围、静音、交叉淡化或顺序变化。 */
export function arrangementSignature(clips: ArrangementClip[]): string {
  return JSON.stringify(clips.map((c) => [c.sourceId, round(c.start), round(c.end), round(c.silenceAfter), round(c.crossfade)]));
}

/** 受某个素材引用的片段（删除素材前列出，供用户取消或一并移除）。 */
export function clipsReferencing(clips: ArrangementClip[], sourceId: string): ArrangementClip[] {
  return clips.filter((clip) => clip.sourceId === sourceId);
}

export function createClip(sourceId: string, duration: number, id: string): ArrangementClip {
  const end = Math.min(MAX_WORK_SECONDS, duration);
  return { id, sourceId, start: 0, end, silenceAfter: 0, crossfade: 0 };
}

/** 交叉淡化受相邻两段有效长度与前段静音约束（重叠不能越过段首）。 */
export function maxCrossfade(clips: ArrangementClip[], index: number): number {
  const current = clips[index];
  const next = clips[index + 1];
  if (!current || !next) return 0;
  return Math.max(0, Math.min(clipDuration(current), clipDuration(next), clipDuration(current) + Math.max(0, current.silenceAfter)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
