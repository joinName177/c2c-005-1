import { validateCropRange, type CropRange } from '../core/models';
import type { AudioCropperPort } from '../ports/audio-cropper.port';
import { browserDecode, encodeWav, type DecodedAudio } from './audio-codec';

interface Dependencies { decode(blob: Blob): Promise<DecodedAudio> }
export type { DecodedAudio };
export class WebAudioCropperAdapter implements AudioCropperPort {
  constructor(private readonly deps: Dependencies = { decode: browserDecode }) {}
  async inspect(blob: Blob) { const audio = await this.deps.decode(blob); return { duration: audio.duration, needsCrop: audio.duration > 10 }; }
  async crop(blob: Blob, range: CropRange) {
    const audio = await this.deps.decode(blob);
    const safe = { start: Math.max(0, range.start), end: Math.min(audio.duration, range.start + Math.min(10, range.end - range.start)) };
    const error = validateCropRange(safe, audio.duration); if (error) throw new Error(error);
    return { blob: encodeWav(audio.channels, audio.sampleRate, Math.floor(audio.duration * audio.sampleRate), safe), duration: safe.end - safe.start };
  }
}
