import type { AudioMaterial } from '../core/models';
export interface MaterialRepositoryPort { list(): Promise<AudioMaterial[]>; save(material: AudioMaterial): Promise<void>; delete(id: string): Promise<void> }
