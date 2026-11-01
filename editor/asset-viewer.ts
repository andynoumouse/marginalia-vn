// Asset viewer: a modal over the editor that shows an image, plays a sound or previews a font, so looking at an
// asset never navigates away from the editor. Left/Right step through the other assets of the same folder.

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i, AUDIO = /\.(ogg|mp3|wav|m4a|flac)$/i, FONT = /\.(ttf|otf|woff2?)$/i;

export const canView = (file: string) => IMAGE.test(file) || AUDIO.test(file) || FONT.test(file);
const url = (file: string) => `/assets/${encodeURI(file)}`;

export class AssetViewer {
  private root: HTMLDivElement;
  private title: HTMLElement;
  private stage: HTMLElement;
  private info: HTMLElement;
  private list: string[] = [];
  private at = 0;
  private returnFocus: (() => void) | null = null;
  private fontCount = 0;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'assetView';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="av-card" role="dialog" aria-modal="true" aria-label="Asset viewer" tabindex="-1">
        <header><strong></strong><span class="hint">Left/Right: other assets in the folder. Esc to close</span>
          <a class="av-open" target="_blank" rel="noopener">Open in tab</a>
          <button type="button" class="close" aria-label="Close viewer">Close</button></header>
        <div class="av-stage"></div>
        <div class="av-info"></div>
      </div>`;
    host.append(this.root);
    this.title = this.root.querySelector('header strong')!;
    this.stage = this.root.querySelector('.av-stage')!;
    this.info = this.root.querySelector('.av-info')!;
    this.root.addEventListener('mousedown', e => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.close')!.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target instanceof HTMLMediaElement)) {
        e.preventDefault();
        this.step(e.key === 'ArrowRight' ? 1 : -1);
      }
    });
  }

  get isOpen() { return !this.root.hidden; }

  /** Show `file` (path under assets/); `siblings` are the files Left/Right move through (viewable ones only). */
  open(file: string, siblings: string[] = [file], returnFocus?: () => void) {
    this.returnFocus = returnFocus ?? null;
    this.list = siblings.filter(canView);
    if (!this.list.includes(file)) this.list = [file];
    this.at = this.list.indexOf(file);
    this.root.hidden = false;
    this.render();
    this.root.querySelector<HTMLElement>('.av-card')!.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.stage.replaceChildren(); // stops playing audio
    this.returnFocus?.();
  }

  private step(d: number) {
    if (this.list.length < 2) return;
    this.at = (this.at + d + this.list.length) % this.list.length;
    this.render();
  }

  private render() {
    const file = this.list[this.at];
    this.title.textContent = file;
    this.root.querySelector<HTMLAnchorElement>('.av-open')!.href = url(file);
    this.info.textContent = this.list.length > 1 ? `${this.at + 1} of ${this.list.length} in ${file.split('/')[0]}/` : '';
    if (IMAGE.test(file)) {
      const img = document.createElement('img');
      img.alt = file;
      img.addEventListener('load', () => { this.info.textContent = `${img.naturalWidth}×${img.naturalHeight}${this.info.textContent ? `   ${this.info.textContent}` : ''}`; });
      img.addEventListener('error', () => this.stage.replaceChildren(Object.assign(document.createElement('div'), { textContent: `Could not load ${file}` })));
      img.src = url(file);
      this.stage.replaceChildren(img);
    } else if (AUDIO.test(file)) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.autoplay = true;
      audio.src = url(file);
      this.stage.replaceChildren(audio);
    } else {
      const family = `vn-asset-font-${this.fontCount++}`;
      const sample = document.createElement('div');
      sample.className = 'av-font';
      sample.style.fontFamily = `"${family}", sans-serif`;
      sample.textContent = 'The quick brown fox jumps over the lazy dog. 0123456789\nAaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz';
      this.stage.replaceChildren(sample);
      new FontFace(family, `url(${url(file)})`).load()
        .then(f => { document.fonts.add(f); })
        .catch(() => { sample.textContent = `Could not load ${file}`; });
    }
  }
}
