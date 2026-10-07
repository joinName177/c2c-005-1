import { layoutTimeline, validateArrangement } from '../core/arrangement';
import type { AudioMaterial } from '../core/models';
import type { TimelineItem } from '../core/arrangement';
import type { ArrangementComposerPort } from '../ports/arrangement-composer.port';
import { browserDecode, type DecodedAudio } from './web-audio-cropper.adapter';
import { encodeWavChannels } from './wav-encoder';

interface Dependencies { decode(blob: Blob): Promise<DecodedAudio> }

export class WebAudioComposerAdapter implements ArrangementComposerPort {
  constructor(private readonly deps: Dependencies = { decode: browserDecode }) {}

  async compose(materials: AudioMaterial[], items: TimelineItem[]) {
    const error = validateArrangement(items, materials);
    if (error) throw new Error(error);
    const { placements, total } = layoutTimeline(items);
    const decoded = new Map<string, DecodedAudio>();
    for (const item of items) {
      if (item.kind !== 'clip' || decoded.has(item.materialId)) continue;
      const material = materials.find((entry) => entry.id === item.materialId);
      if (material) decoded.set(item.materialId, await this.deps.decode(material.blob));
    }
    const sources = [...decoded.values()];
    const sampleRate = Math.max(...sources.map((source) => source.sampleRate));
    const channelCount = Math.max(...sources.map((source) => source.channels.length));
    const frames = Math.max(1, Math.round(total * sampleRate));
    const mix = Array.from({ length: channelCount }, () => new Float32Array(frames));
    items.forEach((item, index) => {
      if (item.kind !== 'clip') return;
      const source = decoded.get(item.materialId);
      if (!source) return;
      const placement = placements[index];
      const fadeOut = Math.min(item.crossfade, placement.duration);
      const offset = Math.round(placement.start * sampleRate);
      const length = Math.round(placement.duration * sampleRate);
      for (let frame = 0; frame < length; frame += 1) {
        const time = frame / sampleRate;
        let gain = 1;
        if (placement.fadeIn > 0) gain = Math.min(gain, time / placement.fadeIn);
        if (fadeOut > 0) gain = Math.min(gain, (placement.duration - time) / fadeOut);
        gain = Math.max(0, Math.min(1, gain));
        const position = (item.start + time) * source.sampleRate;
        const base = Math.floor(position);
        const fraction = position - base;
        for (let channel = 0; channel < channelCount; channel += 1) {
          const data = source.channels[channel % source.channels.length];
          const a = data[base] ?? 0;
          const b = data[base + 1] ?? a;
          const target = offset + frame;
          if (target < frames) mix[channel][target] += (a + (b - a) * fraction) * gain;
        }
      }
    });
    return { blob: encodeWavChannels(mix, sampleRate, frames), duration: total };
  }
}
