import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ShieldCheck,
  Star,
  BadgeCheck,
  Wallet,
  Store,
  Truck,
  Undo2,
  Clock,
  HelpCircle,
  Banknote,
  Users,
} from 'lucide-react';

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

const BUYER_STATES: Array<[string, string]> = [
  ['Pendiente', 'Pediste, pero aún no pagas. Puedes pagar protegido o por Nequi directo.'],
  ['Retenido 🛡️', 'Pagaste y tu plata está guardada. La tienda no la puede tocar todavía.'],
  ['Liberado 🛡️', 'Recibiste (o pasaron 48h). La plata ya es de la tienda y entra a su próximo Nequi semanal.'],
  ['Confirmado', 'La tienda aceptó tu pedido y lo está preparando.'],
  ['Devuelto', 'Algo salió mal y te devolvimos la plata a tu Nequi.'],
  ['Cancelado', 'El pedido se canceló antes de cobrarse. No se movió plata.'],
];

const SELLER_STATES: Array<[string, string]> = [
  ['Retenido', 'Cobrado y guardado. Se libera solo a las 48h o con tu botón Liberar.'],
  ['Liberado', 'Listo para tu Nequi del lunes. Lo ves sumando en Finanzas → Por cobrar.'],
  ['Pagado', 'Ya te hicimos el Nequi. Aparece en tu historial.'],
  ['Devuelto', 'Se devolvió a la compradora. No te descuenta nada.'],
];

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
        <p className="text-surface-500 mt-1 mb-5">
          Compra y vende con confianza: aquí está, sin letra pequeña, qué pasa con tu plata y tus pedidos.
        </p>

        <div className="flex flex-wrap gap-2 mb-8">
          <a href="#compradoras" className="px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold hover:bg-emerald-200 transition-colors">
            Quiero comprar 🛡️
          </a>
          <a href="#tenderas" className="px-4 py-2 rounded-full bg-brand-100 text-brand-700 text-sm font-bold hover:bg-brand-200 transition-colors">
            Quiero vender 🏪
          </a>
          <a href="#preguntas" className="px-4 py-2 rounded-full bg-surface-100 text-surface-700 text-sm font-bold hover:bg-surface-200 transition-colors">
            Preguntas ❓
          </a>
        </div>

        {/* ── Compradoras ── */}
        <div className="card p-6 md:p-8 mb-5" id="compradoras">
          <h2 className="font-display text-xl font-bold text-surface-900 flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Si vas a comprar
          </h2>
          <p className="text-sm text-surface-500 mb-5">
            Tienes dos formas de pagar. Las dos son válidas, tú eliges por pedido.
          </p>

          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 mb-5 text-sm">
            <p className="font-extrabold text-emerald-800 mb-1">🛡️ Pago protegido (recomendado con tiendas nuevas)</p>
            <p className="text-emerald-700 leading-relaxed">
              Pagas un <strong>2.5% extra</strong> y tu plata queda retenida hasta que recibas
              (máximo 48 horas). Si no recibes o algo sale mal, <strong>te devolvemos todo</strong>.
            </p>
          </div>
          <div className="rounded-2xl bg-surface-50 border border-surface-200 p-4 mb-6 text-sm">
            <p className="font-extrabold text-surface-800 mb-1">💬 Nequi directo ($0 comisión)</p>
            <p className="text-surface-600 leading-relaxed">
              Pagas a la tienda por su Nequi como siempre. Más barato, pero sin retención ni devolución automática.
              Úsalo con tiendas que ya conoces.
            </p>
          </div>

          <h3 className="font-bold text-surface-900 mb-3" id="pago-protegido">Paso a paso del pago protegido</h3>
          <div className="space-y-4">
            <Step n={1} title="Pides por el chat" text="Hablas con la tienda, confirmas tu pedido y tocas Pagar protegido. Pones tu número Nequi y apruebas la notificación que te llega." />
            <Step n={2} title="Tu plata queda retenida" text="La cobramos y la guardamos aparte. La tienda ve tu pedido marcado con 🛡️ pero no puede tocar la plata todavía." />
            <Step n={3} title="Recibes tu pedido" text="La tienda lo prepara y te lo entrega como coordinen por el chat. Tienes hasta 48 horas." />
            <Step n={4} title="Liberamos el pago" text="Al recibir (o cumplidas las 48h), soltamos la plata a la tendera y entra a su Nequi semanal." />
          </div>

          <h3 className="font-bold text-surface-900 mt-6 mb-3">Qué significa cada estado de tu compra</h3>
          <div className="space-y-2">
            {BUYER_STATES.map(([label, text]) => (
              <div key={label} className="flex gap-2.5 text-sm rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
                <span className="font-extrabold text-surface-900 whitespace-nowrap">{label}</span>
                <span className="text-surface-600">{text}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl bg-surface-50 border border-surface-200 p-4 text-sm text-surface-600 space-y-2">
            <p className="flex items-start gap-2"><Star className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" /> <span><strong>Reseñas con foto:</strong> las dejan compradoras reales después de recibir. Míralas y deja la tuya: es lo que más ayuda a la siguiente.</span></p>
            <p className="flex items-start gap-2"><BadgeCheck className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" /> <span><strong>Tienda verificada:</strong> ganó su check con ventas reales y prestigio. No se compra ni se regala.</span></p>
            <p className="flex items-start gap-2"><Undo2 className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" /> <span><strong>¿Y si no llega?</strong> Repórtalo por el chat de la compra y te devolvemos lo retenido a tu Nequi.</span></p>
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
            <Step n={1} title="Crea tu tienda gratis" text="Publica productos con foto y precio, u ofrece servicios con agenda. Empiezas en plan Gratis, sin tarjeta." />
            <Step n={2} title="Prueba PRO 14 días" text="Con un producto publicado activas la prueba: la IA atiende tu chat, agenda citas y anota pedidos sola." />
            <Step n={3} title="Recibe pedidos" text="Te llegan al panel y te avisamos con notificación. Los confirmas y el stock se descuenta solo." />
            <Step n={4} title="Cobra cada semana" text="Los pagos protegidos se liberan a las 48h y cada lunes te hacemos un Nequi con el total. Lo ves todo en Finanzas: por cobrar, pagado e historial." />
          </div>

          <h3 className="font-bold text-surface-900 mt-6 mb-3">Cuánto cuesta (sin sorpresas)</h3>
          <div className="space-y-2 text-sm">
            <div className="flex gap-2.5 rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
              <Wallet className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" />
              <span className="text-surface-600"><strong className="text-surface-900">Arriendo mensual fijo</strong> según tu plan (Gratis, PRO o Business). Las ventas por Nequi directo no pagan comisión.</span>
            </div>
            <div className="flex gap-2.5 rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
              <Banknote className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
              <span className="text-surface-600"><strong className="text-surface-900">Pago protegido: 2.5% tú + 2.5% la compradora.</strong> Ejemplo: pedido de $100.000 → recibes $97.500. Solo cuando la clienta elige esa opción.</span>
            </div>
            <div className="flex gap-2.5 rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
              <Truck className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" />
              <span className="text-surface-600"><strong className="text-surface-900">La entrega la coordinas tú</strong> con tu clienta por el chat, como siempre. CiCi no se mete en el domicilio.</span>
            </div>
            <div className="flex gap-2.5 rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
              <Users className="w-4 h-4 mt-0.5 text-brand-500 shrink-0" />
              <span className="text-surface-600"><strong className="text-surface-900">¿Tienes quien te ayude?</strong> Genera un código en Dashboard → Equipo y pásalo por WhatsApp: tu colaboradora opera pedidos, productos y agenda desde su cuenta. Los planes y la plata los manejas solo tú, y la puedes quitar o revocar el código cuando quieras.</span>
            </div>
          </div>

          <h3 className="font-bold text-surface-900 mt-6 mb-3">Estados de tus pagos</h3>
          <div className="space-y-2">
            {SELLER_STATES.map(([label, text]) => (
              <div key={label} className="flex gap-2.5 text-sm rounded-xl bg-surface-50 border border-surface-100 px-3 py-2.5">
                <span className="font-extrabold text-surface-900 whitespace-nowrap">{label}</span>
                <span className="text-surface-600">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── FAQ ── */}
        <div className="mb-5" id="preguntas">
          <h2 className="font-display text-xl font-bold text-surface-900 mb-3">Preguntas frecuentes</h2>
          <div className="space-y-2.5">
            <Faq q="¿CiCi se queda con parte de mis ventas?" a="Solo en el pago protegido: 2.5% + 2.5%. Todo lo que vendas por Nequi directo, WhatsApp o efectivo es 100% tuyo, siempre y en todos los planes." />
            <Faq q="¿Cuándo recibo la plata de un pago protegido?" a="Se libera a las 48 horas de cobrado (o antes si lo liberas tú) y entra al Nequi semanal de cada lunes. Lo ves sumando en Finanzas → Por cobrar." />
            <Faq q="¿Qué pasa si la clienta dice que no le llegó?" a="Si el pago estaba retenido, se le devuelve a ella y queda registrado como Devuelto. Si ya estaba liberado, se revisa el caso por el chat con las pruebas de entrega." />
            <Faq q="¿Puedo cancelar un pago protegido?" a="Sí, mientras no esté pagado. La compradora recupera su plata y el pedido queda como devuelto o cancelado." />
            <Faq q="¿Hay tope de monto?" a="Sí, en esta primera etapa cubrimos pedidos de hasta $300.000 para aprender con riesgo acotado." />
            <Faq q="¿Mis datos y mi plata están seguros?" a="Los pagos pasan por pasarelas reguladas (Wompi/Mercado Pago), nunca guardamos claves ni números de Nequi, y cada movimiento queda registrado con su estado." />
            <Faq q="¿Qué NO cubre el pago protegido?" a="No cubre acuerdos por fuera del pedido (otros productos, envíos aparte), ni compras en tiendas suspendidas. Cubre exactamente lo del pedido pagado por la app." />
          </div>
        </div>

        <div className="text-center flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/register" className="btn-primary inline-flex">
            Crear mi cuenta gratis
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs text-surface-400">
            <Clock className="w-3.5 h-3.5" />
            Leer esto toma 3 minutos y ahorra malentendidos
          </span>
        </div>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="rounded-2xl border border-surface-200 bg-white overflow-hidden group">
      <summary className="flex items-center gap-2.5 p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-surface-50/60 transition-colors">
        <HelpCircle className="w-5 h-5 text-brand-600 shrink-0" />
        <span className="flex-1 text-sm font-bold text-surface-900">{q}</span>
      </summary>
      <p className="px-4 pb-4 text-sm text-surface-600 leading-relaxed">{a}</p>
    </details>
  );
}
