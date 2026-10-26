import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Crown,
  Eye,
  ExternalLink,
  Link2,
  Loader2,
  Mail,
  Package,
  Pencil,
  Plus,
  Shield,
  Store,
  Unlink,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '@/stores/authStore';
import {
  api,
  EmpresaDetail,
  EmpresaListItem,
  EmpresaMember,
  EmpresaRole,
} from '@/services/api';
import { formatCOP } from '@/lib/format';

const ROLE_LABELS: Record<EmpresaRole, string> = {
  OWNER: 'Dueña',
  ADMIN: 'Administrador',
  VIEWER: 'Consulta',
};

const ROLE_STYLES: Record<EmpresaRole, string> = {
  OWNER: 'bg-amber-100 text-amber-700',
  ADMIN: 'bg-brand-100 text-brand-700',
  VIEWER: 'bg-surface-100 text-surface-600',
};

const ROLE_ICONS: Record<EmpresaRole, typeof Crown> = {
  OWNER: Crown,
  ADMIN: Shield,
  VIEWER: Eye,
};

function canManage(role?: EmpresaRole) {
  return role === 'OWNER' || role === 'ADMIN';
}

export function EmpresasPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<EmpresaListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmpresaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const [storeToLink, setStoreToLink] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'ADMIN' | 'VIEWER'>('VIEWER');
  const [busy, setBusy] = useState<string | null>(null);

  const flash = (message: string) => {
    setNotice(message);
    setError(null);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const loadCompanies = async (preferredId?: string, showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const rows = await api.empresas.mine();
      setCompanies(rows);
      setSelectedId((current) => {
        const wanted = preferredId ?? current;
        if (wanted && rows.some((row) => row.id === wanted)) return wanted;
        return rows[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos cargar tus empresas.');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api.empresas.get(id);
      setDetail(data);
      setNameDraft(data.name);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : 'No pudimos cargar la empresa.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadCompanies(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    loadDetail(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 2) {
      setError('Escribe un nombre de al menos 2 letras.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.empresas.create(name);
      setNewName('');
      setShowCreate(false);
      setSelectedId(created.id);
      await loadCompanies(created.id);
      flash('Empresa creada. Ahora vincula tus tiendas.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos crear la empresa.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!detail) return;
    const name = nameDraft.trim();
    if (name.length < 2) {
      setError('El nombre debe tener al menos 2 letras.');
      return;
    }
    setBusy('rename');
    try {
      await api.empresas.rename(detail.id, name);
      setEditingName(false);
      await Promise.all([loadDetail(detail.id), loadCompanies(detail.id)]);
      flash('Nombre actualizado.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos renombrar la empresa.');
    } finally {
      setBusy(null);
    }
  };

  const handleLinkStore = async () => {
    if (!detail || !storeToLink) return;
    setBusy('link');
    try {
      await api.empresas.linkStore(detail.id, storeToLink);
      setStoreToLink('');
      await Promise.all([loadDetail(detail.id), loadCompanies(detail.id)]);
      flash('Tienda vinculada. Su operación sigue intacta.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos vincular la tienda.');
    } finally {
      setBusy(null);
    }
  };

  const handleUnlinkStore = async (storeId: string, storeName: string) => {
    if (!detail) return;
    if (!window.confirm(`¿Desvincular "${storeName}" de ${detail.name}? La tienda no se borra ni cambia de dueña.`)) {
      return;
    }
    setBusy(storeId);
    try {
      await api.empresas.unlinkStore(detail.id, storeId);
      await Promise.all([loadDetail(detail.id), loadCompanies(detail.id)]);
      flash('Tienda desvinculada.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos desvincular la tienda.');
    } finally {
      setBusy(null);
    }
  };

  const handleAddMember = async () => {
    if (!detail) return;
    if (!memberEmail.trim()) {
      setError('Escribe el correo de la persona.');
      return;
    }
    setBusy('add-member');
    try {
      await api.empresas.addMember(detail.id, memberEmail.trim(), memberRole);
      setMemberEmail('');
      setMemberRole('VIEWER');
      await Promise.all([loadDetail(detail.id), loadCompanies(detail.id)]);
      flash('Persona agregada al equipo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos agregar a esa persona.');
    } finally {
      setBusy(null);
    }
  };

  const handleRoleChange = async (member: EmpresaMember, role: 'ADMIN' | 'VIEWER') => {
    if (!detail) return;
    setBusy(member.userId);
    try {
      await api.empresas.updateMember(detail.id, member.userId, role);
      await loadDetail(detail.id);
      flash(`Rol de ${member.name} actualizado.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos cambiar el rol.');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveMember = async (member: EmpresaMember) => {
    if (!detail) return;
    if (!window.confirm(`¿Quitar a ${member.name} del equipo de ${detail.name}?`)) return;
    setBusy(member.userId);
    try {
      await api.empresas.removeMember(detail.id, member.userId);
      await Promise.all([loadDetail(detail.id), loadCompanies(detail.id)]);
      flash('Persona retirada del equipo.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos quitar a esa persona.');
    } finally {
      setBusy(null);
    }
  };

  const selectedCompany = companies.find((c) => c.id === selectedId);
  const isOwner = detail?.role === 'OWNER';
  const canEdit = canManage(detail?.role);

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

        <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold">
              <Building2 className="w-3.5 h-3.5" />
              Cici Empresarios
            </span>
            <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mt-3">
              Mi empresa
            </h1>
            <p className="text-surface-600 mt-2 max-w-2xl">
              Agrupa tiendas, delega equipos y mira el negocio completo sin
              perder la independencia de cada marca.
            </p>
          </div>
          <a
            href="#empresas"
            onClick={(event) => {
              event.preventDefault();
              setShowCreate(true);
            }}
            className="btn-primary text-sm px-4 py-2.5"
          >
            <Plus className="w-4 h-4" />
            Nueva empresa
          </a>
        </header>

        {notice && (
          <div className="mb-5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-5 rounded-xl bg-accent-50 border border-accent-200 px-4 py-3 text-sm text-accent-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Cerrar error">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="card p-10 text-center text-surface-500">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Cargando tus empresas...
          </div>
        ) : companies.length === 0 && !showCreate ? (
          <div className="card p-8 md:p-10 max-w-3xl">
            <div className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center">
              <Building2 className="w-7 h-7" />
            </div>
            <h2 className="font-display text-2xl font-bold mt-4">Crea tu espacio empresarial</h2>
            <p className="text-surface-600 mt-2 leading-relaxed">
              Una empresa reúne tiendas de distintas dueñas bajo una misma organización.
              Cada tienda conserva su cuenta, su plan y su operación: la empresa solo aporta
              la visión consolidada y los roles de equipo.
            </p>
            <ul className="mt-5 space-y-2 text-sm text-surface-600">
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Necesitas al menos una tienda propia creada en Cici.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Podrás vincular más tiendas cuando quieras.
              </li>
              <li className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                Invita a tu equipo por correo con permisos claros.
              </li>
            </ul>
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-6 px-5 py-2.5">
              <Plus className="w-4 h-4" />
              Empezar
            </button>
          </div>
        ) : (
          <div id="empresas" className="grid lg:grid-cols-[280px_1fr] gap-6 items-start">
            <aside className="card p-3 lg:sticky lg:top-24">
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-surface-400">
                  Tus empresas
                </p>
                <button
                  onClick={() => setShowCreate((value) => !value)}
                  className="w-7 h-7 rounded-lg bg-surface-100 text-surface-600 hover:bg-surface-200 flex items-center justify-center"
                  aria-label="Nueva empresa"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {showCreate && (
                <div className="m-1 p-3 rounded-xl bg-surface-50 border border-surface-200">
                  <label className="text-xs font-bold text-surface-700" htmlFor="empresa-nombre">
                    Nombre de la empresa
                  </label>
                  <input
                    id="empresa-nombre"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    maxLength={120}
                    placeholder="Ej. Grupo Aurora"
                    className="input mt-1.5 text-sm"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleCreate();
                    }}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleCreate}
                      disabled={creating}
                      className="btn-primary text-xs px-3 py-2 flex-1"
                    >
                      {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Crear'}
                    </button>
                    <button
                      onClick={() => {
                        setShowCreate(false);
                        setNewName('');
                      }}
                      className="btn-outline text-xs px-3 py-2"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2 space-y-1">
                {companies.map((company) => {
                  const RoleIcon = ROLE_ICONS[company.role];
                  return (
                    <button
                      key={company.id}
                      onClick={() => setSelectedId(company.id)}
                      className={`w-full text-left rounded-xl px-3 py-3 transition-colors ${
                        company.id === selectedId
                          ? 'bg-brand-50 border border-brand-200'
                          : 'hover:bg-surface-50 border border-transparent'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-surface-900 text-white flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-surface-900 truncate">
                            {company.name}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-surface-500 mt-0.5">
                            <RoleIcon className="w-3 h-3" />
                            {ROLE_LABELS[company.role]} · {company.tiendasCount} tienda(s)
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="min-w-0 space-y-6">
              {detailLoading || !detail ? (
                <div className="card p-10 text-center text-surface-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Cargando empresa...
                </div>
              ) : (
                <>
                  <section className="card p-5 md:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        {editingName ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={nameDraft}
                              onChange={(event) => setNameDraft(event.target.value)}
                              maxLength={120}
                              className="input text-lg font-bold max-w-sm"
                              autoFocus
                            />
                            <button
                              onClick={handleRename}
                              disabled={busy === 'rename'}
                              className="btn-primary text-xs px-3 py-2"
                            >
                              {busy === 'rename' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              Guardar
                            </button>
                            <button
                              onClick={() => {
                                setEditingName(false);
                                setNameDraft(detail.name);
                              }}
                              className="btn-ghost text-xs px-3 py-2"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="font-display text-2xl md:text-3xl font-bold">
                              {detail.name}
                            </h2>
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${ROLE_STYLES[detail.role]}`}
                            >
                              {ROLE_LABELS[detail.role]}
                            </span>
                            {canEdit && (
                              <button
                                onClick={() => setEditingName(true)}
                                className="w-7 h-7 rounded-lg text-surface-400 hover:bg-surface-100 hover:text-surface-700 flex items-center justify-center"
                                aria-label="Editar nombre"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-surface-400 mt-2">
                          Creada el {new Date(detail.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wide text-surface-400 font-bold">
                          Ventas acumuladas
                        </p>
                        <p className="font-display text-2xl font-bold text-surface-900">
                          {formatCOP(detail.resumen.ventasTotal)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                      <div className="rounded-xl bg-surface-50 border border-surface-100 p-3">
                        <Store className="w-4 h-4 text-brand-600" />
                        <p className="font-display text-xl font-bold mt-2">{detail.resumen.tiendas}</p>
                        <p className="text-[11px] text-surface-500">Tiendas</p>
                      </div>
                      <div className="rounded-xl bg-surface-50 border border-surface-100 p-3">
                        <Users className="w-4 h-4 text-brand-600" />
                        <p className="font-display text-xl font-bold mt-2">{detail.resumen.miembros}</p>
                        <p className="text-[11px] text-surface-500">Equipo</p>
                      </div>
                      <div className="rounded-xl bg-surface-50 border border-surface-100 p-3">
                        <Wallet className="w-4 h-4 text-brand-600" />
                        <p className="font-display text-xl font-bold mt-2">
                          {formatCOP(detail.resumen.ventas30d)}
                        </p>
                        <p className="text-[11px] text-surface-500">Ventas 30 días</p>
                      </div>
                      <div className="rounded-xl bg-surface-50 border border-surface-100 p-3">
                        <Package className="w-4 h-4 text-brand-600" />
                        <p className="font-display text-xl font-bold mt-2">{detail.resumen.productos}</p>
                        <p className="text-[11px] text-surface-500">Productos</p>
                      </div>
                    </div>
                  </section>

                  <section className="card overflow-hidden">
                    <div className="p-5 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-display text-lg font-bold">Tiendas de la empresa</h3>
                        <p className="text-xs text-surface-500 mt-1">
                          Cada tienda conserva su dueña, su plan y su operación.
                        </p>
                      </div>
                      <Store className="w-5 h-5 text-brand-600" />
                    </div>

                    {detail.tiendas.length === 0 ? (
                      <div className="p-8 text-center text-sm text-surface-500">
                        <Store className="w-8 h-8 mx-auto mb-2 text-surface-300" />
                        Todavía no hay tiendas vinculadas.
                      </div>
                    ) : (
                      <div className="divide-y divide-surface-100">
                        {detail.tiendas.map((store) => (
                          <div key={store.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-xl bg-surface-100 overflow-hidden flex items-center justify-center shrink-0">
                                {store.logoUrl ? (
                                  <img src={store.logoUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Store className="w-5 h-5 text-surface-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-surface-900">{store.name}</span>
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-100 text-surface-600">
                                    {store.plan}
                                  </span>
                                  {store.status !== 'ACTIVE' && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                      {store.status}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-surface-500 mt-1">
                                  {store.productos} producto(s) · {store.ventasCount} venta(s) ·{' '}
                                  {formatCOP(store.ventas30d)} en 30 días
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Link
                                to={`/store/${store.slug}`}
                                className="btn-outline text-xs px-3 py-1.5 inline-flex items-center gap-1"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Ver tienda
                              </Link>
                              {canEdit && (
                                <button
                                  onClick={() => handleUnlinkStore(store.id, store.name)}
                                  disabled={busy === store.id}
                                  className="btn-ghost text-xs px-2.5 py-1.5 text-accent-600 inline-flex items-center gap-1"
                                  title="Desvincular tienda"
                                >
                                  {busy === store.id ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Unlink className="w-3.5 h-3.5" />
                                  )}
                                  Desvincular
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {canEdit && detail.tiendasDisponibles.length > 0 && (
                      <div className="p-4 border-t border-surface-100 bg-surface-50/60">
                        <p className="text-xs font-bold text-surface-700 mb-2 flex items-center gap-1.5">
                          <Link2 className="w-3.5 h-3.5" />
                          Vincular una tienda tuya
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={storeToLink}
                            onChange={(event) => setStoreToLink(event.target.value)}
                            className="input text-sm flex-1"
                          >
                            <option value="">Elige una tienda...</option>
                            {detail.tiendasDisponibles.map((store) => (
                              <option key={store.id} value={store.id}>
                                {store.name}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={handleLinkStore}
                            disabled={!storeToLink || busy === 'link'}
                            className="btn-primary text-sm px-4 py-2"
                          >
                            {busy === 'link' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Link2 className="w-4 h-4" />
                            )}
                            Vincular
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  <section className="card overflow-hidden">
                    <div className="p-5 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h3 className="font-display text-lg font-bold">Equipo de la empresa</h3>
                        <p className="text-xs text-surface-500 mt-1">
                          Roles transversales: no reemplazan los permisos de cada tienda.
                        </p>
                      </div>
                      <Users className="w-5 h-5 text-brand-600" />
                    </div>

                    <div className="divide-y divide-surface-100">
                      {detail.miembros.map((member) => {
                        const RoleIcon = ROLE_ICONS[member.role];
                        const isCompanyOwner = member.userId === detail.ownerId;
                        return (
                          <div key={member.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-instagram overflow-hidden flex items-center justify-center shrink-0">
                                {member.avatarUrl ? (
                                  <img src={member.avatarUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Users className="w-4 h-4 text-white" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-surface-900 truncate">
                                  {member.name}
                                  {member.userId === detail.ownerId ? ' · dueña' : ''}
                                </p>
                                <p className="text-xs text-surface-500 truncate">{member.email}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isOwner && !isCompanyOwner ? (
                                <select
                                  value={member.role}
                                  onChange={(event) =>
                                    handleRoleChange(member, event.target.value as 'ADMIN' | 'VIEWER')
                                  }
                                  disabled={busy === member.userId}
                                  className="text-xs font-semibold bg-surface-50 border border-surface-200 rounded-lg px-2 py-1.5"
                                >
                                  <option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
                                  <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>
                                </select>
                              ) : (
                                <span
                                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${ROLE_STYLES[member.role]}`}
                                >
                                  <RoleIcon className="w-3 h-3" />
                                  {ROLE_LABELS[member.role]}
                                </span>
                              )}
                              {canEdit && !isCompanyOwner && (isOwner || member.role === 'VIEWER') && (
                                <button
                                  onClick={() => handleRemoveMember(member)}
                                  disabled={busy === member.userId}
                                  className="w-7 h-7 rounded-lg text-surface-400 hover:bg-accent-50 hover:text-accent-600 flex items-center justify-center"
                                  title="Quitar del equipo"
                                >
                                  {busy === member.userId ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <X className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {canEdit && (
                      <div className="p-4 border-t border-surface-100 bg-surface-50/60">
                        <p className="text-xs font-bold text-surface-700 mb-2 flex items-center gap-1.5">
                          <UserPlus className="w-3.5 h-3.5" />
                          Agregar a alguien que ya tiene cuenta en Cici
                        </p>
                        <div className="grid sm:grid-cols-[1fr_150px_auto] gap-2">
                          <div className="relative">
                            <Mail className="w-4 h-4 text-surface-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="email"
                              value={memberEmail}
                              onChange={(event) => setMemberEmail(event.target.value)}
                              placeholder="correo@empresa.com"
                              className="input text-sm pl-9"
                            />
                          </div>
                          <select
                            value={memberRole}
                            onChange={(event) => setMemberRole(event.target.value as 'ADMIN' | 'VIEWER')}
                            className="input text-sm"
                          >
                            <option value="VIEWER">{ROLE_LABELS.VIEWER}</option>
                            {isOwner && <option value="ADMIN">{ROLE_LABELS.ADMIN}</option>}
                          </select>
                          <button
                            onClick={handleAddMember}
                            disabled={busy === 'add-member'}
                            className="btn-primary text-sm px-4 py-2"
                          >
                            {busy === 'add-member' ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <UserPlus className="w-4 h-4" />
                            )}
                            Agregar
                          </button>
                        </div>
                      </div>
                    )}
                  </section>

                  <p className="text-xs text-surface-400 flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5" />
                    {selectedCompany?.name ?? detail.name} · La empresa no cambia la dueña ni el
                    plan de tus tiendas.
                  </p>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}
