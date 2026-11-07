// Types one line into the text box (or an NVL page): characters at the player's speed, pauses and {w} waits, pages for a
// line too long for the box, the voice recording, and what happens when the line is shown in full (skip, auto-advance,
// wait for the player). The renderer keeps the state other methods share (timers, the advance hook) behind `TypeHost`.

import { startFlow, finished, held, released, ended, clickAct, kickAct, settleAfterVoice, settlePlan, pagePlan, waitPlan, type SayEvent } from '../engine/src/index.js';
import { look, pageStarts, type Spot } from './line-text.js';
import { TEXT_INSTANT } from './settings.js';
import type { AudioSystem } from './audio.js';

/** What the line needs from the renderer: its settings, the hooks other methods call, and its pieces. */
export interface TypeHost {
  skipping: boolean;
  autoOn: boolean;
  autoDelay: number;
  textSpeed: number;
  paused: boolean;
  lang: string;
  readonly audio: AudioSystem;
  advanceFn: (() => void) | null;
  endLine: (() => void) | null;
  lineKick: (() => void) | null;
  lineVoice: string | null;
  typeTimer: number;
  settleTimer: number;
  onVoice(voiced: boolean): void;
  announce(name: string | null | undefined, text: string): void;
  dropSkipping(): void;
  speakTick(who: string | null): void;
  fitPage(): void;
}

/** The line's own parts: where it types (`frame` holds the done flag), its text and how it is blipped. */
export interface TypeLine {
  ev: SayEvent;
  frame: HTMLElement;
  target: HTMLElement;
  plain: string;
  /** Whether skipping may pass this line (already read, or skip-all). */
  skippable: () => boolean;
  blip: ((ch: string) => void) | null;
}

