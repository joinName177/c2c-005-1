import type { CropRange } from '../core/models';

export interface DecodedAudio { sampleRate: number; duration: number; channels: Float32Array[] }

export async function browserDecode(blob: Blob): Promise<DecodedAudio> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return {
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice()),
    };
  } finally {
    await context.close();
  }
}

/** 线性插值重采样到目标采样率。 */
export function resample(input: DecodedAudio, targetRate: number): Float32Array[] {
  if (input.sampleRate === targetRate) return input.channels.map((c) => c.slice());
  const ratio = input.sampleRate / targetRate;
  const length = Math.floor(input.duration * targetRate);
  return input.channels.map((channel) => {
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = i * ratio;
      const left = Math.floor(position);
      const next = Math.min(channel.length - 1, left + 1);
      const fraction = position - left;
      out[i] = (channel[left] ?? 0) * (1 - fraction) + (channel[next] ?? 0) * fraction;
    }
    return out;
  });
}

/** 交错 PCM 编码为 16-bit WAV。 */
export function encodeWav(channels: Float32Array[], sampleRate: number, length: number, range?: CropRange): Blob {
  let source = channels;
  let offset = 0;
  let frames = length;
  if (range) {
    offset = Math.floor(range.start * sampleRate);
    frames = Math.min(length - offset, Math.floor((range.end - range.start) * sampleRate));
  }
  const buffer = new ArrayBuffer(44 + frames * source.length * 2);
  const view = new DataView(buffer);
  const write = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + frames * source.length * 2, true); write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, source.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * source.length * 2, true);
  view.setUint16(32, source.length * 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, frames * source.length * 2, true);
  let pointer = 44;
  for (let i = 0; i < frames; i += 1) for (const channel of source) {
    const value = Math.max(-1, Math.min(1, channel[i + offset] ?? 0));
    view.setInt16(pointer, value < 0 ? value * 32768 : value * 32767, true);
    pointer += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
