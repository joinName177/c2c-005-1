import { describe, expect, it } from 'vitest';
import { clipsUsingMaterial, createClipItem, createSilenceItem, itemDuration, layoutTimeline, validateArrangement, type TimelineItem } from '../arrangement';
import type { AudioMaterial } from '../models';

const material = (id: string, duration: number): AudioMaterial => ({ id, name: `素材${id}`, blob: new Blob(), duration, createdAt: '2026-10-07' });
const clip = (materialId: string, start: number, end: number, crossfade = 0): TimelineItem => ({ id: `c-${materialId}-${start}-${end}-${crossfade}`, kind: 'clip', materialId, start, end, crossfade });
const silence = (duration: number, crossfade = 0): TimelineItem => ({ id: `s-${duration}-${crossfade}`, kind: 'silence', duration, crossfade });

describe('layoutTimeline', () => {
  it('places clips back to back and reflows when an earlier clip shrinks', () => {
    const items = [clip('a', 0, 4), clip('b', 1, 3)];
    const first = layoutTimeline(items);
    expect(first.placements.map((p) => p.start)).toEqual([0, 4]);
    expect(first.total).toBe(6);
    const shorter = layoutTimeline([clip('a', 0, 2), clip('b', 1, 3)]);
    expect(shorter.placements[1].start).toBe(2);
    expect(shorter.total).toBe(4);
  });
  it('deducts crossfade overlap from the total duration', () => {
    const { placements, total } = layoutTimeline([clip('a', 0, 4, 1), clip('b', 0, 3)]);
    expect(placements[1].start).toBe(3);
    expect(total).toBe(6);
  });
  it('clamps crossfade to the shorter neighbour so total never goes negative', () => {
    const { total } = layoutTimeline([clip('a', 0, 1, 5), silence(2)]);
    expect(total).toBeCloseTo(2);
  });
  it('counts silence in the timeline', () => {
    expect(layoutTimeline([clip('a', 0, 2), silence(0.5), clip('a', 0, 2)]).total).toBeCloseTo(4.5);
  });
});

describe('validateArrangement', () => {
  const materials = [material('a', 5), material('b', 3)];
  it('requires at least one clip', () => expect(validateArrangement([silence(1)], materials)).toContain('没有声音片段'));
  it('rejects totals over ten seconds after overlaps', () => {
    const error = validateArrangement([clip('a', 0, 5), clip('b', 0, 3), clip('a', 0, 5)], materials);
    expect(error).toContain('10');
  });
  it('allows totals over ten seconds once crossfade overlap brings them back under', () => {
    expect(validateArrangement([clip('a', 0, 5, 1.5), clip('b', 0, 3, 1.5), clip('a', 0, 5)], materials)).toBeUndefined();
  });
  it('rejects ranges outside the source material', () => expect(validateArrangement([clip('a', 0, 6)], materials)).toContain('保留范围'));
  it('rejects crossfade longer than the shorter neighbour', () => expect(validateArrangement([clip('a', 0, 5, 2), clip('b', 0, 1)], materials)).toContain('交叉淡化'));
  it('rejects clips whose material is gone', () => expect(validateArrangement([clip('missing', 0, 1)], materials)).toContain('不存在'));
});

describe('clip helpers', () => {
  it('creates clips capped at ten seconds and tracks material usage', () => {
    const long = material('long', 30);
    const item = createClipItem(long);
    expect(item.end).toBe(10);
    const items: TimelineItem[] = [item, createSilenceItem(), createClipItem(material('other', 2))];
    expect(clipsUsingMaterial(items, 'long')).toHaveLength(1);
    expect(itemDuration(items[1])).toBe(0.5);
  });
});
