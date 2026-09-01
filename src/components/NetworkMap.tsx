'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapFeature } from './types';
import { cssVar, riskColor } from '@/lib/risk-color';
import { useTheme } from './useTheme';

/**
 * The network map, rendered directly to a canvas.
 *
 * This deliberately does not use a tiled map library. The whole network is
 * 1,793 line segments whose coordinates we already own, so a Web Mercator
 * projection and a draw loop cover it in a fraction of the code -- with no
 * external tile service, no parsing worker, no stylesheet fighting Tailwind
 * over the container's position, and no dependency on the viewport having
 * settled before the library measures itself. It renders offline and
 * identically every time, which matters when it has to work in front of an
 * audience.
 *
 * Segments are drawn in ascending risk order so a critical main is never
 * hidden beneath a healthy one it crosses.
 */

type Filter = { minRisk: number; material: string | null; zone: string | null; sensorOnly: boolean };

type Props = {
  features: MapFeature[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: Filter;
  focus: { lng: number; lat: number; zoom: number } | null;
};

const TILE = 256;

function mercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

function unmercator(x: number, y: number): [number, number] {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
}

const NEIGHBORHOODS: [string, number, number][] = [
  ['Downtown', 40.4406, -79.9959],
  ['Strip District', 40.4501, -79.9782],
  ['Lawrenceville', 40.4682, -79.9601],
  ['Oakland', 40.4416, -79.9553],
  ['Shadyside', 40.452, -79.9345],
  ['Squirrel Hill', 40.438, -79.922],
  ['Bloomfield', 40.462, -79.949],
  ['East Liberty', 40.4612, -79.9251],
  ['Highland Park', 40.4782, -79.9203],
  ['Hill District', 40.4452, -79.9762],
  ['North Side', 40.4533, -80.0081],
  ['South Side', 40.4283, -79.9751],
  ['Mount Washington', 40.4312, -80.0083],
  ['Point Breeze', 40.4451, -79.9062],
  ['Brookline', 40.3952, -80.0212],
];

export default function NetworkMap({ features, selectedId, onSelect, filter, focus }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [view, setView] = useState({ lng: -79.9709, lat: 40.4486, zoom: 12.6 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; lng: number; lat: number } | null>(null);
  const moved = useRef(false);
  // The canvas paints with literal colours, so it has to be told when the
  // theme changes; CSS custom properties alone cannot repaint a bitmap.
  const [theme] = useTheme();

  // Track container size. Falls back to a usable default rather than rendering
  // nothing when the element reports zero -- a collapsed measurement should
  // degrade to a visible map, not a blank panel.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(320, Math.round(r.width) || 1000),
        h: Math.max(240, Math.round(r.height) || 700),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    if (focus) setView({ lng: focus.lng, lat: focus.lat, zoom: focus.zoom });
  }, [focus]);

  const visible = useMemo(
    () =>
      features.filter(
        (f) =>
          f.risk >= filter.minRisk &&
          (!filter.material || f.mt === filter.material) &&
          (!filter.zone || f.zn === filter.zone) &&
          (!filter.sensorOnly || f.sen === 1),
      ),
    [features, filter],
  );

  const project = useCallback(
    (lng: number, lat: number): [number, number] => {
      const scale = TILE * 2 ** view.zoom;
      const [cx, cy] = mercator(view.lng, view.lat);
      const [px, py] = mercator(lng, lat);
      return [(px - cx) * scale + size.w / 2, (py - cy) * scale + size.h / 2];
    },
    [view, size],
  );

  const unproject = useCallback(
    (x: number, y: number): [number, number] => {
      const scale = TILE * 2 ** view.zoom;
      const [cx, cy] = mercator(view.lng, view.lat);
      return unmercator((x - size.w / 2) / scale + cx, (y - size.h / 2) / scale + cy);
    },
    [view, size],
  );

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.fillStyle = cssVar('--c-map-bg');
    g.fillRect(0, 0, size.w, size.h);

    // Faint graticule for spatial reference.
    const step = view.zoom > 14 ? 0.005 : view.zoom > 12.5 ? 0.01 : 0.02;
    g.strokeStyle = cssVar('--c-map-grid');
    g.lineWidth = 1;
    const [wLng, nLat] = unproject(0, 0);
    const [eLng, sLat] = unproject(size.w, size.h);
    for (let lng = Math.floor(wLng / step) * step; lng <= eLng; lng += step) {
      const [x] = project(lng, nLat);
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, size.h);
      g.stroke();
    }
    for (let lat = Math.floor(sLat / step) * step; lat <= nLat; lat += step) {
      const [, y] = project(wLng, lat);
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(size.w, Math.round(y) + 0.5);
      g.stroke();
    }

    const widthFor = (dia: number) =>
      Math.max(0.9, (0.75 + (dia / 36) * 2.8) * Math.max(0.42, 2 ** (view.zoom - 13.2)));

    const ordered = [...visible].sort((a, b) => a.risk - b.risk);
    const onScreen: [MapFeature, number, number, number, number][] = [];
    for (const f of ordered) {
      const [x1, y1] = project(f.p[0][0], f.p[0][1]);
      const [x2, y2] = project(f.p[1][0], f.p[1][1]);
      if (Math.max(x1, x2) < -60 || Math.min(x1, x2) > size.w + 60) continue;
      if (Math.max(y1, y2) < -60 || Math.min(y1, y2) > size.h + 60) continue;
      onScreen.push([f, x1, y1, x2, y2]);
    }

    g.lineCap = 'round';

    // Glow beneath elevated segments so they read at low zoom.
    for (const [f, x1, y1, x2, y2] of onScreen) {
      if (f.risk < 55) continue;
      g.strokeStyle = riskColor(f.risk);
      g.globalAlpha = theme === 'dark' ? 0.15 : 0.1;
      g.lineWidth = widthFor(f.dia) * 5.5;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.globalAlpha = 1;

    for (const [f, x1, y1, x2, y2] of onScreen) {
      g.strokeStyle = riskColor(f.risk);
      g.globalAlpha = f.id === hover ? 1 : 0.88;
      g.lineWidth = widthFor(f.dia);
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Recorded breaks.
    const r = Math.max(2.2, 1.6 * 2 ** (view.zoom - 13.4));
    for (const [f, x1, y1, x2, y2] of onScreen) {
      if (!f.brk) continue;
      g.beginPath();
      g.arc((x1 + x2) / 2, (y1 + y2) / 2, r, 0, Math.PI * 2);
      g.fillStyle = cssVar('--c-map-bg');
      g.fill();
      g.strokeStyle = cssVar('--c-break-ring');
      g.lineWidth = 1.3;
      g.stroke();
    }

    const sel = onScreen.find(([f]) => f.id === selectedId);
    if (sel) {
      const [f, x1, y1, x2, y2] = sel;
      g.strokeStyle = cssVar('--c-map-select');
      g.lineWidth = widthFor(f.dia) + 4;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.strokeStyle = riskColor(f.risk);
      g.lineWidth = widthFor(f.dia) + 1.2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }

    g.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = cssVar('--c-map-label');
    for (const [name, lat, lng] of NEIGHBORHOODS) {
      const [x, y] = project(lng, lat);
      if (x < 45 || x > size.w - 45 || y < 18 || y > size.h - 18) continue;
      g.fillText(name.toUpperCase(), x, y);
    }
  }, [visible, size, view, selectedId, hover, project, unproject, theme]);

  const pick = useCallback(
    (mx: number, my: number): string | null => {
      let best: string | null = null;
      let bestD = 9;
      for (const f of visible) {
        const [x1, y1] = project(f.p[0][0], f.p[0][1]);
        const [x2, y2] = project(f.p[1][0], f.p[1][1]);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / len2)) : 0;
        const d = Math.hypot(mx - (x1 + t * dx), my - (y1 + t * dy));
        if (d < bestD) {
          bestD = d;
          best = f.id;
        }
      }
      return best;
    },
    [visible, project],
  );

  const relative = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const hovered = hover ? visible.find((f) => f.id === hover) : null;

  return (
    <div ref={wrap} className="h-full w-full overflow-hidden">
      <canvas
        ref={canvas}
        className="block cursor-crosshair select-none"
        onMouseDown={(e) => {
          const [x, y] = relative(e);
          drag.current = { x, y, lng: view.lng, lat: view.lat };
          moved.current = false;
        }}
        onMouseMove={(e) => {
          const [x, y] = relative(e);
          if (drag.current) {
            const dx = x - drag.current.x;
            const dy = y - drag.current.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
            const scale = TILE * 2 ** view.zoom;
            const [cx, cy] = mercator(drag.current.lng, drag.current.lat);
            const [lng, lat] = unmercator(cx - dx / scale, cy - dy / scale);
            setView((v) => ({ ...v, lng, lat }));
          } else {
            setHover(pick(x, y));
          }
        }}
        onMouseUp={(e) => {
          const wasDrag = moved.current;
          drag.current = null;
          if (wasDrag) return;
          const [x, y] = relative(e);
          onSelect(pick(x, y));
        }}
        onMouseLeave={() => {
          drag.current = null;
          setHover(null);
        }}
        onWheel={(e) => {
          const [x, y] = relative(e);
          const [lngAt, latAt] = unproject(x, y);
          const zoom = Math.max(10.5, Math.min(17, view.zoom - e.deltaY * 0.0022));
          // Keep the point under the cursor pinned while zooming.
          const scale = TILE * 2 ** zoom;
          const [bx, by] = mercator(lngAt, latAt);
          const [lng, lat] = unmercator(bx - (x - size.w / 2) / scale, by - (y - size.h / 2) / scale);
          setView({ lng, lat, zoom });
        }}
      />

      <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-line bg-surface/85 px-2 py-1 text-[10px] nums text-ink-faint backdrop-blur">
        z{view.zoom.toFixed(1)} · {visible.length.toLocaleString()} shown
      </div>

      {hovered && (
        <div className="pointer-events-none absolute left-3 top-3 max-w-[270px] rounded-md border border-line bg-surface/95 px-2.5 py-2 backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-medium">{hovered.id}</span>
            <span className="text-[11px] nums" style={{ color: riskColor(hovered.risk) }}>
              {hovered.risk.toFixed(0)}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-ink-dim">
            {hovered.st} · {hovered.nb}
          </div>
          <div className="text-[10px] text-ink-faint">
            {hovered.dia}&quot; {hovered.mt.replace(/_/g, ' ')} · {hovered.yr}
            {hovered.sen ? '' : ' · no sensor'}
          </div>
          {hovered.top && <div className="mt-1 text-[10px] text-ink-dim">{hovered.top}</div>}
        </div>
      )}
    </div>
  );
}
