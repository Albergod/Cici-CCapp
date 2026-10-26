import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  Layers,
  LineChart,
  Link2,
  Loader2,
  LockKeyhole,
  Mail,
  Network,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { api } from '@/services/api';

const EMPTY_FORM = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  storeCount: '',
  website: '',
  message: '',
};

const AUDIENCES = [
  {
    icon: Building2,
    title: 'Empresas con varias marcas',
    text: 'Cada marca mantiene su identidad y su tienda, pero la dirección ve el negocio completo.',
  },
  {
    icon: Store,
    title: 'Grupos de tiendas',
    text: 'Locales, sucursales o puntos de venta que hoy se administran por separado.',
  },
  {
    icon: Network,
    title: 'Franquicias y distribuidores',
    text: 'Una red de comercios con equipos locales y una cabeza que necesita visión global.',
  },
  {
    icon: Users,
    title: 'Negocios familiares',
    text: 'Varias unidades con responsables distintos y decisiones que deben verse en conjunto.',
  },
];

const PROBLEMS = [
  {
    title: 'Información dispersa',
    text: 'Cada tienda vive en su propio panel. Para entender la empresa toca sumar cifras a mano.',
  },
  {
    title: 'Permisos sin orden',
    text: 'Todos terminan con acceso a todo, o la dueña central se vuelve el cuello de botella.',
  },
  {
    title: 'Crecer desordena',
    text: 'Abrir otra marca o local no debería significar otro sistema, otra cuenta y otra operación.',
  },
];

const STEPS = [
  {
    icon: Building2,
    title: 'Crea tu espacio empresarial',
    text: 'Un lugar para tu organización: nombre, equipo y tiendas. Sin mover tus comercios de Cici.',
  },
  {
    icon: Link2,
    title: 'Vincula tiendas existentes',
    text: 'Solo con autorización de alguien con permisos suficientes sobre cada tienda. Nadie apropia comercios ajenos.',
  },
  {
    icon: Users,
    title: 'Asigna equipos y roles',
    text: 'Define quién administra la empresa, quién opera cada tienda y quién solo consulta reportes.',
  },
  {
    icon: BarChart3,
    title: 'Dirige con una sola visión',
    text: 'Consulta el consolidado y entra al detalle de cada tienda sin perder su independencia operativa.',
  },
];

const BENEFITS = [
  {
    icon: Layers,
    title: 'Una organización, varias tiendas',
    text: 'Agrupa marcas y locales bajo una misma estructura empresarial.',
  },
  {
    icon: ShieldCheck,
    title: 'Independencia operativa',
    text: 'Cada tienda conserva su catálogo, sus clientes y su día a día.',
  },
  {
    icon: LockKeyhole,
    title: 'Permisos por responsabilidad',
    text: 'Roles de empresa y de tienda separados, con accesos claros.',
  },
  {
    icon: LineChart,
    title: 'Visión consolidada',
    text: 'Reportes de la organización sin pedir planillas a cada local.',
  },
  {
    icon: Users,
    title: 'Equipos delegados',
    text: 'La dirección deja de ser el único punto de decisión.',
  },
  {
    icon: Boxes,
    title: 'Crecimiento ordenado',
    text: 'Sumar una tienda o una marca no obliga a reinventar la administración.',
  },
];

const GUARANTEES = [
  'Tu tienda sigue siendo tuya: no cambiamos su cuenta ni su funcionamiento.',
  'Vincular un comercio exige autorización de quien puede decidir sobre él.',
  'Los equipos de cada tienda mantienen sus propias responsabilidades.',
  'La empresa ve el conjunto; no se apropia de la operación de cada marca.',
];

