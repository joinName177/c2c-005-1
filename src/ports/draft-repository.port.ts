import type { AudioSource, ArrangementClip } from '../core/arrangement';

/** 未完成或可继续编辑的编排：只存选择，素材 Blob 单独按键存取。 */
export interface StoredDraft {
  title: string;
  clips: ArrangementClip[];
  sources: AudioSource[];
  /** 已保存作品的 id，用于再次编辑时覆盖更新。 */
  memeId?: string;
}

export interface DraftRepository {
  loadDraft(): Promise<StoredDraft | null>;
  saveDraft(draft: StoredDraft): Promise<void>;
  clearDraft(): Promise<void>;
  getSource(id: string): Promise<Blob | undefined>;
  putSource(id: string, blob: Blob): Promise<void>;
  deleteSources(ids: string[]): Promise<void>;
}
