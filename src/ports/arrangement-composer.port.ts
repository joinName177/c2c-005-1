import type { AudioMaterial } from '../core/models';
import type { TimelineItem } from '../core/arrangement';
export interface ComposedAudio { blob: Blob; duration: number }
export interface ArrangementComposerPort { compose(materials: AudioMaterial[], items: TimelineItem[]): Promise<ComposedAudio> }
