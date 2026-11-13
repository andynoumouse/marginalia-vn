// The studio dialog's markup (anim-studio.ts wires it): the header with the modes, the left column of sections, the stage with its
// tool row and rig strip, and the right column. Sections and rig tabs come from the helpers below; their ids are what the studio looks up.

import { DEFAULT_FPS, type RigTab } from '../engine/src/index.js';
import { subBlockHtml } from './anim-props.js';
import { toolBarHtml, toolRowHtml } from './studio-toolrow.js';

/** A collapsible section: a header button (chevron, title, a short summary) over its body. The studio opens and closes them. */
const section = (id: string, title: string, body: string, extra = '') => `<section class="as-sect" data-sect="${id}"><h3><button type="button" class="as-sect-head" id="as-head-${id}" aria-controls="as-sect-${id}" aria-expanded="true"><span class="as-chev" aria-hidden="true"></span><span class="as-sect-title">${title}</span><span class="as-sect-sum"></span></button><button type="button" class="as-sect-grab" hidden aria-label="Move ${title}: drag, or use Alt and the arrow keys" title="Move this section" data-dock-handle="${id}"><span aria-hidden="true">⠿</span></button>${extra}</h3><div class="as-sect-body" id="as-sect-${id}" role="region" aria-labelledby="as-head-${id}">${body}</div></section>`;

/** A tab of the rig strip under the stage (Model mode): its name and a short summary; the studio sets which is selected. */
const rigTab = (id: RigTab, title: string, tip: string) => `<button type="button" role="tab" class="as-rig-tab" data-rig="${id}" id="as-rigtab-${id}" aria-controls="as-rigpanel-${id}" aria-selected="false" tabindex="-1" title="${tip}">${title}<span class="as-rig-sum"></span></button>`;

