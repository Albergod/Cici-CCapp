import { useEffect, useState } from 'react';
import { Users, Loader2, Copy, Check, RefreshCw, UserMinus } from 'lucide-react';
import { api } from '@/services/api';

interface Member {
  id: string;
  user?: { id: string; name: string; email: string } | null;
}

export function EquipoCard({ storeId, onChanged }: { storeId: string; onChanged?: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.stores.members(storeId);
      setMembers(r.members);
      setCode(r.inviteCode);
    } catch {
      /* panel opcional */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  const gen = async () => {
    setBusy(true);
    try {
      const r = await api.stores.invites(storeId);
      setCode(r.code);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      await api.stores.revokeInvite(storeId);
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    if (!window.confirm('¿Quitar a esta colaboradora? Perderá acceso a tu tienda.')) return;
    await api.stores.removeMember(storeId, userId);
    await load();
    onChanged?.();
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* noop */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center">
          <Users className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-extrabold text-surface-900">Equipo</h3>
          <p className="text-xs text-surface-500">Colaboradoras con código (ellas operan, tú decides planes y plata)</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-surface-50 border border-surface-200 p-4">
        <p className="text-xs font-bold text-surface-500 mb-1.5">CÓDIGO ACTIVO</p>
        {code ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 text-center text-2xl font-extrabold tracking-[0.3em] text-surface-900 bg-white border border-dashed border-surface-300 rounded-xl py-2">
              {code}
            </code>
            <button onClick={() => void copy()} className="btn-ghost text-sm shrink-0" title="Copiar código">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
            <button onClick={() => void revoke()} disabled={busy} className="btn-ghost text-sm shrink-0" title="Revocar y generar otro">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button onClick={() => void gen()} disabled={busy} className="btn-primary text-sm w-full">
            Generar código de invitación
          </button>
        )}
        <p className="text-xs text-surface-400 mt-2">Compártelo por WhatsApp. Vale hasta que lo revoques.</p>
      </div>

      <div className="mt-4">
        <p className="text-xs font-bold text-surface-500 mb-2">
          COLABORADORAS ({members.length})
        </p>
        {members.length === 0 ? (
          <p className="text-sm text-surface-400">Aún nadie. Con el código entran en segundos.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm py-2 border-b border-surface-100 last:border-0">
                <div className="min-w-0">
                  <p className="font-bold text-surface-900 truncate">{m.user?.name ?? 'Colaboradora'}</p>
                  <p className="text-xs text-surface-400 truncate">{m.user?.email ?? ''}</p>
                </div>
                <button
                  onClick={() => m.user && void remove(m.user.id)}
                  className="p-1.5 text-surface-400 hover:text-red-500 transition-colors"
                  title="Quitar acceso"
                >
                  <UserMinus className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function JoinTeamBox({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setError(null);
    if (code.trim().length < 4) {
      setError('Pon el código que te pasó la dueña.');
      return;
    }
    setBusy(true);
    try {
      await api.stores.join(code.trim().toUpperCase());
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo unir.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6 max-w-xl mx-auto mt-4">
      <h3 className="font-display font-bold text-surface-900">¿Te invitaron a colaborar?</h3>
      <p className="text-sm text-surface-500 mt-1 mb-3">Pega el código y entra a operar la tienda.</p>
      {error && (
        <div className="p-3 mb-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
          placeholder="CÓDIGO"
          className="input font-mono tracking-[0.2em] uppercase flex-1"
        />
        <button onClick={() => void join()} disabled={busy} className="btn-primary shrink-0">
          Unirme
        </button>
      </div>
    </div>
  );
}
