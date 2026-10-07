import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import type { StudioDependencies } from '../useStudio';
import { layoutTimeline, type ArrangementDraft } from '../../core/arrangement';
import type { AudioMaterial, VoiceMeme } from '../../core/models';

function deps(options: { denied?: boolean } = {}): StudioDependencies {
  const works: VoiceMeme[] = [];
  const pool: AudioMaterial[] = [];
  let draft: ArrangementDraft | undefined;
  return {
    recorder:{isRecording:false,start:async()=>{if(options.denied)throw new DOMException('denied','NotAllowedError')},stop:async()=>new Blob(['voice'],{type:'audio/webm'})},
    analyzer:{analyze:async()=>({duration:2,features:{loudness:.75,dynamics:.55,pitch:.8,zeroCrossing:.62,pauseRatio:.12,tempoVariation:.6}})},
    cropper:{inspect:async()=>({duration:2,needsCrop:false}),crop:async(blob,range)=>({blob,duration:range.end-range.start})},
    composer:{compose:async(_materials,items)=>({blob:new Blob(['mix']),duration:layoutTimeline(items).total})},
    materials:{list:async()=>pool,save:async(m)=>{pool.push(m)},delete:async(id)=>{const i=pool.findIndex(m=>m.id===id);if(i>=0)pool.splice(i,1)}},
    drafts:{load:async()=>draft,save:async(d)=>{draft=d},clear:async()=>{draft=undefined}},
    renderer:{render:async()=>new Blob(['cover'],{type:'image/png'})},
    repository:{list:async()=>works,save:async(m)=>{works.push(m)},rename:async()=>{},delete:async(id)=>{const i=works.findIndex(w=>w.id===id);if(i>=0)works.splice(i,1)}},
    share:{share:async()=> 'shared'},
  };
}

describe('Voice meme App', () => {
  it('shows the studio stages, time limit and sharing disclosure', () => {
    const wrapper = mount(App,{props:{dependencies:deps()}});
    expect(wrapper.text()).toContain('声音表情包工坊');
    expect(wrapper.text()).toContain('编排');
    expect(wrapper.text()).toContain('00:10 MAX');
    expect(wrapper.text()).toContain('分享链接不包含原始声音');
  });
  it('shows a recoverable microphone permission error', async () => {
    const wrapper=mount(App,{props:{dependencies:deps({denied:true})}}); await wrapper.get('[data-testid="record"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('麦克风权限');
  });
  it('arranges, composes, labels and saves a work to the gallery', async () => {
    const wrapper=mount(App,{props:{dependencies:deps()}}); await wrapper.get('[data-testid="record"]').trigger('click'); await wrapper.get('[data-testid="stop"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('素材池');
    expect(wrapper.text()).toContain('总时长 2.0s / 10s');
    await wrapper.get('[data-testid="compose"]').trigger('click'); await flushPromises();
    await wrapper.get('[data-emotion="温柔姐姐"]').trigger('click'); expect(wrapper.text()).toContain('已手动选择');
    await wrapper.get('[data-testid="to-cover"]').trigger('click'); await wrapper.get('[aria-label="气泡文字"]').setValue('轻轻说一句'); await wrapper.get('[data-testid="save-work"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('作品集'); expect(wrapper.text()).toContain('我的声音表情');
  });
  it('asks before deleting a material that clips still use', async () => {
    const wrapper=mount(App,{props:{dependencies:deps()}}); await wrapper.get('[data-testid="record"]').trigger('click'); await wrapper.get('[data-testid="stop"]').trigger('click'); await flushPromises();
    const selector='[data-testid^="delete-material-"]';
    await wrapper.get(selector).trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('仍被 1 个片段引用');
    await wrapper.get('[data-testid="cancel-delete"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('素材池');
    await wrapper.get(selector).trigger('click'); await flushPromises();
    await wrapper.get('[data-testid="confirm-delete"]').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('还没有素材');
  });
});
