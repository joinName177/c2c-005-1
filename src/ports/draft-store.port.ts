import type { ArrangementDraft } from '../core/arrangement';
export interface DraftStorePort { load(): Promise<ArrangementDraft | undefined>; save(draft: ArrangementDraft): Promise<void>; clear(): Promise<void> }
