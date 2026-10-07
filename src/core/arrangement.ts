import type { AudioMaterial } from './models';

export const MAX_ARRANGEMENT_SECONDS = 10;

export interface ClipItem { id: string; kind: 'clip'; materialId: string; start: number; end: number; crossfade: number }
export interface SilenceItem { id: string; kind: 'silence'; duration: number; crossfade: number }
export type TimelineItem = ClipItem | SilenceItem;
export interface ArrangementDraft { title: string; items: TimelineItem[]; updatedAt: string }

let sequence = 0;
function nextId(prefix: string) { sequence += 1; return `${prefix}-${Date.now()}-${sequence}`; }

export function createClipItem(material: AudioMaterial): ClipItem {
  return { id: nextId('clip'), kind: 'clip', materialId: material.id, start: 0, end: Math.min(MAX_ARRANGEMENT_SECONDS, material.duration), crossfade: 0 };
}
export function createSilenceItem(duration = 0.5): SilenceItem {
  return { id: nextId('silence'), kind: 'silence', duration, crossfade: 0 };
}

export function itemDuration(item: TimelineItem): number {
  return item.kind === 'clip' ? Math.max(0, item.end - item.start) : Math.max(0, item.duration);
}

export interface Placement { id: string; start: number; duration: number; fadeIn: number }
export function layoutTimeline(items: TimelineItem[]): { placements: Placement[]; total: number } {
  const placements: Placement[] = [];
  let cursor = 0;
  items.forEach((item, index) => {
    const duration = itemDuration(item);
    const previous = items[index - 1];
    const fadeIn = previous ? Math.min(previous.crossfade, itemDuration(previous), duration) : 0;
    const start = Math.max(0, cursor - fadeIn);
    placements.push({ id: item.id, start, duration, fadeIn });
    cursor = start + duration;
  });
  return { placements, total: Math.max(0, cursor) };
}

export function clipsUsingMaterial(items: TimelineItem[], materialId: string): ClipItem[] {
  return items.filter((item): item is ClipItem => item.kind === 'clip' && item.materialId === materialId);
}

export function validateArrangement(items: TimelineItem[], materials: AudioMaterial[]): string | undefined {
  if (!items.some((item) => item.kind === 'clip')) return '时间线上还没有声音片段，请先从素材池加入';
  for (const [index, item] of items.entries()) {
    if (item.kind === 'clip') {
      const material = materials.find((entry) => entry.id === item.materialId);
      if (!material) return '有片段引用的素材已不存在，请移除该片段';
      if (item.start < 0 || item.end <= item.start || item.end > material.duration + 1e-6) return `片段「${material.name}」的保留范围无效`;
    } else if (!(item.duration > 0)) return '静音时长必须大于 0';
    if (item.crossfade < 0) return '交叉淡化不能为负数';
    const next = items[index + 1];
    if (next && item.crossfade > Math.min(itemDuration(item), itemDuration(next)) + 1e-6) return '交叉淡化不能超过相邻两段中较短的一段';
  }
  const { total } = layoutTimeline(items);
  if (total > MAX_ARRANGEMENT_SECONDS + 1e-6) return `扣除重叠后总时长 ${total.toFixed(1)} 秒，超过 ${MAX_ARRANGEMENT_SECONDS} 秒上限`;
  return undefined;
}
