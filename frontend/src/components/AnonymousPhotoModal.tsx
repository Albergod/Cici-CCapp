import { useEffect, useRef, useState } from 'react';
import { Loader2, Wand2, Scissors, Eraser, X, Check, RotateCcw, ImagePlus, AlertTriangle } from 'lucide-react';

// Foto anónima y limpia: herramienta 100% local (sin servidor ni APIs de pago).
// 1. "Quitar fondo": quita el fondo por proximidad de color desde los bordes
//    (flood fill). Funciona mejor con fondos lisos y la prenda centrada.
// 2. "Recorte anónimo": recorta desde arriba para que no salga la cara.
// Todo se procesa en el navegador del comerciante.

type Props = {
  open: boolean;
  onClose: () => void;
  onApply: (blob: Blob) => Promise<void> | void;
};

const PRESETS = [
  { label: 'Sin rostro', pct: 24 },
  { label: 'Hasta cintura', pct: 42 },
  { label: 'Hasta rodillas', pct: 58 },
];

const MAX_WIDTH = 1000;

function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const s = 12;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e5e7eb';
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      if (((x / s) + (y / s)) % 2 === 0) ctx.fillRect(x, y, s, s);
    }
  }
}

// Quita el fondo por similitud de color con el borde de la imagen + flood fill.
function removeBackgroundHeuristic(src: HTMLCanvasElement): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, sw, sh);
  const px = image.data;

  // Paleta de colores del borde (los más frecuentes).
  const freq = new Map<string, { c: number[]; n: number }>();
  const per = (x: number, y: number) => {
    const i = (y * sw + x) * 4;
    const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
    const e = freq.get(key) ?? { c: [px[i], px[i + 1], px[i + 2]], n: 0 };
    e.n += 1;
    freq.set(key, e);
  };
  for (let x = 0; x < sw; x += 2) {
    per(x, 0);
    per(x, sh - 1);
  }
  for (let y = 1; y < sh - 1; y += 2) {
    per(0, y);
    per(sw - 1, y);
  }
  const palette = [...freq.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 12)
    .map((e) => e.c);
  if (palette.length === 0) return out;

  const dist = (a: number[], b: number[]) =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

  const isBg = (i: number) => {
    const idx = i * 4;
    const r = px[idx];
    const g = px[idx + 1];
    const b = px[idx + 2];
    let best = Infinity;
    for (const p of palette) {
      const d = dist(p, [r, g, b]);
      if (d < best) best = d;
    }
    return best < 34;
  };

  // Flood fill desde los bordes: solo se elimina lo conectado al borde con
  // color parecido al fondo (así el objeto central se conserva).
  const visited = new Uint8Array(sw * sh);
  const stack: number[] = [];
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (x === 0 || y === 0 || x === sw - 1 || y === sh - 1) {
        const i = y * sw + x;
        if (!visited[i]) {
          visited[i] = 1;
          stack.push(i);
        }
      }
    }
  }
  const push = (i: number) => {
    if (!visited[i]) {
      visited[i] = 1;
      stack.push(i);
    }
  };
  while (stack.length) {
    const i = stack.pop()!;
    if (!isBg(i)) continue;
    px[i * 4 + 3] = 0;
    const x = i % sw;
    const y = (i / sw) | 0;
    if (x > 0) push(i - 1);
    if (x < sw - 1) push(i + 1);
    if (y > 0) push(i - sw);
    if (y < sh - 1) push(i + sw);
  }

  // Suaviza el borde del alfa (evita el "serrucho").
  const alpha = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) alpha[i] = px[i * 4 + 3];
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= sh) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= sw) continue;
            sum += alpha[yy * sw + xx];
            cnt++;
          }
        }
        tmp[y * sw + x] = cnt ? sum / cnt : 0;
      }
    }
    alpha.set(tmp);
  }
  for (let i = 0; i < sw * sh; i++) px[i * 4 + 3] = Math.round(alpha[i]);

  ctx.putImageData(image, 0, 0);
  return out;
}

