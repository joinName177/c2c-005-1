import { describe, expect, it } from 'vitest';
import { WebAudioArrangerAdapter } from '../web-audio-arranger.adapter';
import { scheduleClips, type ArrangementClip } from '../../core/arrangement';
import type { DecodedAudio } from '../audio-codec';

function tone(duration: number, value = 0.5, sampleRate = 100): DecodedAudio {
  return { sampleRate, duration, channels: [new Float32Array(duration * sampleRate).fill(value)] };
}
const tagged = (key: string) => {
  const blob = new Blob();
  Object.defineProperty(blob, 'key', { value: key });
  return blob;
};
async function wavView(blob: Blob): Promise<DataView> {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new DataView(buffer);
}
function render(keys: string[], clips: ArrangementClip[]) {
  const adapter = new WebAudioArrangerAdapter({
    decode: async (blob) => ((blob as unknown as { key: string }).key === 'slow' ? tone(6, 0.4, 50) : tone(6)),
  });
  return adapter.render({ schedule: scheduleClips(clips), sources: Object.fromEntries(keys.map((key) => [key, tagged(key)])) });
}
const base = (over: Partial<ArrangementClip> = {}): ArrangementClip => ({
  id: over.id ?? 'a', sourceId: over.sourceId ?? 's1', start: over.start ?? 0, end: over.end ?? 4,
  silenceAfter: over.silenceAfter ?? 0, crossfade: over.crossfade ?? 0,
});

describe('WebAudioArrangerAdapter', () => {
  it('mixes two clips with silence gap and returns a wav of the scheduled duration', async () => {
    const result = await render(
      ['s1', 's2'],
      [base({ silenceAfter: 2 }), base({ id: 'b', sourceId: 's2', end: 3 })],
    );
    expect(result.blob.type).toBe('audio/wav');
    expect(result.duration).toBeCloseTo(9);
  });

  it('overlaps neighbours during crossfade without exceeding schedule duration', async () => {
    const result = await render(
      ['s1', 's2'],
      [base({ crossfade: 1 }), base({ id: 'b', sourceId: 's2', end: 4 })],
    );
    expect(result.duration).toBeCloseTo(7);
  });

  it('renders silence as zero samples between clips', async () => {
    const adapter = new WebAudioArrangerAdapter({
      decode: async () => tone(2, 0.5, 100),
    });
    const result = await adapter.render({
      schedule: scheduleClips([base({ end: 2, silenceAfter: 2 }), base({ id: 'b', sourceId: 's1', end: 2 })]),
      sources: { s1: new Blob() },
    });
    const view = await wavView(result.blob);
    const sampleAt = (frame: number) => view.getInt16(44 + frame * 2, true) / 32767;
    expect(sampleAt(100)).toBeCloseTo(0.5, 0); // 第一段内
    expect(sampleAt(199)).toBeCloseTo(0.5, 0); // 第一段最后一帧
    expect(sampleAt(350)).toBe(0); // 2s 静音区中间
    expect(sampleAt(400)).toBeCloseTo(0.5, 0); // 第二段开始
    expect(sampleAt(500)).toBeCloseTo(0.5, 0);
  });

  it('resamples sources with differing sample rates to one timeline', async () => {
    const adapter = new WebAudioArrangerAdapter({
      decode: async (blob) => ((blob as unknown as { key: string }).key === 'slow' ? tone(4, 0.4, 50) : tone(4, 0.6, 100)),
    });
    const slow = new Blob(); Object.assign(slow as unknown as object, { key: 'slow' });
    const fast = new Blob(); Object.assign(fast as unknown as object, { key: 'fast' });
    const result = await adapter.render({
      schedule: scheduleClips([base({ sourceId: 'slow', end: 4 }), base({ id: 'b', sourceId: 'fast', end: 4 })]),
      sources: { slow, fast },
    });
    expect(result.duration).toBeCloseTo(8);
    const view = await wavView(result.blob);
    const sampleAt = (frame: number) => view.getInt16(44 + frame * 2, true) / 32767;
    expect(Math.abs(sampleAt(10))).toBeCloseTo(0.4, 0);
    expect(Math.abs(sampleAt(450))).toBeCloseTo(0.6, 0);
  });
});
