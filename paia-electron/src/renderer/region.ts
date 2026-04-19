// Region selector overlay script. Self-contained — does NOT use React or
// import from the renderer bundle. Compiled separately by esbuild into
// dist/renderer/region.js so the overlay loads instantly.
//
// region.html and index.html each load their own JS bundle, so this
// file's `window.paia` shape doesn't actually need to match the full
// PaiaApi from index.tsx. We avoid declaring the global here (which
// would conflict with src/renderer/lib/api.ts at typecheck time) and
// instead cast at the use site.

// Force this file to be treated as a module so esbuild emits clean ESM.
export {};

interface Rect { x: number; y: number; width: number; height: number; }

interface PaiaRegionApi {
  regionResult(rect: Rect | null): Promise<void>;
  regionCancel(): Promise<void>;
}

(function main() {
  const sel = document.getElementById('selection') as HTMLDivElement;
  const sizeBadge = document.getElementById('size') as HTMLDivElement;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let curRect: Rect | null = null;

  function setRect(r: Rect) {
    curRect = r;
    sel.style.display = 'block';
    sel.style.left = r.x + 'px';
    sel.style.top = r.y + 'px';
    sel.style.width = r.width + 'px';
    sel.style.height = r.height + 'px';
    sizeBadge.style.display = 'block';
    sizeBadge.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    sizeBadge.style.left = r.x + 'px';
    sizeBadge.style.top = (r.y - 22) + 'px';
    if (r.y < 22) sizeBadge.style.top = (r.y + r.height + 4) + 'px';
  }

  function fromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  window.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    setRect({ x: startX, y: startY, width: 0, height: 0 });
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    setRect(fromPoints(startX, startY, e.clientX, e.clientY));
  });

  // Cast at the use site so this file doesn't fight with the main
  // renderer's global window.paia declaration.
  const api = (window as unknown as { paia: PaiaRegionApi }).paia;

  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const r = fromPoints(startX, startY, e.clientX, e.clientY);
    void api.regionResult(r);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      void api.regionCancel();
    }
  });
})();
