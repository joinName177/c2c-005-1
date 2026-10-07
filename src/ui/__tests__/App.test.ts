import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import type { StudioDependencies } from '../useStudio';
import type { VoiceMeme } from '../../core/models';
import type { StoredDraft, DraftRepository } from '../../ports/draft-repository.port';
import type { ArrangementClip } from '../../core/arrangement';

class MemoryDrafts implements DraftRepository {
  draft: StoredDraft | null = null;
  blobs = new Map<string, Blob>();
  async loadDraft() { return this.draft; }
  async saveDraft(draft: StoredDraft) { this.draft = draft; }
  async clearDraft() { this.draft = null; this.blobs.clear(); }
  async getSource(id: string) { return this.blobs.get(id); }
  async putSource(id: string, blob: Blob) { this.blobs.set(id, blob); }
  async deleteSources(ids: string[]) { ids.forEach((id) => this.blobs.delete(id)); }
}

function deps(options: { denied?: boolean; drafts?: MemoryDrafts } = {}): StudioDependencies {
  const works: VoiceMeme[] = [];
  return {
    recorder: {
      isRecording: false,
      start: async () => { if (options.denied) throw new DOMException('denied', 'NotAllowedError'); },
      stop: async () => new Blob(['voice'], { type: 'audio/webm' }),
    },
    analyzer: { analyze: async () => ({ duration: 2, features: { loudness: .75, dynamics: .55, pitch: .8, zeroCrossing: .62, pauseRatio: .12, tempoVariation: .6 } }) },
    cropper: { inspect: async () => ({ duration: 4, needsCrop: false }), crop: async (blob, range) => ({ blob, duration: range.end - range.start }) },
    arranger: { render: async ({ schedule }) => ({ blob: new Blob(['mix']), duration: schedule.duration }) },
    renderer: { render: async () => new Blob(['cover'], { type: 'image/png' }) },
    repository: {
      list: async () => works,
      save: async (m) => { works.push(m); }, rename: async () => {},
      delete: async (id) => { const i = works.findIndex((w) => w.id === id); if (i >= 0) works.splice(i, 1); },
    },
    drafts: options.drafts ?? new MemoryDrafts(),
    share: { share: async () => 'shared' as const },
  };
}

describe('Voice meme App', () => {
  it('shows the studio stages, time limit and sharing disclosure', () => {
    const wrapper = mount(App, { props: { dependencies: deps() } });
    expect(wrapper.text()).toContain('声音表情包工坊');
    expect(wrapper.text()).toContain('编排');
    expect(wrapper.text()).toContain('分享链接不包含原始声音');
  });

  it('shows a recoverable microphone permission error', async () => {
    const wrapper = mount(App, { props: { dependencies: deps({ denied: true }) } });
    await wrapper.get('[data-testid="record"]').trigger('click');
    await Promise.resolve();
    expect(wrapper.text()).toContain('麦克风权限');
  });

  it('records into the pool, renders a shared preview, analyzes and saves', async () => {
    const wrapper = mount(App, { props: { dependencies: deps() } });
    await wrapper.get('[data-testid="record"]').trigger('click');
    await wrapper.get('[data-testid="stop"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('素材池');
    expect(wrapper.get('[data-testid="total-duration"]').text()).toContain('4.00s');
    await wrapper.get('[data-testid="render"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="preview-audio"]').exists()).toBe(true);
    await wrapper.get('[data-testid="analyze"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-emotion="温柔姐姐"]').trigger('click');
    await wrapper.get('[data-testid="to-cover"]').trigger('click');
    await wrapper.get('[aria-label="气泡文字"]').setValue('轻轻说一句');
    await wrapper.get('[data-testid="save-work"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('作品集');
  });

  it('blocks confirm when total exceeds ten seconds', async () => {
    const long = deps();
    long.cropper = { inspect: async () => ({ duration: 12, needsCrop: true }), crop: async (b) => ({ blob: b, duration: 12 }) };
    const wrapper = mount(App, { props: { dependencies: long } });
    await wrapper.get('[data-testid="record"]').trigger('click');
    await wrapper.get('[data-testid="stop"]').trigger('click');
    await flushPromises();
    // 首段自动截到 10s；再加入第二段后扣除重叠仍超限
    await wrapper.get('[data-testid="add-clip-source"]').trigger('click');
    expect(wrapper.get('[data-testid="render"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('不能超过 10 秒');
  });

  it('lists affected clips before deleting a referenced source and can cancel', async () => {
    const wrapper = mount(App, { props: { dependencies: deps() } });
    await wrapper.get('[data-testid="record"]').trigger('click');
    await wrapper.get('[data-testid="stop"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="remove-source-record"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="remove-source-dialog"]').text()).toContain('仍被以下片段引用');
    await wrapper.get('[data-testid="cancel-remove"]').trigger('click');
    expect(wrapper.find('[data-testid="remove-source-dialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('片段 1');
  });

  it('offers to resume an unfinished arrangement after reopening', async () => {
    const drafts = new MemoryDrafts();
    const clips: ArrangementClip[] = [{ id: 'clip-1', sourceId: 'src-1', start: 0, end: 3, silenceAfter: 0, crossfade: 0 }];
    drafts.draft = { title: '没做完', clips, sources: [{ id: 'src-1', name: '录音 1', duration: 6, kind: 'record' }] };
    drafts.blobs.set('src-1', new Blob(['voice']));
    const wrapper = mount(App, { props: { dependencies: deps({ drafts }) } });
    await flushPromises();
    expect(wrapper.get('[data-testid="resume-banner"]').text()).toContain('接着编辑');
    await wrapper.get('[data-testid="resume-btn"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('素材池');
    expect((wrapper.get('[aria-label="作品名称"]').element as HTMLInputElement).value).toBe('没做完');
  });
});
