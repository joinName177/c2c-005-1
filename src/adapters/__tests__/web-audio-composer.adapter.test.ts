import { describe, expect, it } from 'vitest';
import { WebAudioComposerAdapter } from '../web-audio-composer.adapter';
import type { DecodedAudio } from '../web-audio-cropper.adapter';
import type { AudioMaterial } from '../../core/models';
import type { TimelineItem } from '../../core/arrangement';

const decoded = (duration: number, value = 0.4): DecodedAudio => ({ sampleRate: 10, duration, channels: [Float32Array.from({ length: duration * 10 }, () => value)] });
const material = (id: string, duration: number): AudioMaterial => ({ id, name: id, blob: new Blob([id]), duration, createdAt: '2026-10-07' });
const clip = (materialId: string, start: number, end: number, crossfade = 0): TimelineItem => ({ id: `c-${materialId}-${start}`, kind: 'clip', materialId, start, end, crossfade });

function composer(materials: AudioMaterial[], durations: Record<string, number>) {
  const byBlob = new Map(materials.map((entry) => [entry.blob, durations[entry.id] ?? 1]));
  return new WebAudioComposerAdapter({ decode: async (blob) => decoded(byBlob.get(blob) ?? 1) });
}

describe('WebAudioComposerAdapter', () => {
  it('joins clips and silence into one wav with the arranged duration', async () => {
    const materials = [material('a', 4), material('b', 2)];
    const items: TimelineItem[] = [clip('a', 1, 3), { id: 's', kind: 'silence', duration: 0.5, crossfade: 0 }, clip('b', 0, 2)];
    const result = await composer(materials, { a: 4, b: 2 }).compose(materials, items);
    expect(result.duration).toBeCloseTo(4.5);
    expect(result.blob.type).toBe('audio/wav');
    expect(result.blob.size).toBe(44 + 45 * 2);
  });
  it('counts crossfade overlap only once in the output', async () => {
    const materials = [material('a', 4)];
    const result = await composer(materials, { a: 4 }).compose(materials, [clip('a', 0, 4, 1), clip('a', 0, 2)]);
    expect(result.duration).toBeCloseTo(5);
    expect(result.blob.size).toBe(44 + 50 * 2);
  });
  it('refuses arrangements beyond ten seconds', async () => {
    const materials = [material('a', 8)];
    await expect(composer(materials, { a: 8 }).compose(materials, [clip('a', 0, 8), clip('a', 0, 8)])).rejects.toThrow('10');
  });
  it('keeps source materials untouched by only reading ranges', async () => {
    const blob = new Blob(['a']);
    const materials: AudioMaterial[] = [{ id: 'a', name: 'a', blob, duration: 4, createdAt: '2026-10-07' }];
    await composer(materials, { a: 4 }).compose(materials, [clip('a', 1, 2)]);
    expect(materials[0].blob).toBe(blob);
    expect(materials[0].duration).toBe(4);
  });
});
