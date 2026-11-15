import React, { useState, useEffect } from 'react';
import {
  UserPlus,
  Users,
  CheckCircle2,
  Phone,
  Store,
  Trash2,
  X,
  UserCheck,
  Smartphone,
  ArrowRight
} from 'lucide-react';
import { CashierProfile } from '../types/kassa';
import { TelegramMiniAppUser } from '../utils/telegramWebApp';

interface CashierAuthModalProps {
  isOpen: boolean;
  forceOpen: boolean;
  onClose: () => void;
  cashiers: CashierProfile[];
  activeCashier: CashierProfile | null;
  registers: string[];
  tgUser: TelegramMiniAppUser | null;
  onRegisterCashier: (payload: {
    ism: string;
    telefon?: string;
    asosiyKassa?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onSelectCashier: (cashier: CashierProfile) => void;
  onDeleteCashier: (id: string) => void;
}

export const CashierAuthModal: React.FC<CashierAuthModalProps> = ({
  isOpen,
  forceOpen,
  onClose,
  cashiers,
  activeCashier,
  registers,
  tgUser,
  onRegisterCashier,
  onSelectCashier,
  onDeleteCashier
}) => {
  const [tab, setTab] = useState<'register' | 'list'>(cashiers.length > 0 && !activeCashier ? 'list' : 'register');
  const [ism, setIsm] = useState('');
  const [telefon, setTelefon] = useState('');
  const [asosiyKassa, setAsosiyKassa] = useState(registers[0] || '1-Kassa');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (tgUser && !ism) {
        setIsm(tgUser.fullName);
      }
      if (cashiers.length === 0) {
        setTab('register');
      }
    }
  }, [isOpen, tgUser, cashiers.length]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = ism.trim();
    if (clean.length < 2) {
      setError("Iltimos, ismingizni to'liq kiriting (kamida 2 ta harf).");
      return;
    }

    setLoading(true);
    setError(null);
    const res = await onRegisterCashier({
      ism: clean,
      telefon: telefon.trim(),
      asosiyKassa,
    });
    setLoading(false);

    if (!res.ok) {
      setError(res.error || "Ro'yxatdan o'tishda xatolik yuz berdi.");
      return;
    }

    setIsm('');
    setTelefon('');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 bg-emerald-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-extrabold leading-tight">
                Kassir Ro&apos;yxatdan O&apos;tishi
              </h2>
              <p className="text-xs text-emerald-100 mt-0.5">
                Har bir kassir o&apos;z ismi bilan tizimga kiradi
              </p>
            </div>
          </div>

          {!forceOpen && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-emerald-100 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Telegram Mini App info pill */}
        {tgUser && (
          <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-900">
            <Smartphone className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              Telegram Mini App: <strong>{tgUser.fullName}</strong>
              {tgUser.username ? ` (@${tgUser.username})` : ''}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="p-3 pb-0">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => setTab('register')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Yangi Ro&apos;yxatdan O&apos;tish</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('list')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'list'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Kassirlar ({cashiers.length})</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {tab === 'register' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                  Kassir Ismi (To&apos;liq) *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={ism}
                  onChange={e => setIsm(e.target.value)}
                  placeholder="Masalan: Dilshod Karimov yoki Madina"
                  className="w-full px-4 py-3 text-sm font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Kassa ochilganda va yopilganda hisobotlarda aynan shu ism ko&apos;rinadi.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                    Telefon (ixtiyoriy)
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="tel"
                      value={telefon}
                      onChange={e => setTelefon(e.target.value)}
                      placeholder="+998 90 ..."
                      className="w-full pl-8 pr-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                    Qaysi Kassa?
                  </label>
                  <div className="relative">
                    <Store className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                    <select
                      value={asosiyKassa}
                      onChange={e => setAsosiyKassa(e.target.value)}
                      className="w-full pl-8 pr-3 py-2.5 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-hidden"
                    >
                      {registers.map(r => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition shadow-sm disabled:opacity-60"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{loading ? "Saqlanmoqda..." : "Ro'yxatdan o'tish va Kirish"}</span>
              </button>
            </form>
          ) : (
            <div className="space-y-3">
              {cashiers.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <Users className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-600">
                    Hali hech kim ro&apos;yxatdan o&apos;tmagan
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('register')}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    + Birinchi kassirni qo&apos;shish
                  </button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {cashiers.map(c => {
                    const isActive = activeCashier?.id === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`p-3 rounded-2xl border transition flex items-center justify-between gap-2 ${
                          isActive
                            ? 'bg-emerald-50 border-emerald-300'
                            : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-sm text-slate-900 truncate">
                              {c.ism}
                            </span>
                            {isActive && (
                              <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-600 text-white rounded-md">
                                Faol
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                            {c.asosiyKassa && <span>🏪 {c.asosiyKassa}</span>}
                            {c.telefon && <span>📞 {c.telefon}</span>}
                            {c.telegramUsername && <span>@{c.telegramUsername}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onSelectCashier(c)}
                            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition ${
                              isActive
                                ? 'bg-emerald-700 text-white'
                                : 'bg-slate-900 hover:bg-black text-white'
                            }`}
                          >
                            <span>{isActive ? 'Davom etish' : 'Kirish'}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>

                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => onDeleteCashier(c.id)}
                              title="Ro'yxatdan o'chirish"
                              className="p-2 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => setTab('register')}
                className="w-full py-2.5 border border-dashed border-emerald-400 text-emerald-700 hover:bg-emerald-50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>+ Boshqa yangi kassir qo&apos;shish</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