/** Resolves when the player moves past the line. */
export function typeLine(h: TypeHost, { ev, frame, target, plain, skippable, blip }: TypeLine): Promise<void> {
  const st = ev.style;
  return new Promise<void>(resolve => {
      type Run = Extract<SayEvent['segments'][number], { kind: 'text' }>;
      type Item = { ch: string; run: Run } | { pause: number } | { wait: true };
      const items: Item[] = [];
      for (const seg of ev.segments) {
        if (seg.kind === 'pause') items.push({ pause: seg.seconds });
        else if (seg.kind === 'wait') items.push({ wait: true });
        else if (seg.kind === 'text') {
          // Ruby text is shown as one piece; wavy and shaking text animates per character.
          if (seg.ruby) items.push({ ch: seg.text, run: seg });
          else for (const ch of Array.from(seg.text)) items.push({ ch, run: seg });
        }
      }
      const autoNext = ev.segments.some(s => s.kind === 'next');
      const isText = (it: Item): it is { ch: string; run: Run } => 'ch' in it;

      let idx = 0, flow = startFlow(), told = false, span: HTMLSpanElement | null = null, key = '';
      // The whole line is read once, when its first page is complete (a long line is not held back until its last page).
      const tell = () => { if (!told && !(h.skipping && skippable())) { told = true; h.announce(ev.name, plain); } };
      /** Show one character (or ruby piece); returns where it landed, for measuring pages. */
      const put = (it: { ch: string; run: Run }): Spot => {
        const r = it.run;
        if (r.ruby || r.fx) {
          const el = document.createElement(r.ruby ? 'ruby' : 'span');
          el.textContent = it.ch;
          if (r.ruby) { const rt = document.createElement('rt'); rt.textContent = r.ruby; el.append(rt); }
          look(el, r);
          if (r.fx) el.style.animationDelay = `${(target.childElementCount % 24) * 0.07}s`;
          target.append(el);
          span = null;
          if (ev.nvl) h.fitPage();
          return { node: el, at: -1, len: 0 };
        }
        const k = `${r.italic}${r.bold}${r.color ?? ''}${r.size ?? ''}`;
        if (!span || k !== key) {
          span = document.createElement('span');
          look(span, r);
          span.append(document.createTextNode(''));
          target.append(span);
          key = k;
        }
        const t = span.firstChild as Text;
        t.appendData(it.ch);
        if (ev.nvl) h.fitPage();
        return { node: t, at: t.length - it.ch.length, len: it.ch.length };
      };
      // A line too long for the text box is split into pages: lay it all out once, find where each page starts, clear it.
      const pages = ev.nvl ? [] : pageStarts(target, items.map(it => (isText(it) ? (s => (it.ch.trim() ? s : null))(put(it)) : null)));
      if (!ev.nvl) { target.replaceChildren(); span = null; }
      let page = 0;
      const pageEnd = () => pages[page] ?? items.length;
      // The recording starts with the line; auto-advance waits for it to end, and moving on (or skipping) cuts it.
      let voicePlaying = false;
      const voiced = h.audio.hasVoice(ev.id, h.lang);
      h.lineVoice = voiced ? ev.id : null;
      h.onVoice(voiced);
      if (voiced && !(h.skipping && skippable())) {
        voicePlaying = true;
        // `sync()` cuts the recording, which resolves this too: by then the line is gone and `settle` would run on the next line's timers.
        void h.audio.voice(ev.id, h.lang)?.then(() => { voicePlaying = false; if (h.endLine === endThis && settleAfterVoice(flow)) settle(); });
      } else h.audio.stopVoice();
      const next = () => {
        flow = ended(flow);
        h.audio.stopVoice();
        clearTimeout(h.settleTimer);
        h.endLine = null;
        h.advanceFn = null;
        h.lineKick = null;
        resolve();
      };
      // The line is fully shown: skip on, auto-advance, or wait for the player.
      const settle = () => {
        clearTimeout(h.settleTimer);
        const later = (ms: number) => { h.settleTimer = window.setTimeout(() => (h.paused ? settle() : next()), ms); };
        const plan = settlePlan({ skipping: h.skipping, skippable: h.skipping && skippable(), autoOn: h.autoOn, autoMs: (h.autoDelay + items.length * 0.02) * 1000, voicePlaying, autoNext });
        if (plan.dropSkip) h.dropSkipping(); // unread text: stop here
        if (plan.after !== null) later(plan.after);
      };
      // The box is full and the line goes on: wait like at {w}, then clear the box and type the next page.
      const pageFull = () => {
        clearTimeout(h.typeTimer);
        clearTimeout(h.settleTimer);
        h.speakTick(null);
        frame.dataset.done = 'true';
        tell();
        flow = held(flow, 'page');
        const plan = pagePlan({ skipping: h.skipping, skippable: h.skipping && skippable(), autoOn: h.autoOn, autoMs: (h.autoDelay + (pageEnd() - (pages[page - 1] ?? 0)) * 0.02) * 1000 });
        if (plan.dropSkip) h.dropSkipping(); // unread text: stop here
        if (plan.after !== null) h.settleTimer = window.setTimeout(turn, plan.after);
      };
      /** Clear the box and type the next page. */
      const turn = () => {
        if (flow.hold !== 'page') return;
        flow = released(flow);
        clearTimeout(h.settleTimer);
        page++;
        target.replaceChildren();
        span = null;
        frame.dataset.done = 'false';
        if (h.skipping && skippable()) finishTyping(); else step();
      };
      const resume = () => {
        if (flow.hold !== 'wait') return;
        flow = released(flow);
        clearTimeout(h.settleTimer);
        step();
      };
      const finishTyping = () => {
        clearTimeout(h.typeTimer);
        flow = released(flow);
        while (idx < pageEnd()) { const it = items[idx++]; if (isText(it)) put(it); }
        if (idx < items.length) { pageFull(); return; }
        h.speakTick(null);
        flow = finished(flow);
        frame.dataset.done = 'true';
        tell();
        settle();
      };
      const instant = h.textSpeed >= TEXT_INSTANT;
      const cps = h.textSpeed * (st.speed ?? 1);
      const step = () => {
        if (idx >= pageEnd()) { if (idx < items.length) pageFull(); else finishTyping(); return; }
        const it = items[idx++];
        if ('pause' in it) { h.typeTimer = window.setTimeout(step, it.pause * 1000); return; }
        if ('wait' in it) {
          const plan = waitPlan({ skipping: h.skipping, skippable: h.skipping && skippable(), autoOn: h.autoOn, autoMs: h.autoDelay * 1000 });
          if (plan.skip) { step(); return; }
          // Stop here until the player clicks (or, in auto mode, for a moment); finishing the line still shows everything.
          flow = held(flow, 'wait');
          if (plan.after !== null) h.settleTimer = window.setTimeout(resume, plan.after);
          return;
        }
        put(it);
        if (instant) { step(); return; } // pauses still wait
        blip?.(it.ch);
        h.speakTick(ev.who);
        h.typeTimer = window.setTimeout(step, 1000 / (cps * (it.run.speed ?? 1))); // {speed=} scales this run
      };
      const endThis = () => { clearTimeout(h.typeTimer); next(); };
      h.endLine = endThis;
      h.lineKick = () => {
        const act = kickAct(flow, h.skipping && skippable());
        if (act === 'settle') settle(); else if (act === 'finish') finishTyping();
      };
      h.advanceFn = () => {
        const act = clickAct(flow);
        if (act === 'release') { if (flow.hold === 'page') turn(); else resume(); } else if (act === 'next') next(); else finishTyping();
      };
      if (h.skipping && skippable()) finishTyping();
      else step();
  });
}
