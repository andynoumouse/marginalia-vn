// The particle bursts of the WebGL renderer (`burst <kind> at <where>`): short-lived puffs of sprites in the world, so the
// camera moves them with the scene. The pure parts (the kinds, their physics and look) are engine/src/fx.ts.

import { Container, Sprite, Texture } from 'pixi.js';
import { BURSTS, burstLook, mulberry32, spawnBurst, stepBurst, type BurstName, type BurstParticle, type FxEnv } from '../engine/src/index.js';

/** Most particles alive at once: a script that fires bursts in a loop cannot grow without bound. */
const MAX_PARTICLES = 800;

export class Bursts {
  readonly layer = new Container();
  private live: { p: BurstParticle; kind: BurstName; sprite: Sprite }[] = [];
  private rand = mulberry32(7770777); // decoration only: never the story's RNG
  private soft: Texture | null = null;

  /** A soft round blob (white at the middle, clear at the edge), made when first needed; tinted per particle. */
  private softTexture(): Texture {
    if (this.soft) return this.soft;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return this.soft = Texture.from(c);
  }

  /** Fire a burst at (x, y) in world pixels. */
  add(kind: BurstName, x: number, y: number, count: number | null, life: number | null) {
    const room = MAX_PARTICLES - this.live.length;
    if (room <= 0) return;
    const rect = BURSTS[kind].rect;
    for (const p of spawnBurst(kind, this.rand, x, y, Math.min(count ?? BURSTS[kind].count, room), life)) {
      const sprite = new Sprite(rect ? Texture.WHITE : this.softTexture());
      sprite.anchor.set(0.5);
      sprite.tint = p.color;
      this.layer.addChild(sprite);
      this.live.push({ p, kind, sprite });
    }
  }

  step(dt: number, env: FxEnv = {}) {
    if (!this.live.length) return;
    this.live = this.live.filter(e => {
      if (!stepBurst(e.p, e.kind, dt, env)) { e.sprite.destroy(); return false; }
      const look = burstLook(e.p, e.kind), rect = BURSTS[e.kind].rect;
      e.sprite.position.set(e.p.x, e.p.y);
      e.sprite.alpha = look.alpha;
      e.sprite.rotation = e.p.rot;
      if (rect) e.sprite.scale.set(look.size, look.size * 0.5); // Texture.WHITE is 1px: the size is the scale
      else e.sprite.scale.set(look.size / 64);
      return true;
    });
  }

  /** Drop everything on screen (a scene change, a load). */
  clear() {
    for (const e of this.live) e.sprite.destroy();
    this.live = [];
  }
}
