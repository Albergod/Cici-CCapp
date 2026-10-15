import { useState } from 'react';
import { X, Loader2, User as UserIcon, Lock, Bell } from 'lucide-react';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { User } from '@/types';

export const NOTIFY_MESSAGES_KEY = 'cici-notify-messages';
export function notifyMessagesEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFY_MESSAGES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function AjustesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [notify, setNotify] = useState(notifyMessagesEnabled());

  if (!open) return null;

  const onAvatarFile = async (f: File) => {
    setUploading(true);
    try {
      const url = await api.upload(f);
      setAvatarUrl(url);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo subir la foto.');
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    setMsg(null);
    if (name.trim().length < 2) {
      setMsg('El nombre debe tener al menos 2 letras.');
      return;
    }
    setSaving(true);
    try {
      const updated: User = await api.users.update({
        name: name.trim(),
        avatarUrl: avatarUrl.trim() || null,
      });
      setUser(updated);
      setMsg('Perfil actualizado.');
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    setPassMsg(null);
    if (nw.length < 6) {
      setPassMsg('La nueva clave debe tener al menos 6 caracteres.');
      return;
    }
    if (nw !== nw2) {
      setPassMsg('La confirmación no coincide.');
      return;
    }
    setSavingPass(true);
    try {
      await api.users.changePassword(cur, nw);
      setCur('');
      setNw('');
      setNw2('');
      setPassMsg('Clave actualizada.');
    } catch (err) {
      setPassMsg(err instanceof Error ? err.message : 'No se pudo cambiar la clave.');
    } finally {
      setSavingPass(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-surface-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative card p-6 w-full max-w-md my-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-lg text-surface-900">Ajustes</h3>
          <button onClick={onClose} className="p-1.5 text-surface-400 hover:text-surface-700" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 mb-2 text-sm font-extrabold text-surface-800">
          <UserIcon className="w-4 h-4 text-brand-600" /> Perfil
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-14 h-14 rounded-2xl bg-surface-100 overflow-hidden shrink-0 flex items-center justify-center">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="w-6 h-6 text-surface-300" />
            )}
          </div>
          <label className="text-xs font-bold text-brand-600 hover:text-brand-700 cursor-pointer">
            {uploading ? 'Subiendo…' : 'Subir foto'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onAvatarFile(f);
              }}
            />
          </label>
        </div>
        <label className="block text-xs font-semibold text-surface-500 mb-1">Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Tu nombre" maxLength={80} />
        <label className="block text-xs font-semibold text-surface-500 mb-1 mt-3">Foto (URL)</label>
        <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="input text-xs" placeholder="https://…" />
        {msg && <p className="text-sm mt-2 text-surface-600">{msg}</p>}
        <button onClick={() => void saveProfile()} disabled={saving} className="btn-primary w-full mt-3">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Guardar perfil'}
        </button>

        <div className="flex items-center gap-2 mt-6 mb-2 text-sm font-extrabold text-surface-800">
          <Lock className="w-4 h-4 text-brand-600" /> Cambiar clave
        </div>
        <label className="block text-xs font-semibold text-surface-500 mb-1">Clave actual</label>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className="input" placeholder="••••••••" />
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <label className="block text-xs font-semibold text-surface-500 mb-1">Nueva</label>
            <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} className="input" placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-surface-500 mb-1">Confirmar</label>
            <input type="password" value={nw2} onChange={(e) => setNw2(e.target.value)} className="input" placeholder="••••••••" />
          </div>
        </div>
        {passMsg && <p className="text-sm mt-2 text-surface-600">{passMsg}</p>}
        <button onClick={() => void savePassword()} disabled={savingPass} className="btn-ghost w-full mt-3">
          {savingPass ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Actualizar clave'}
        </button>

        <div className="flex items-center gap-2 mt-6 mb-2 text-sm font-extrabold text-surface-800">
          <Bell className="w-4 h-4 text-brand-600" /> Avisos
        </div>
        <label className="flex items-center justify-between gap-3 cursor-pointer rounded-xl border border-surface-200 p-3">
          <span className="text-sm text-surface-700">Avisarme de mensajes nuevos en la web</span>
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              setNotify(e.target.checked);
              try {
                localStorage.setItem(NOTIFY_MESSAGES_KEY, e.target.checked ? 'on' : 'off');
              } catch {
                /* noop */
              }
            }}
            className="h-5 w-5 accent-brand-600"
          />
        </label>
      </div>
    </div>
  );
}