export function EmpresariosPage() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Cici Empresarios · Todos tus negocios, una sola visión';
    return () => {
      document.title = previous;
    };
  }, []);

  const update = (field: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSending(true);
    try {
      const response = await api.empresarios.createLead({
        companyName: form.companyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        storeCount: form.storeCount ? Number(form.storeCount) : undefined,
        website: form.website.trim() || undefined,
        message: form.message.trim() || undefined,
      });
      setSuccess(response.message);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos enviar la solicitud. Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a Cici
        </Link>

        <section className="relative overflow-hidden rounded-[2rem] bg-surface-900 text-white shadow-lift">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 15% 20%, rgba(168,85,247,0.35), transparent 35%), radial-gradient(circle at 85% 10%, rgba(244,63,94,0.28), transparent 30%), radial-gradient(circle at 70% 90%, rgba(99,102,241,0.2), transparent 35%)',
            }}
          />
          <div className="relative grid lg:grid-cols-[1.1fr_0.9fr] gap-10 p-7 md:p-12 lg:p-14">
            <div className="flex flex-col justify-center">
              <span className="inline-flex items-center gap-2 w-fit px-3 py-1.5 rounded-full bg-white/10 border border-white/15 text-[11px] md:text-xs font-bold tracking-wide uppercase backdrop-blur-sm">
                <Sparkles className="w-3.5 h-3.5 text-accent-300" />
                Cici Empresarios · Acceso anticipado
              </span>

              <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight leading-[1.02] mt-5">
                Todos tus negocios.
                <span className="block bg-gradient-to-r from-brand-300 via-fuchsia-300 to-accent-300 bg-clip-text text-transparent">
                  Una sola visión.
                </span>
              </h1>

              <p className="text-white/80 text-base md:text-lg leading-relaxed max-w-xl mt-5">
                El control de tu empresa, sin perder la independencia de cada tienda.
                Administra diferentes marcas, tiendas y equipos desde un único espacio empresarial.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mt-7">
                <a
                  href="#acceso"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-white text-surface-900 font-bold shadow-lift hover:bg-white/90 transition-colors"
                >
                  Solicitar acceso anticipado
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="#como-funciona"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white font-semibold hover:bg-white/15 transition-colors"
                >
                  Ver cómo funciona
                </a>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-7 text-xs md:text-sm text-white/70">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  Varias tiendas
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  Equipos independientes
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  Una visión global
                </span>
              </div>
            </div>

            <div className="rounded-3xl bg-white/10 border border-white/15 backdrop-blur-md p-5 md:p-6 self-center w-full max-w-md lg:ml-auto">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/50 font-bold">
                    Una organización
                  </p>
                  <p className="font-display text-xl font-bold mt-1">Tu empresa</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-400/15 text-emerald-200 text-[11px] font-bold border border-emerald-300/20">
                  Consolidado
                </span>
              </div>

              <div className="space-y-2.5 mt-5">
                {[
                  { name: 'Marca Norte', meta: 'Tienda · 3 personas', color: 'from-brand-400 to-fuchsia-500' },
                  { name: 'Casa Sur', meta: 'Tienda · 2 personas', color: 'from-accent-400 to-orange-500' },
                  { name: 'Estudio Centro', meta: 'Tienda · 3 personas', color: 'from-sky-400 to-indigo-500' },
                ].map((store) => (
                  <div
                    key={store.name}
                    className="flex items-center gap-3 rounded-2xl bg-white/[0.07] border border-white/10 p-3"
                  >
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${store.color} flex items-center justify-center shrink-0`}>
                      <Store className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">{store.name}</p>
                      <p className="text-[11px] text-white/55">{store.meta}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-300 shrink-0" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-white/10 text-center">
                <div>
                  <p className="font-display text-2xl font-bold">3</p>
                  <p className="text-[10px] text-white/50 uppercase tracking-wide">Tiendas</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-bold">8</p>
                  <p className="text-[10px] text-white/50 uppercase tracking-wide">Personas</p>
                </div>
                <div>
                  <p className="font-display text-2xl font-bold">1</p>
                  <p className="text-[10px] text-white/50 uppercase tracking-wide">Visión</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-start gap-2.5 rounded-2xl bg-white border border-surface-200/70 px-4 py-3.5 mt-5 shadow-soft">
          <LockKeyhole className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
          <p className="text-xs md:text-sm text-surface-600">
            <strong className="text-surface-900">Tus tiendas siguen siendo tuyas.</strong>{' '}
            Empresarios es una capa de organización sobre los comercios que ya existen en Cici.
          </p>
        </div>

        <section className="py-14 md:py-20">
          <div className="grid md:grid-cols-[0.8fr_1.2fr] gap-8 items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">Qué es</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
                No es otro sistema de tiendas.
              </h2>
            </div>
            <div className="space-y-4 text-surface-600 leading-relaxed">
              <p>
                Es la capa que conecta y organiza las tiendas que ya existen dentro de Cici. Cada
                marca conserva su identidad, su catálogo y su operación; la empresa gana una
                estructura común para administrarlas.
              </p>
              <p className="text-surface-900 font-semibold">
                Varias tiendas, una organización. Equipos con responsabilidades independientes. Una
                visión global del negocio.
              </p>
            </div>
          </div>
        </section>

        <section className="pb-14 md:pb-20">
          <div className="flex items-end justify-between gap-4 mb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">Para quién</p>
              <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-2">
                Pensado para quien ya administra más de una operación.
              </h2>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {AUDIENCES.map((audience) => (
              <div key={audience.title} className="card p-5 hover:shadow-lift transition-shadow">
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                  <audience.icon className="w-5 h-5" />
                </div>
                <h3 className="font-display font-bold mt-4">{audience.title}</h3>
                <p className="text-sm text-surface-500 leading-relaxed mt-1.5">{audience.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-white border border-surface-200/70 p-7 md:p-10 shadow-soft mb-14 md:mb-20">
          <div className="grid lg:grid-cols-[0.7fr_1.3fr] gap-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent-600">El problema</p>
              <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-2">
                Crecer no debería volver más difícil dirigir.
              </h2>
              <p className="text-sm text-surface-500 mt-3 leading-relaxed">
                Cuando cada tienda vive aislada, la empresa pierde tiempo, control y claridad.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              {PROBLEMS.map((problem, index) => (
                <div key={problem.title} className="rounded-2xl bg-surface-50 border border-surface-100 p-4">
                  <span className="text-xs font-extrabold text-accent-500">0{index + 1}</span>
                  <h3 className="font-bold mt-2">{problem.title}</h3>
                  <p className="text-xs text-surface-500 leading-relaxed mt-1">{problem.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="como-funciona" className="pb-14 md:pb-20 scroll-mt-24">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">Cómo funciona</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-2">
              La empresa organiza. Las tiendas siguen operando.
            </h2>
            <p className="text-surface-500 mt-3 leading-relaxed">
              Empresarios se apoya sobre la operación actual de Cici, sin obligarte a migrar
              catálogos ni a cambiar la forma de vender de cada tienda.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-7">
            {STEPS.map((step, index) => (
              <div key={step.title} className="card p-5 md:p-6 flex gap-4">
                <div className="shrink-0 flex flex-col items-center">
                  <span className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-600 to-accent-500 text-white font-extrabold flex items-center justify-center shadow-soft">
                    {index + 1}
                  </span>
                  {index < STEPS.length - 1 && <span className="hidden md:block w-px flex-1 bg-surface-200 mt-2" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <step.icon className="w-4 h-4 text-brand-600" />
                    <h3 className="font-display font-bold">{step.title}</h3>
                  </div>
                  <p className="text-sm text-surface-500 leading-relaxed mt-1.5">{step.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 mt-5 flex items-start gap-2.5">
            <BadgeCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800 leading-relaxed">
              <strong>Regla de confianza:</strong> vincular una tienda requiere autorización de
              alguien con permisos suficientes sobre esa tienda. Una empresa no puede incorporar
              comercios ajenos a su organización.
            </p>
          </div>
        </section>

        <section className="pb-14 md:pb-20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-600">Beneficios</p>
          <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-2 mb-6">
            Lo que gana la empresa sin quitarle autonomía a las tiendas.
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} className="card p-5">
                <benefit.icon className="w-5 h-5 text-brand-600" />
                <h3 className="font-bold mt-3">{benefit.title}</h3>
                <p className="text-sm text-surface-500 leading-relaxed mt-1">{benefit.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-gradient-to-br from-surface-900 to-surface-800 text-white p-7 md:p-10 mb-14 md:mb-20 overflow-hidden relative">
          <div className="absolute -right-16 -top-16 w-56 h-56 bg-brand-500/20 rounded-full blur-3xl" />
          <div className="relative grid lg:grid-cols-2 gap-8 items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-300">Qué no cambia</p>
              <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight mt-2">
                La independencia de cada tienda es parte del producto.
              </h2>
              <p className="text-white/65 text-sm leading-relaxed mt-3">
                Centralizar la administración no significa absorber la operación. Cada comercio
                mantiene su espacio y su equipo, con reglas claras para colaborar.
              </p>
            </div>
            <ul className="space-y-3">
              {GUARANTEES.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-white/85">
                  <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="acceso" className="scroll-mt-24 pb-10">
          <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-8 items-start">
            <div className="lg:sticky lg:top-24">
              <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" />
                Beta privada
              </span>
              <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-4">
                ¿Tu empresa administra varias tiendas?
              </h2>
              <p className="text-surface-600 leading-relaxed mt-3">
                Solicita información para participar en la beta. Queremos entender tu operación
                antes de abrir el acceso.
              </p>

              <div className="space-y-3 mt-6">
                {[
                  'Te contactamos para conocer tus marcas, tiendas y equipos.',
                  'Validamos juntos si Empresarios encaja con tu operación.',
                  'Si encaja, entras a la beta con acompañamiento directo.',
                ].map((item, index) => (
                  <div key={item} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-surface-900 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {index + 1}
                    </span>
                    <p className="text-sm text-surface-600 leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl bg-surface-50 border border-surface-200 p-4 mt-6 flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-surface-500 shrink-0 mt-0.5" />
                <p className="text-xs text-surface-500 leading-relaxed">
                  Sin costo ni compromiso. No mostramos precios todavía: primero queremos validar
                  el problema y el valor con empresas reales.
                </p>
              </div>
            </div>

            <div className="card p-6 md:p-8">
              {success ? (
                <div className="py-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h3 className="font-display text-2xl font-bold mt-4">Solicitud recibida</h3>
                  <p className="text-surface-600 text-sm leading-relaxed mt-2 max-w-sm mx-auto">
                    {success}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSuccess(null)}
                    className="btn-ghost mt-6"
                  >
                    Enviar otra solicitud
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <h3 className="font-display text-xl font-bold">Acceso anticipado</h3>
                    <p className="text-sm text-surface-500 mt-1">
                      Cuéntanos lo mínimo para contactarte.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">Empresa *</span>
                      <input
                        required
                        minLength={2}
                        maxLength={120}
                        value={form.companyName}
                        onChange={(e) => update('companyName', e.target.value)}
                        className="input mt-1.5"
                        placeholder="Nombre de tu empresa"
                        autoComplete="organization"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">Nombre de contacto *</span>
                      <input
                        required
                        minLength={2}
                        maxLength={80}
                        value={form.contactName}
                        onChange={(e) => update('contactName', e.target.value)}
                        className="input mt-1.5"
                        placeholder="¿Con quién hablamos?"
                        autoComplete="name"
                      />
                    </label>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">Correo *</span>
                      <input
                        required
                        type="email"
                        maxLength={160}
                        value={form.email}
                        onChange={(e) => update('email', e.target.value)}
                        className="input mt-1.5"
                        placeholder="tu@empresa.com"
                        autoComplete="email"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">WhatsApp o teléfono</span>
                      <input
                        type="tel"
                        maxLength={30}
                        value={form.phone}
                        onChange={(e) => update('phone', e.target.value)}
                        className="input mt-1.5"
                        placeholder="Opcional"
                        autoComplete="tel"
                      />
                    </label>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">Tiendas que administras</span>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={form.storeCount}
                        onChange={(e) => update('storeCount', e.target.value)}
                        className="input mt-1.5"
                        placeholder="Ej. 5"
                        inputMode="numeric"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-surface-700">Sitio web</span>
                      <input
                        type="url"
                        maxLength={200}
                        value={form.website}
                        onChange={(e) => update('website', e.target.value)}
                        className="input mt-1.5"
                        placeholder="https://..."
                        autoComplete="url"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-xs font-bold text-surface-700">¿Cómo están organizadas hoy?</span>
                    <textarea
                      rows={4}
                      maxLength={1000}
                      value={form.message}
                      onChange={(e) => update('message', e.target.value)}
                      className="input mt-1.5 resize-y"
                      placeholder="Marcas, tiendas, equipos o el mayor dolor de cabeza que quieres resolver."
                    />
                  </label>

                  {error && (
                    <p className="rounded-xl bg-accent-50 border border-accent-200 px-3.5 py-2.5 text-sm text-accent-700">
                      {error}
                    </p>
                  )}

                  <button type="submit" disabled={sending} className="btn-primary w-full py-3">
                    {sending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        Solicitar información
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <p className="text-[11px] text-surface-400 text-center leading-relaxed">
                    Usaremos tus datos solo para contactarte sobre Cici Empresarios.
                  </p>
                </form>
              )}
            </div>
          </div>
        </section>

        <footer className="border-t border-surface-200 pt-6 pb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-surface-400 font-medium">
          <Link to="/" className="hover:text-brand-600 transition-colors">
            Cici
          </Link>
          <Link to="/como-funciona" className="hover:text-brand-600 transition-colors">
            ¿Cómo funciona?
          </Link>
          <a href="#acceso" className="hover:text-brand-600 transition-colors">
            Acceso anticipado
          </a>
        </footer>
      </div>
    </div>
  );
}
