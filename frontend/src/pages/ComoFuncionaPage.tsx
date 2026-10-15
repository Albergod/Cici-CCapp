import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Star, BadgeCheck, Wallet, Store, Truck, Undo2 } from 'lucide-react';

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-brand-600 to-accent-500 text-white text-sm font-extrabold flex items-center justify-center">
        {n}
      </span>
      <div>
        <p className="font-bold text-surface-900">{title}</p>
        <p className="text-sm text-surface-600 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

export function ComoFuncionaPage() {
  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Link>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
          Cómo funciona CiCi
        </h1>
        <p className="text-surface-500 mt-1 mb-8">
          Compra y vende con confianza: esto es lo que pasa con tu plata y tus pedidos.
        </p>

        {/* ── Compradoras ── */}
        <div className="card p-6 md:p-8 mb-5" id="compradoras">
          <h2 className="font-display text-xl font-bold text-surface-900 flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Si vas a comprar
          </h2>
          <p className="text-sm text-surface-500 mb-5">El pago protegido cuida tu plata de principio a fin.</p>
          <div className="space-y-4" id="pago-protegido">
            <Step n={1} title="Pides por el chat" text="Hablas con la tienda, confirmas tu pedido y eliges Pagar protegido con tu Nequi." />
            <Step n={2} title="Tu plata queda retenida" text="La cobramos y la guardamos: la tienda no la toca todavía. Comisión total 5% (2.5% tú + 2.5% la tienda); por Nequi directo no hay comisión." />
            <Step n={3} title="Recibes tu pedido" text="La tienda lo prepara y te lo entrega. Tienes hasta 48 horas." />
            <Step n={4} title="Liberamos el pago" text="Al recibir (o a las 48h), soltamos la plata a la tendera. Si algo sale mal, se te devuelve." />
          </div>
          <div className="mt-5 rounded-2xl bg-surface-50 border border-surface-200 p-4 text-sm text-surface-600 space-y-2">
            <p className="flex items-start gap-2"><Star className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" /> <span><strong>Reseñas con foto:</strong> las dejan compradoras reales después de recibir. Míralas antes de pedir.</span></p>
            <p className="flex items-start gap-2"><BadgeCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" /> <span><strong>Tienda verificada:</strong> ganó su check con ventas reales y prestigio. No se compra ni se regala.</span></p>
            <p className="flex items-start gap-2"><Undo2 className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" /> <span><strong>¿Y si no llega?</strong> Reportas por el chat y te devolvemos la plata retenida.</span></p>
          </div>
        </div>

        {/* ── Tenderas ── */}
        <div className="card p-6 md:p-8 mb-5" id="tenderas">
          <h2 className="font-display text-xl font-bold text-surface-900 flex items-center gap-2 mb-1">
            <Store className="w-5 h-5 text-brand-600" />
            Si vas a vender
          </h2>
          <p className="text-sm text-surface-500 mb-5">Tu espacio, tus reglas, con respaldo.</p>
          <div className="space-y-4">
            <Step n={1} title="Crea tu tienda gratis" text="Publica productos con foto y precio, o servicios con agenda. Empiezas en plan Gratis." />
            <Step n={2} title="Prueba PRO 14 días" text="Con un producto publicado activas la prueba: la IA atiende tu chat, agenda citas y anota pedidos sola." />
            <Step n={3} title="Recibe pedidos" text="Te llegan al panel y por notificación. Los confirmas y el stock se descuenta solo." />
            <Step n={4} title="Cobra semanal" text="Los pagos protegidos se liberan a las 48h y cada semana te hacemos un Nequi con el total. Lo ves todo en Finanzas." />
          </div>
          <div className="mt-5 rounded-2xl bg-surface-50 border border-surface-200 p-4 text-sm text-surface-600 space-y-2">
            <p className="flex items-start gap-2"><Wallet className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" /> <span><strong>Costos claros:</strong> arriendo mensual fijo + 2.5% solo en pagos protegidos. Nequi directo: $0 comisión.</span></p>
            <p className="flex items-start gap-2"><Truck className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" /> <span><strong>La entrega la coordinas tú</strong> con tu clienta por el chat, como siempre.</span></p>
          </div>
        </div>

        <div className="text-center">
          <Link to="/register" className="btn-primary inline-flex">
            Crear mi cuenta gratis
          </Link>
        </div>
      </div>
    </div>
  );
}