/** The whole dialog. */
export const studioHtml = (): string => `
      <div class="as-card" role="dialog" aria-modal="true" aria-label="Animation studio" tabindex="-1">
        <header><strong></strong>
          <span class="as-modes" role="group" aria-label="Mode">
            <button type="button" data-mode="model" title="Model: what the character is made of. Parts, bones, pivots, physics, and what the parameters do: pick a parameter, pick the parts it moves, pose them at its keys">Model</button><button type="button" data-mode="animate" title="Animate: animations on a timeline, with keys and playback">Animate</button></span>
          <span class="as-spacer"></span>
          <button type="button" data-t="open" hidden title="Open another character folder">Open...</button>
          <button type="button" data-t="export" title="Export the animation on show as a PNG sequence with transparency">Export...</button>
          <button type="button" data-t="resetdock" hidden title="Put the sections back in their first columns and order">Reset layout</button>
          <button type="button" data-t="undo">Undo</button><button type="button" data-t="redo">Redo</button>
          <button type="button" data-t="apply" class="primary">Apply</button>
          <button type="button" data-t="scene" hidden title="Apply, close and play the script from the animate line you came from">Try in scene</button>
          <button type="button" class="close" aria-label="Close animation studio">Close</button></header>
        <div class="as-body">
          <div class="as-side">
            <div class="as-picker">
              <label>Animation <select class="as-anim" aria-label="Animation"></select></label>
              <button type="button" class="as-more" aria-haspopup="menu" aria-label="Animation actions" title="New, copy, rename and delete animations">⋯</button>
            </div>
            <div class="as-auto as-automatic">
              <span class="as-pivot-name">Automatic</span>
              <label>Every <input type="number" class="as-every-min" min="0.1" step="0.5" placeholder="3" aria-label="Shortest wait in seconds after each run; empty for no timer"> to <input type="number" class="as-every-max" min="0.1" step="0.5" placeholder="6" aria-label="Longest wait in seconds after each run"> s</label>
              <label>While <input type="text" class="as-while" list="as-conds" size="22" placeholder="e.g. speaking, mood > 2" spellcheck="false" autocomplete="off" aria-label="Condition the animation loops under; empty for none"></label>
              <datalist id="as-conds"><option value="always"><option value="speaking"></datalist>
              <span class="as-pivot-hint as-auto-hint"></span>
            </div>
            <form class="as-name" hidden><span></span>
              <input type="text" aria-label="Animation name" spellcheck="false" autocomplete="off">
              <div><button type="submit">OK</button><button type="button">Cancel</button></div></form>
            <div class="as-looks"></div>
            <div class="as-cols"><div class="as-dock" data-zone="left">
              ${section('poses', 'Poses', '<div class="apo"></div>')}
              ${section('params', 'Parameters', '<div class="ap"></div>', '<button type="button" class="ap-add ap-model-only" aria-haspopup="menu" aria-label="Add a parameter or a pad" title="Add a parameter (a slider) or a pad (two parameters on one 2D control)">+</button>')}
              <div class="as-grip as-grip-h" data-grip="split" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Height of the Parameters block: drag, or use the up and down arrow keys" title="Drag to resize"></div>
              ${section('tree', 'Parts', '<div class="as-tree"></div>')}
            </div><div class="as-dock" data-zone="left2" aria-label="Second left column"></div></div>
          </div>
          <div class="as-grip as-grip-v" data-grip="left" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of the left column: drag, or use the left and right arrow keys; drag it to the window's edge, or press Enter, to fold the column away" title="Drag to resize; drag to the edge or double-click to fold"></div>
          <div class="as-grip as-grip-r" data-grip="right" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of the right column: drag, or use the left and right arrow keys; drag it to the window's edge, or press Enter, to fold the column away" title="Drag to resize; drag to the edge or double-click to fold"></div>
          <button type="button" class="as-rail as-rail-left" data-rail="left" hidden aria-label="Show the left column" title="Show the left column">›</button>
          <button type="button" class="as-rail as-rail-right" data-rail="right" hidden aria-label="Show the right column" title="Show the right column">‹</button>
          <div class="as-main">
            <div class="as-gizmo">
              ${toolRowHtml()}
            </div>
            ${toolBarHtml()}
            <div class="as-stage"></div>
            <div class="as-rig" hidden>
              <div class="as-rig-head"><div class="as-rig-tabs" role="tablist" aria-label="Rig setup">${rigTab('physics', 'Physics', 'Physics: chains that make hair and cloth follow the motion. Click the open tab to fold the strip')}${rigTab('reactions', 'Reactions', 'Reactions: poses the character holds while a condition is true, and test variables. Click the open tab to fold the strip')}</div>
                <button type="button" class="as-rig-fold" aria-controls="as-rigpanel-physics as-rigpanel-reactions" aria-expanded="false"><span class="as-chev" aria-hidden="true"></span></button></div>
              <div class="as-rig-panel as-sect-body" role="tabpanel" id="as-rigpanel-physics" aria-labelledby="as-rigtab-physics" data-rig="physics" hidden><div class="ph"></div></div>
              <div class="as-rig-panel as-sect-body" role="tabpanel" id="as-rigpanel-reactions" aria-labelledby="as-rigtab-reactions" data-rig="reactions" hidden><div class="ar"></div></div>
            </div>
            <div class="as-transport">
              <button type="button" class="as-play" aria-label="Play" title="Play or pause (Space)">Play</button>
              <label><input type="checkbox" class="as-loop"> Loop</label>
              <input type="range" class="as-slider" min="0" max="1000" value="0" aria-label="Position in the animation">
              <span class="as-time" aria-live="off"></span>
              <label>Length <input type="number" class="as-dur" min="0.05" step="0.1" aria-label="Length in seconds"> s</label>
              <button type="button" class="as-tlfold" aria-expanded="true" aria-controls="as-tlwrap" title="Fold the timeline to this row (the stage takes its room)">▾</button>
            </div>
            <div class="as-tlwrap" id="as-tlwrap"><svg class="as-ruler" aria-hidden="true"></svg><svg class="as-timeline" role="group" aria-label="Timeline: a lane for each channel (x, y, scale, rot, opacity), each keyed parameter and each frame track; its keys are buttons. Double-click a lane to add a key, drag a key to move it."></svg></div>
          </div>
          <div class="as-inspect"><div class="as-focus" role="group" aria-label="Focus: what is chosen, and what to join it to"></div><div class="as-dock" data-zone="right">
            ${section('keyforms', 'Keyforms', '<div class="ab"></div>')}
            ${section('param', 'Parameter', '<div class="apm"></div>')}
            ${section('sel', 'Properties', `
              <div class="as-sel-name as-sel-anim"><strong class="as-gz-name"></strong></div>
              <div class="as-sel-anim as-gz-nums" role="group" aria-label="At the playhead"><span class="as-pivot-name">At the playhead</span>
                <label>x <input type="number" data-g="x" step="0.005"></label><label>y <input type="number" data-g="y" step="0.005"></label><label>scale <input type="number" data-g="scale" step="0.005"></label><label>rot <input type="number" data-g="rot" step="0.5"></label><label>opacity <input type="number" data-g="opacity" min="0" step="0.05"></label>
                <span class="as-pivot-hint">x, y: fractions of the stage · scale: added to 1 · rot: degrees · opacity: 0 to 1</span></div>
              <div class="as-sel-anim as-inspector" role="group" aria-label="Key">
                <label>Key <select class="as-key" aria-label="Key"></select></label>
                <label>at (s) <input type="number" data-f="t" min="0" step="0.01" aria-label="Time of the key in seconds"></label>
                <label>x <input type="number" data-f="x" step="0.005"></label>
                <label>y <input type="number" data-f="y" step="0.005"></label>
                <label>scale <input type="number" data-f="scale" step="0.005"></label>
                <label>rot <input type="number" data-f="rot" step="0.5"></label>
                <label>opacity <input type="number" data-f="opacity" min="0" step="0.05"></label>
                <label>ease <select class="as-ease" aria-label="Ease into this key"></select></label>
                <button type="button" class="as-delkey">Delete key</button>
                <span class="as-add"><button type="button" class="as-addkey">Add key at playhead for</button>
                  <select class="as-addch" aria-label="Channel of the new key"></select></span>
              </div>
              <div class="as-sel-model as-subs">
                <p class="as-pivot-hint as-subs-empty" hidden></p>
                ${subBlockHtml('transform', 'Transform', `
                  <div class="as-pivot">
                    <span class="as-pivot-name" title="Where the part turns and scales, in pixels of the PSD canvas">Pivot (PSD px)</span>
                    <label>x <input type="number" data-p="x" step="1"></label>
                    <label>y <input type="number" data-p="y" step="1"></label>
                    <span class="as-pivot-hint" hidden></span>
                  </div>
                  <p class="as-pivot-hint as-rest-note" hidden>Some parameters are not at their defaults: the stage shows that pose, but pivots belong to the rest pose.</p>
                  <div class="as-tf"></div>`, true)}
                ${subBlockHtml('deform', 'Deform', '<div class="aw"></div>')}
                ${subBlockHtml('skin', 'Skin', '<div class="aww"></div>')}
                ${subBlockHtml('clip', 'Clip', '<div class="am"></div>')}
                ${subBlockHtml('variants', 'Variants', '<div class="as-vars"></div>')}
              </div>
              <div class="ap-keyedit" role="group" aria-label="Parameter key"><span class="as-pivot-name">Parameter key</span>
                <label>at (s) <input type="number" data-pk="t" min="0" step="0.01" aria-label="Time of the parameter key in seconds"></label>
                <label>value <input type="number" data-pk="v" step="0.01"></label>
                <label>ease <select class="ap-ease" aria-label="Ease into this parameter key"></select></label>
                <button type="button" class="ap-delkey">Delete key</button>
                <span class="as-pivot-hint ap-keyhint">Click a diamond on a parameter lane of the timeline. Double-click a parameter lane to add a key there.</span></div>
              <div class="as-detail"></div>`)}
            ${section('frames', 'Frames', `
              <div class="af-bar"><span class="as-pivot-name">Frame track</span>
                <label>Slot <select class="af-slot" aria-label="Slot whose variants are the frames"></select></label>
                <label>fps <input type="number" class="af-fps" min="1" max="60" step="1" value="${DEFAULT_FPS}" aria-label="Frames a second"></label>
                <button type="button" class="af-fill">Frames from this slot</button>
                <button type="button" class="af-remove">Remove track</button></div>
              <div class="af-edit"><span class="as-pivot-name">Frame</span>
                <label>shows <select class="af-frame" aria-label="Variant this block shows"></select></label>
                <label>from (s) <input type="number" class="af-t" min="0" step="0.01" aria-label="Time the frame starts, in seconds"></label>
                <button type="button" class="af-dup">Duplicate</button>
                <button type="button" class="af-earlier" title="Swap this frame with the one before it; the times stay">Earlier</button>
                <button type="button" class="af-later" title="Swap this frame with the one after it; the times stay">Later</button>
                <button type="button" class="af-del">Delete</button>
                <span class="as-pivot-hint af-hint"></span></div>`)}
            ${section('place', 'Place in scene', `
              <div class="as-place">
                <span class="as-pivot-name">Place</span>
                <button type="button" class="as-place-btn" aria-pressed="false">Place on stage</button>
                <label>x <input type="number" data-pl="x" step="0.01"></label>
                <label>y <input type="number" data-pl="y" step="0.01"></label>
                <label>scale <input type="number" data-pl="scale" step="0.05" min="0.05"></label>
                <label><input type="checkbox" class="as-flip"> flip</label>
                <label>anchor <input type="text" class="as-anchor" list="as-anchornames" size="9" placeholder="feet"></label>
                <datalist id="as-anchornames"></datalist>
                <input type="text" class="as-place-line" readonly aria-label="The show line for this placement" size="38">
                <button type="button" class="as-place-copy">Copy</button>
                <button type="button" class="as-place-insert" hidden>Insert in script</button>
                <button type="button" class="as-place-anim" hidden title="Put an animate line for the animation on show into the script, under the line the studio was opened from">Insert animate line</button>
                <span class="as-pivot-hint">Drag the character on the stage, then insert or paste the line into the script. It includes the look and slot variants chosen on the left.</span>
              </div>`)}
          </div></div>
        </div>
        <div class="as-note" role="status"></div>
      </div>`;