function renderOutput(
  base: HTMLCanvasElement,
  topCropPct: number,
  bgRemoved: boolean,
  fillWhite: boolean
): Promise<Blob> {
  const bw = base.width;
  const bh = base.height;
  const cropY = Math.round((bh * topCropPct) / 100);
  const outH = bh - cropY;
  const out = document.createElement('canvas');
  out.width = bw;
  out.height = outH;
  const octx = out.getContext('2d')!;
  if (fillWhite) {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, bw, outH);
  }
  octx.drawImage(base, 0, cropY, bw, outH, 0, 0, bw, outH);
  const mime = bgRemoved && !fillWhite ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), mime, 0.92)
  );
}

export function AnonymousPhotoModal({ open, onClose, onApply }: Props) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null);
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [bgRemoved, setBgRemoved] = useState(false);
  const [removingBg, setRemovingBg] = useState(false);
  const [topCropPct, setTopCropPct] = useState(0);
  const [fillWhite, setFillWhite] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef(false);
  const sourceUrlRef = useRef<string | null>(null);

  function revokeSourceUrl() {
    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }
  }

  useEffect(() => revokeSourceUrl, []);

  // Redibuja la vista previa según el estado actual.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !base) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const bw = base.width;
    const bh = base.height;
    const cropY = Math.round((bh * topCropPct) / 100);
    const scale = Math.min(cv.width / bw, cv.height / (bh - cropY));
    const dw = bw * scale;
    const dh = (bh - cropY) * scale;
    const dx = (cv.width - dw) / 2;
    const dy = (cv.height - dh) / 2;
    if (bgRemoved) {
      drawChecker(ctx, cv.width, cv.height);
    } else {
      ctx.fillStyle = '#f5f5f4';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    ctx.drawImage(base, 0, cropY, bw, bh - cropY, dx, dy, dw, dh);
    if (topCropPct > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, cv.width, Math.max(0, dy));
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(0, Math.max(0, dy) - 1.5, cv.width, 3);
    }
  }, [base, topCropPct, bgRemoved]);

  const loadFile = (f: File) => {
    setError(null);
    setSourceFile(f);
    setBgRemoved(false);
    setTopCropPct(0);
    revokeSourceUrl();
    const url = URL.createObjectURL(f);
    sourceUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_WIDTH / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolveUrl(url);
      setOriginal(c);
      setBase(c);
    };
    img.onerror = () => {
      resolveUrl(url);
      setError('No se pudo leer la imagen. Prueba con un archivo jpg, png o webp.');
    };
    img.src = url;
  };

  function resolveUrl(url: string) {
    if (sourceUrlRef.current === url) {
      URL.revokeObjectURL(url);
      sourceUrlRef.current = null;
    }
  };

  const handleRemoveBg = async () => {
    if (!base) return;
    setRemovingBg(true);
    setError(null);
    try {
      const out = removeBackgroundHeuristic(base);
      setBase(out);
      setBgRemoved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error quitando el fondo');
    } finally {
      setRemovingBg(false);
    }
  };

  const handleApply = async () => {
    if (!base) return;
    setApplying(true);
    setError(null);
    try {
      const blob = await renderOutput(base, topCropPct, bgRemoved, fillWhite);
      await onApply(blob);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al aplicar la foto');
      setApplying(false);
    }
  };

  const handleClose = () => {
    revokeSourceUrl();
    setSourceFile(null);
    setOriginal(null);
    setBase(null);
    setBgRemoved(false);
    setTopCropPct(0);
    setError(null);
    onClose();
  };

  const updateFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv || !base) return;
    const rect = cv.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const bw = base.width;
    const bh = base.height;
    const cropY0 = Math.round((bh * topCropPct) / 100);
    const scale = Math.min(cv.width / bw, cv.height / (bh - cropY0));
    const dh = (bh - cropY0) * scale;
    const dy = (cv.height - dh) / 2;
    const sourceY = (y - dy) / scale + cropY0;
    setTopCropPct(Math.min(70, Math.max(0, Math.round((sourceY / bh) * 100))));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <h3 className="font-bold text-surface-900 flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-brand-500" />
            Foto anónima en limpio
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-600 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 grid gap-5 md:grid-cols-2">
          <div>
            {!sourceFile ? (
              <label className="flex flex-col items-center justify-center gap-2 h-[420px] w-full rounded-2xl border-2 border-dashed border-surface-300 text-surface-500 cursor-pointer hover:border-brand-400 hover:text-brand-500 transition-colors">
                <ImagePlus className="w-8 h-8" />
                <span className="text-sm font-bold">Sube la foto que quieres limpiar</span>
                <span className="text-xs text-surface-400">jpeg, png o webp · la foto no sale al servidor</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) loadFile(f);
                  }}
                />
              </label>
            ) : (
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  width={480}
                  height={560}
                  onPointerDown={(e) => {
                    dragRef.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updateFromEvent(e);
                  }}
                  onPointerMove={(e) => {
                    if (dragRef.current) updateFromEvent(e);
                  }}
                  onPointerUp={() => {
                    dragRef.current = false;
                  }}
                  className={`w-full h-[300px] sm:h-[420px] rounded-2xl border border-surface-200 bg-surface-50 ${topCropPct > 0 ? 'cursor-ns-resize' : ''}`}
                />
                {topCropPct > 0 && (
                  <p className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg bg-black/60 text-white text-[11px] font-semibold">
                    Arrastra la línea roja para ajustar el corte
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-red-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                {error}
              </p>
            )}
          </div>

          <div className="space-y-4">
            {!sourceFile ? (
              <p className="text-sm text-surface-500">
                Sube una foto de la prenda (plana o puesta). La herramienta procesa todo localmente, en tu
                navegador: sin servidores, sin costo y sin guardar nada de tus fotos.
              </p>
            ) : (
              <>
                <div>
                  <p className="text-sm font-bold text-surface-700 mb-2 flex items-center gap-1.5">
                    <Eraser className="w-4 h-4 text-brand-500" /> Quitar fondo
                  </p>
                  <button
                    type="button"
                    onClick={handleRemoveBg}
                    disabled={removingBg || !!bgRemoved}
                    className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                      bgRemoved
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'bg-brand-50 text-brand-700 border border-brand-200 hover:bg-brand-100'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {removingBg ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Procesando fondo...
                      </>
                    ) : bgRemoved ? (
                      <>
                        <Check className="w-4 h-4" /> Fondo eliminado
                      </>
                    ) : (
                      <>
                        <Eraser className="w-4 h-4" /> Quitar fondo (mejor con fondo liso)
                      </>
                    )}
                  </button>
                </div>

                <div>
                  <p className="text-sm font-bold text-surface-700 mb-2 flex items-center gap-1.5">
                    <Scissors className="w-4 h-4 text-brand-500" /> Recorte anónimo
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setTopCropPct(p.pct)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                          topCropPct === p.pct
                            ? 'bg-surface-900 text-white border-surface-900'
                            : 'bg-surface-50 text-surface-600 border-surface-200 hover:bg-surface-100'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={70}
                    value={topCropPct}
                    onChange={(e) => setTopCropPct(Number(e.target.value))}
                    className="w-full mt-3 accent-rose-500"
                  />
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[11px] text-surface-400">Nada recortado</span>
                    <span className="text-[11px] text-surface-400">Más recortado</span>
                  </div>
                </div>

                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span className="text-sm font-semibold text-surface-700">Fondo de la imagen final</span>
                  <select
                    value={fillWhite ? 'white' : 'transparent'}
                    onChange={(e) => setFillWhite(e.target.value === 'white')}
                    className="input !w-auto !py-1.5 !text-sm"
                  >
                    <option value="white">Blanco</option>
                    <option value="transparent">Transparente</option>
                  </select>
                </label>

                {(topCropPct > 0 || bgRemoved) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setBase(original);
                      setBgRemoved(false);
                      setTopCropPct(0);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-surface-500 border border-surface-200 hover:bg-surface-50 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reiniciar (volver a la foto original)
                  </button>
                ) : (
                  <div />
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-surface-100 bg-surface-50">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-surface-600 hover:bg-surface-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!base || applying}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin inline-block" /> Aplicando...
              </>
            ) : (
              'Usar esta foto'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}