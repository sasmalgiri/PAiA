// Excalidraw-backed whiteboard artifact. The artifact's `content` is the
// Excalidraw scene JSON (elements + appState); we load lazily so the
// ~5 MB of Excalidraw assets only hits the bundle when the user actually
// opens a whiteboard.

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

const Excalidraw = lazy(() =>
  import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })),
);

interface Props {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}

type Scene = {
  elements: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
};

function parseScene(raw: string): Scene {
  if (!raw.trim()) return { elements: [], appState: {}, files: {} };
  try {
    const parsed = JSON.parse(raw) as Scene;
    return {
      elements: Array.isArray(parsed.elements) ? parsed.elements : [],
      appState: parsed.appState ?? {},
      files: parsed.files ?? {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

export function Whiteboard({ value, onChange, readOnly }: Props) {
  const initial = useMemo(() => parseScene(value), []); // eslint-disable-line react-hooks/exhaustive-deps
  const latestRef = useRef<string>(value);
  const [isDark, setIsDark] = useState(
    () => !document.documentElement.classList.contains('light'),
  );

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(!document.documentElement.classList.contains('light'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="whiteboard-wrap">
      <Suspense fallback={<div className="canvas-empty-large">Loading whiteboard…</div>}>
        <Excalidraw
          initialData={{
            elements: initial.elements as never,
            appState: { viewBackgroundColor: isDark ? '#15151b' : '#ffffff', ...initial.appState } as never,
            files: initial.files as never,
          }}
          theme={isDark ? 'dark' : 'light'}
          viewModeEnabled={!!readOnly}
          onChange={(elements, appState, files) => {
            if (readOnly) return;
            // Strip noisy/unstable appState keys that bloat saves without value.
            const full = appState as unknown as Record<string, unknown>;
            const { collaborators: _c, ...stableAppState } = full ?? {};
            void _c;
            const next = JSON.stringify({
              elements,
              appState: stableAppState,
              files,
            });
            if (next === latestRef.current) return;
            latestRef.current = next;
            onChange(next);
          }}
        />
      </Suspense>
    </div>
  );
}
