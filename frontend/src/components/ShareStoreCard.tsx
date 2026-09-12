import { useState } from 'react';
import { Share2, Link2, MessageCircle, Upload, Check, QrCode } from 'lucide-react';

export function ShareStoreCard({ url, name }: { url: string; name: string }) {
  const [copied, setCopied] = useState(false);

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
    </div>
  );
}