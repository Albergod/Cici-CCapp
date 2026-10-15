import { useState } from 'react';
import { Share2, Link2, MessageCircle, Upload, Check, QrCode, Copy } from 'lucide-react';

export function ShareStoreCard({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement('input');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopiedText(text);
    setTimeout(() => setCopiedText((cur) => (cur === text ? null : cur)), 2000);
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(
    `Desde este enlace puedes ver todos mis productos: ${url}`
  )}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shrink-0">
          <Share2 className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="font-extrabold text-surface-900 leading-tight">
            Promociona tu tienda
          </h3>
          <p className="text-xs text-surface-500">
            Tu local ya se puede visitar. Tus clientes entran aquí para ver todos tus productos.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="input text-xs font-mono bg-surface-50 flex-1 min-w-0"
        />
        <button
          onClick={copyLink}
          className="btn-primary shrink-0"
          title="Copiar enlace"
        >
          {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 flex-1 px-3 py-2 text-xs font-bold rounded-xl bg-[#25D366] text-white hover:opacity-90 transition-opacity"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Enviar por WhatsApp
        </a>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 flex-1 px-3 py-2 text-xs font-bold rounded-xl bg-surface-900 text-white hover:bg-surface-800 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Abrir tienda
        </a>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-surface-200 bg-surface-50 p-3">
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(url)}`}
          alt={`QR de ${name}`}
          width={64}
          height={64}
          className="rounded-lg shrink-0"
        />
        <div className="text-xs text-surface-500 leading-snug">
          <QrCode className="w-4 h-4 text-brand-500 mb-1" />
          Imprime este QR y ponlo en tus productos, entregas o vitrina: al escanearlo, tus
          clientes caen directo a tu local.
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-extrabold text-surface-700 mb-2 flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5 text-[#25D366]" />
          Textos listos para tus estados
        </p>
        <div className="space-y-2">
          {[
            `🛍️ Ya tengo tienda en CiCi, mira todo aquí: ${url}`,
            `🛡️ En mi tienda puedes pagar PROTEGIDO: tu plata queda retenida hasta que recibas. Pide por aquí: ${url}`,
          ].map((text) => (
            <div key={text.slice(0, 20)} className="flex items-center gap-2 rounded-xl bg-surface-50 border border-surface-200 p-2.5">
              <p className="flex-1 text-xs text-surface-600 leading-snug line-clamp-2">{text}</p>
              <button
                onClick={() => copyText(text)}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-surface-200 text-xs font-bold text-surface-700 hover:border-brand-300"
                title="Copiar texto"
              >
                {copiedText === text ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedText === text ? '¡Listo!' : 'Copiar'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}