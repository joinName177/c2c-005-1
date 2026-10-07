import { clipDuration, type ArrangementSchedule, type PositionedClip } from '../core/arrangement';
import type { ArrangementInput, AudioArrangerPort } from '../ports/audio-arranger.port';
import { browserDecode, encodeWav, resample, type DecodedAudio } from './audio-codec';

interface Dependencies { decode(blob: Blob): Promise<DecodedAudio> }

export class WebAudioArrangerAdapter implements AudioArrangerPort {
  constructor(private readonly deps: Dependencies = { decode: browserDecode }) {}

  async render(input: ArrangementInput) {
    const { schedule, sources } = input;
    const decoded = await Promise.all(
      schedule.clips.map((clip) => this.deps.decode(sources[clip.sourceId] ?? new Blob())),
    );
    const sampleRate = decoded.reduce((max, audio) => Math.max(max, audio.sampleRate), 0);
    const channelCount = Math.max(1, ...decoded.map((audio) => audio.channels.length));
    const totalFrames = Math.max(1, Math.ceil(schedule.duration * sampleRate));
    const mix: Float32Array[] = Array.from({ length: channelCount }, () => new Float32Array(totalFrames));

    schedule.clips.forEach((clip, index) => {
      const channels = resample(decoded[index], sampleRate);
      const startFrame = Math.round(clip.start * sampleRate);
      const frames = Math.round(clipDuration(clip) * sampleRate);
      const atFrame = Math.round(clip.at * sampleRate);
      const prev = schedule.clips[index - 1];
      const fadeIn = prev
        ? Math.min(prev.crossfade, clipDuration(prev), clipDuration(clip)) * sampleRate
        : 0;
      const fadeOut = Math.min(clip.crossfade, clipDuration(clip), durationOf(schedule, index + 1)) * sampleRate;
      for (let ch = 0; ch < channelCount; ch += 1) {
        const channel = channels[Math.min(ch, channels.length - 1)] ?? new Float32Array();
        const target = mix[ch];
        for (let i = 0; i < frames && atFrame + i < totalFrames; i += 1) {
          let gain = 1;
          // 等功率交叉淡化，重叠处两支功率相加约等于 1。
          if (fadeIn > 0 && i < fadeIn) gain *= Math.sin((i / fadeIn) * (Math.PI / 2));
          if (fadeOut > 0 && i > frames - fadeOut) gain *= Math.cos(((i - (frames - fadeOut)) / fadeOut) * (Math.PI / 2));
          target[atFrame + i] += (channel[startFrame + i] ?? 0) * gain;
        }
      }
    });
    return { blob: encodeWav(mix, sampleRate, totalFrames), duration: schedule.duration };
  }
}

function durationOf(schedule: ArrangementSchedule, index: number): number {
  const clip: PositionedClip | undefined = schedule.clips[index];
  return clip ? clipDuration(clip) : 0;
}
