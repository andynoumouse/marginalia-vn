// The preview pane as a phone or tablet (docs/design/mobile.md, step 3): the iframe gets the device's size and the game inside acts
// as on a touch screen (a "device" message: touch layout on, the mouse as the finger). The choice lasts until the page is closed.

import { $, postPreview, setStatus } from './state.js';

export interface Device { name: string; label: string; size: [number, number] | null }

export const DEVICES: Device[] = [
  { name: 'desktop', label: 'Desktop (fill the pane)', size: null },
  { name: 'phone', label: 'Phone, landscape (844 x 390)', size: [844, 390] },
  { name: 'phone-portrait', label: 'Phone, portrait (390 x 844)', size: [390, 844] },
  { name: 'tablet', label: 'Tablet, landscape (1024 x 768)', size: [1024, 768] },
];

let current = DEVICES[0];
const frame = () => $<HTMLIFrameElement>('preview');

/** Sizes the preview like `device` and tells the game inside whether it is a touch screen. */
export function setPreviewDevice(name: string) {
  const device = DEVICES.find(d => d.name === name) ?? DEVICES[0];
  current = device;
  const el = frame();
  if (device.size) {
    const [w, h] = device.size;
    el.style.cssText = `width:${w}px;height:${h}px;max-width:100%;max-height:100%;justify-self:center;align-self:center;outline:1px solid #2a303c`;
  } else el.style.cssText = '';
  postPreview({ type: 'device', touch: device.size !== null });
  setStatus(device.size ? `preview: ${device.label}` : 'preview: desktop');
}

/** The game inside forgets the device when it reloads: tell it again. */
export function keepPreviewDevice() {
  frame().addEventListener('load', () => { if (current.size) postPreview({ type: 'device', touch: true }); });
}
