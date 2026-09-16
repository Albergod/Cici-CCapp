import { useEffect, useMemo, useState } from 'react';
import { Store, StoreService, Appointment, ScheduleConfig } from '@/types';
import { api } from '@/services/api';
import { formatCOP } from '@/lib/format';
import {
  CalendarClock,
  Clock,
  Loader2,
  Plus,
  X,
  Trash2,
  Check,
  CheckCircle2,
  RotateCcw,
  Scissors,
} from 'lucide-react';

type Props = {
  store: Store;
  onStoreUpdated?: (s: Store) => void;
};

const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
const DAY_LABELS: [string, number][] = [
  ['D', 0], ['L', 1], ['M', 2], ['X', 3], ['J', 4], ['V', 5], ['S', 6],
];

function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function weekdayName(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return days[d.getDay()];
}

export function BeautyServicesPanel({ store, onStoreUpdated }: Props) {
  const [services, setServices] = useState<StoreService[]>([]);
  const [templates, setTemplates] = useState<{ name: string; durationMinutes: number }[]>([]);
  const [agenda, setAgenda] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<ScheduleConfig>(store.schedule ?? {
    openTime: '08:00',
    closeTime: '21:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    workingDays: DEFAULT_DAYS,
    bookingHorizonDays: 30,
    timezone: 'America/Bogota',
  });

  // Formulario de servicio
  const [showForm, setShowForm] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const [svcName, setSvcName] = useState('');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcPrice, setSvcPrice] = useState('');
  const [svcHours, setSvcHours] = useState(0);
  const [svcMins, setSvcMins] = useState(30);

  const load = async () => {
    try {
      setLoading(true);
      const [svc, tmpl, appt] = await Promise.all([
        api.services.list(),
        api.services.templates().catch(() => []),
        api.appointments.agenda().catch(() => []),
      ]);
      setServices(svc);
      setTemplates(tmpl);
      setAgenda(appt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la agenda');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of agenda) {
      const list = map.get(a.appointmentDate) ?? [];
      list.push(a);
      map.set(a.appointmentDate, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [agenda]);

  const saveSchedule = async () => {
    try {
      setSavingSchedule(true);
      const updated = await api.stores.update(store.id, { schedule });
      onStoreUpdated?.(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el horario');
    } finally {
      setSavingSchedule(false);
    }
  };

  const addFromTemplate = (name: string, durationMinutes: number) => {
    setSvcName(name);
    setSvcHours(Math.floor(durationMinutes / 60));
    setSvcMins(durationMinutes % 60);
    setShowForm(true);
  };

  const submitService = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(svcPrice);
    if (!svcName.trim() || !price || price <= 0) {
      setError('Completa nombre y precio del servicio.');
      return;
    }
    const durationMinutes = svcHours * 60 + svcMins;
    try {
      setSavingService(true);
      await api.services.create({
        name: svcName.trim(),
        description: svcDesc.trim() || undefined,
        price,
        durationMinutes,
      });
      setSvcName('');
      setSvcDesc('');
      setSvcPrice('');
      setSvcHours(0);
      setSvcMins(30);
      setShowForm(false);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el servicio');
    } finally {
      setSavingService(false);
    }
  };

  const removeService = async (id: string) => {
    if (!window.confirm('¿Eliminar este servicio? Se cancelarán sus citas pasadas.')) return;
    try {
      await api.services.remove(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar');
    }
  };

  const setAppointment = async (id: string, action: 'cancel' | 'done' | 'no_show') => {
    setError(null);
    setNotice(null);
    try {
      if (action === 'cancel') {
        await api.appointments.cancel(id);
      } else {
        const res = await api.appointments.close(id, action);
        if (action === 'done') {
          setNotice(
            res.sale
              ? `¡Listo! Venta registrada por ${formatCOP(res.sale.total)}.`
              : 'Cita cerrada.',
          );
        } else {
          setNotice('Cita marcada como "no vino".');
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la cita');
    }
  };

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center py-10 text-surface-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {/* ── Horario de atención ─────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-surface-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand-500" />
              Horario de agenda
            </h3>
            <p className="text-xs text-surface-500">
              Los clientes reservan citas dentro de estas franjas (los días y las horas que marques).
            </p>
          </div>
          <button
            onClick={saveSchedule}
            disabled={savingSchedule}
            className="btn-primary text-sm inline-flex items-center gap-1.5"
          >
            {savingSchedule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Guardar
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-surface-500">Abre</span>
            <input
              type="time"
              value={schedule.openTime}
              onChange={(e) => setSchedule({ ...schedule, openTime: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-surface-500">Cierra</span>
            <input
              type="time"
              value={schedule.closeTime}
              onChange={(e) => setSchedule({ ...schedule, closeTime: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-surface-500">Almuerzo desde</span>
            <input
              type="time"
              value={schedule.lunchStart}
              onChange={(e) => setSchedule({ ...schedule, lunchStart: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-surface-500">Almuerzo hasta</span>
            <input
              type="time"
              value={schedule.lunchEnd}
              onChange={(e) => setSchedule({ ...schedule, lunchEnd: e.target.value })}
              className="input"
            />
          </label>
        </div>

        <div className="mt-3.5">
          <span className="text-xs font-medium text-surface-500">Días de atención</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {DAY_LABELS.map(([label, day]) => {
              const active = schedule.workingDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() =>
                    setSchedule({
                      ...schedule,
                      workingDays: active
                        ? schedule.workingDays.filter((w) => w !== day)
                        : [...schedule.workingDays, day].sort(),
                    })
                  }
                  className={`w-10 h-10 rounded-xl text-sm font-bold transition-all ${
                    active
                      ? 'bg-brand-600 text-white shadow-soft'
                      : 'bg-white text-surface-400 border border-surface-200 hover:border-brand-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Servicios ───────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-surface-900 flex items-center gap-2">
              <Scissors className="w-5 h-5 text-accent-500" />
              Servicios
            </h3>
            <p className="text-xs text-surface-500">
              Define la duración de cada servicio; los clientes reservan el horario por el chat con la IA.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className={showForm ? 'btn-ghost text-sm' : 'btn-primary text-sm inline-flex items-center gap-1.5'}
          >
            {showForm ? (
              <>
                <X className="w-4 h-4" /> Cancelar
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" /> Agregar servicio
              </>
            )}
          </button>
        </div>

        {templates.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-surface-400 mb-1.5">Plantillas rápidas</p>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <button
                  key={t.name}
                  onClick={() => addFromTemplate(t.name, t.durationMinutes)}
                  className="px-3 py-1.5 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold hover:bg-brand-100 transition-colors"
                >
                  + {t.name} · {minutesLabel(t.durationMinutes)}
                </button>
              ))}
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={submitService} className="mb-5 p-5 bg-surface-50 rounded-2xl border border-surface-200 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">Nombre del servicio</label>
                <input
                  value={svcName}
                  onChange={(e) => setSvcName(e.target.value)}
                  required
                  minLength={2}
                  className="input"
                  placeholder="Ej: Manicura en gel"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">Precio (COP)</label>
                <input
                  type="number"
                  min={1}
                  value={svcPrice}
                  onChange={(e) => setSvcPrice(e.target.value)}
                  required
                  className="input"
                  placeholder="45000"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Duración: horas
                </label>
                <select
                  value={svcHours}
                  onChange={(e) => setSvcHours(Number(e.target.value))}
                  className="input"
                >
                  {Array.from({ length: 9 }, (_, i) => (
                    <option key={i} value={i}>{i} h</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Duración: minutos
                </label>
                <select
                  value={svcMins}
                  onChange={(e) => setSvcMins(Number(e.target.value))}
                  className="input"
                >
                  {[0, 15, 30, 45].map((m) => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <span className="text-sm font-bold text-brand-600 mb-2">
                  {minutesLabel(svcHours * 60 + svcMins)}
                  {svcHours * 60 + svcMins < 5 ? ' (mínimo 5 min)' : ''}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                Descripción (opcional)
              </label>
              <textarea
                value={svcDesc}
                onChange={(e) => setSvcDesc(e.target.value)}
                rows={2}
                className="input resize-none"
                placeholder="Qué incluye el servicio…"
              />
            </div>

            {svcHours * 60 + svcMins < 5 && (
              <p className="text-xs text-accent-500">Mínimo 5 minutos de duración.</p>
            )}

            <button
              type="submit"
              disabled={savingService || svcHours * 60 + svcMins < 5}
              className="btn-primary"
            >
              {savingService ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Crear servicio'}
            </button>
          </form>
        )}

        {services.length === 0 ? (
          <p className="text-center text-sm text-surface-400 py-6">
            Aún no tienes servicios. Crea uno o usa una plantilla rápida.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.map((svc) => (
              <div key={svc.id} className="rounded-2xl border border-surface-200 bg-white p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-surface-900">{svc.name}</h4>
                  <span className="font-display font-bold text-brand-600 text-sm">
                    {formatCOP(svc.price)}
                  </span>
                </div>
                <p className="text-xs text-surface-400 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {minutesLabel(svc.durationMinutes)}
                </p>
                {svc.description && (
                  <p className="text-xs text-surface-500 leading-relaxed">{svc.description}</p>
                )}
                <button
                  onClick={() => removeService(svc.id)}
                  className="mt-auto w-fit inline-flex items-center gap-1 text-xs text-accent-500 hover:text-accent-600"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Agenda ──────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-bold text-surface-900 flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-emerald-500" />
            Agenda de citas
          </h3>
          <span className="text-xs text-surface-400 font-medium">
            Próximos 7 días · la venta la registras tú al prestar el servicio
          </span>
        </div>

        {groupedByDate.length === 0 ? (
          <p className="text-center text-sm text-surface-400 py-6">
            No hay citas agendadas todavía. Cuando un cliente reserve por el chat, la verás aquí.
          </p>
        ) : (
          <div className="space-y-5">
            {groupedByDate.map(([date, rows]) => (
              <div key={date}>
                <p className="text-xs font-bold uppercase tracking-wide text-surface-400 mb-2">
                  {weekdayName(date)} · {date}
                </p>
                <div className="space-y-2">
                  {rows
                    .slice()
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-surface-200 bg-surface-50 px-4 py-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-display font-bold text-surface-900 tabular-nums shrink-0">
                            {a.startTime}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-surface-800 truncate">
                              {a.service.name}
                            </p>
                            <p className="text-xs text-surface-500 truncate">
                              {a.customer?.name ?? 'Cliente'} · {minutesLabel(a.service.durationMinutes)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {a.status === 'confirmed' && (
                            <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase">
                              Confirmada
                            </span>
                          )}
                          {a.status === 'completed' && (
                            <span className="px-2 py-1 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold uppercase">
                              {a.saleId ? 'Atendida · venta registrada' : 'Atendida'}
                            </span>
                          )}
                          {a.status === 'no_show' && (
                            <span className="px-2 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold uppercase">
                              No vino
                            </span>
                          )}
                          {a.status === 'cancelled' && (
                            <span className="px-2 py-1 rounded-full bg-surface-100 text-surface-400 text-[10px] font-bold uppercase">
                              Cancelada
                            </span>
                          )}
                          {a.status === 'confirmed' && (
                            <>
                              <button
                                onClick={() => setAppointment(a.id, 'done')}
                                title="Listo: atendida y registra la venta"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors text-xs font-bold"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Listo
                              </button>
                              <button
                                onClick={() => setAppointment(a.id, 'no_show')}
                                title="El cliente no vino"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors text-xs font-bold"
                              >
                                No vino
                              </button>
                              <button
                                onClick={() => setAppointment(a.id, 'cancel')}
                                title="Cancelar cita"
                                className="p-2 rounded-lg bg-surface-200 text-surface-600 hover:bg-accent-100 hover:text-accent-600 transition-colors"
                              >
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}