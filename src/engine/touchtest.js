// Settings ▸ DEV: TOUCH TEST (or ?touchtest): a red ring where each touch lands, drawn in the
// same layer as the unit, and what the browser says about the window. If a ring shows up away
// from the finger, the page is drawn in one place and touches are read in another (the iOS
// bug that made the buttons look higher than where they answered); the numbers say by how
// much and where. Nothing is saved; it switches off with the page.
const name = (el) => {
  const b = el && el.closest && el.closest('[data-btn], #wheel, #screen');
  if (b) return (b.dataset.btn || b.id).toUpperCase();
  return el ? (el.id || el.tagName).toUpperCase() : 'NOTHING';
};

export class TouchTest {
  constructor(device) { this.device = device; this.on = false; this.last = null; }

  toggle(on = !this.on) {
    if (on && !this.on) this.open();
    if (!on && this.on) this.close();
    this.on = on;
    return on;
  }

  open() {
    this.layer = Object.assign(document.createElement('div'), { id: 'touchtest' });
    this.layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:8';
    this.probe = document.createElement('div');
    this.probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    // The numbers go inside the unit, so they turn with it and read the right way up.
    this.panel = Object.assign(document.createElement('div'), { id: 'touchpanel' });
    this.panel.style.cssText = 'position:absolute;left:8px;right:8px;top:8px;z-index:8;pointer-events:none;padding:6px 8px;border-radius:4px;background:rgba(24,8,8,.86);color:#fff;font:10px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap';
    document.body.append(this.layer, this.probe);
    this.device.appendChild(this.panel);
    this.down = (e) => this.mark(e);
    document.addEventListener('pointerdown', this.down, true);
    this.timer = setInterval(() => this.report(), 500);
    this.report();
  }

  close() {
    document.removeEventListener('pointerdown', this.down, true);
    clearInterval(this.timer);
    for (const el of [this.layer, this.probe, this.panel]) el && el.remove();
    this.layer = this.probe = this.panel = null;
  }

  mark(e) {
    const x = Math.round(e.clientX), y = Math.round(e.clientY);
    this.last = { x, y, what: name(document.elementFromPoint(e.clientX, e.clientY)) };
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;left:${x - 15}px;top:${y - 15}px;width:30px;height:30px;border-radius:50%;border:2px solid #ff3b2f;box-shadow:0 0 0 1px #fff, inset 0 0 0 1px #fff;background:radial-gradient(circle, #ff3b2f 0 2px, transparent 2.5px)`;
    this.layer.appendChild(ring);
    while (this.layer.children.length > 6) this.layer.firstChild.remove();
    this.report();
  }

  report() {
    if (!this.panel) return;
    const vv = window.visualViewport, p = getComputedStyle(this.probe), n = (v) => Math.round(parseFloat(v) || 0);
    const app = navigator.standalone || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
    const l = this.last;
    this.panel.textContent = [
      'TOUCH TEST · TAP ANYWHERE: EACH RED RING SHOULD SIT RIGHT UNDER YOUR FINGER',
      `WINDOW ${innerWidth}×${innerHeight} · SCREEN ${screen.width}×${screen.height} @${devicePixelRatio}× · ${app ? 'HOME SCREEN APP' : 'BROWSER'}`,
      `VISIBLE ${vv ? `${Math.round(vv.width)}×${Math.round(vv.height)} AT ${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : 'N/A'} · SCROLLED ${Math.round(scrollX)},${Math.round(scrollY)}`,
      `SAFE AREA TOP ${n(p.paddingTop)} RIGHT ${n(p.paddingRight)} BOTTOM ${n(p.paddingBottom)} LEFT ${n(p.paddingLeft)} · UNIT ${this.device.classList.contains('turned') ? 'TURNED' : 'LEVEL'}`,
      l ? `LAST TOUCH ${l.x},${l.y} · THE PAGE SAYS IT WAS ON: ${l.what}` : 'NO TOUCH YET',
    ].join('\n');
  }
}
