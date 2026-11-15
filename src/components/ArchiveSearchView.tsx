import React, { useState, useMemo } from 'react';
import {
  Search,
  Calendar,
  Download,
  Upload,
  ArrowRight,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Store,
  Lock,
  Unlock,
  FileSpreadsheet
} from 'lucide-react';
import { KassaDayRecord } from '../types/kassa';
import { calculateTotals } from '../utils/storage';
import { formatMoney, formatUzbekDate } from '../utils/format';

interface ArchiveSearchViewProps {
  records: KassaDayRecord[];
  onOpenRecord: (record: KassaDayRecord) => void;
  onDeleteRecord: (id: string) => void;
  onImportRecords: (records: KassaDayRecord[]) => void;
}

export const ArchiveSearchView: React.FC<ArchiveSearchViewProps> = ({
  records,
  onOpenRecord,
  onDeleteRecord,
  onImportRecords
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [registerFilter, setRegisterFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'kam' | 'togri' | 'ortiqcha'>('all');
  const [importError, setImportError] = useState<string | null>(null);

  const uniqueRegisters = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => set.add(r.kassaNomi));
    return Array.from(set);
  }, [records]);

  const uniqueCashiers = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => {
      if (r.kassirIsmi && r.kassirIsmi.trim()) {
        set.add(r.kassirIsmi.trim());
      }
    });
    return Array.from(set);
  }, [records]);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) return dateCmp;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
  }, [records]);

  // Search across dates, cashier names, firm names, debtor names, expenses, notes
  const filtered = useMemo(() => {
    return sortedRecords.filter(r => {
      if (registerFilter !== 'all' && r.kassaNomi !== registerFilter) return false;
      if (cashierFilter !== 'all' && (r.kassirIsmi || '').trim() !== cashierFilter) return false;

      const t = calculateTotals(r);
      if (statusFilter === 'kam' && t.farq >= 0) return false;
      if (statusFilter === 'togri' && t.farq !== 0) return false;
      if (statusFilter === 'ortiqcha' && t.farq <= 0) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();

      const matchBasic =
        r.date.includes(q) ||
        formatUzbekDate(r.date).toLowerCase().includes(q) ||
        r.kassaNomi.toLowerCase().includes(q) ||
        (r.kassirIsmi || '').toLowerCase().includes(q) ||
        (r.izoh || '').toLowerCase().includes(q);

      if (matchBasic) return true;

      const matchQarz = (r.qarzList || []).some(
        item => item.nomi.toLowerCase().includes(q) || String(item.summa).includes(q)
      );
      if (matchQarz) return true;

      const matchFirma = (r.firmaList || []).some(
        item => item.nomi.toLowerCase().includes(q) || String(item.summa).includes(q)
      );
      if (matchFirma) return true;

      const matchRasxod = (r.rasxodList || []).some(
        item => item.nomi.toLowerCase().includes(q) || String(item.summa).includes(q)
      );
      if (matchRasxod) return true;

      const matchClick = (r.clickList || []).some(
        item => item.nomi.toLowerCase().includes(q) || String(item.summa).includes(q)
      );
      if (matchClick) return true;

      return false;
    });
  }, [sortedRecords, registerFilter, cashierFilter, statusFilter, searchQuery]);

  // Totals across filtered results
  const aggregate = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        const t = calculateTotals(r);
        acc.naqd += t.sofNaqd;
        acc.terminal += t.terminalJami;
        acc.click += t.clickJami;
        acc.qarz += t.qarzJami;
        acc.firma += t.firmaJami;
        acc.rasxod += t.rasxodJami;
        acc.jamiHisoblangan += t.jamiHisoblangan;
        acc.chek += t.chekdagiSumma;
        acc.farq += t.farq;
        return acc;
      },
      { naqd: 0, terminal: 0, click: 0, qarz: 0, firma: 0, rasxod: 0, jamiHisoblangan: 0, chek: 0, farq: 0 }
    );
  }, [filtered]);

  // If user searches for a specific firm or debtor, show matching individual lines!
  const matchedLineItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const results: { date: string; kassaNomi: string; turi: string; nomi: string; summa: number; vaqt: string }[] = [];

    sortedRecords.forEach(r => {
      (r.firmaList || []).forEach(item => {
        if (item.nomi.toLowerCase().includes(q)) {
          results.push({ date: r.date, kassaNomi: r.kassaNomi, turi: 'Firmaga', nomi: item.nomi, summa: item.summa, vaqt: item.vaqt });
        }
      });
      (r.qarzList || []).forEach(item => {
        if (item.nomi.toLowerCase().includes(q)) {
          results.push({ date: r.date, kassaNomi: r.kassaNomi, turi: 'Qarzga', nomi: item.nomi, summa: item.summa, vaqt: item.vaqt });
        }
      });
      (r.rasxodList || []).forEach(item => {
        if (item.nomi.toLowerCase().includes(q)) {
          results.push({ date: r.date, kassaNomi: r.kassaNomi, turi: 'Rasxod', nomi: item.nomi, summa: item.summa, vaqt: item.vaqt });
        }
      });
    });

    return results;
  }, [sortedRecords, searchQuery]);

  const handleExportCSV = () => {
    const headers = [
      'Sana',
      'Kassa',
      'Kassir',
      'Naqd Pul',
      'Terminal',
      'Click',
      'Qarzga Berildi',
      'Firmaga Berildi',
      'Rasxod',
      'Jami Hisoblangan',
      'Chekdagi Summa',
      'Farq (Kam/Ortiq)',
      'Izoh'
    ];

    const rows = filtered.map(r => {
      const t = calculateTotals(r);
      return [
        `"${r.date}"`,
        `"${r.kassaNomi}"`,
        `"${r.kassirIsmi || ''}"`,
        t.sofNaqd,
        t.terminalJami,
        t.clickJami,
        t.qarzJami,
        t.firmaJami,
        t.rasxodJami,
        t.jamiHisoblangan,
        t.chekdagiSumma,
        t.farq,
        `"${(r.izoh || '').replace(/"/g, '""')}"`
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `navo_market_kassa_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
    const link = document.createElement('a');
    link.setAttribute('href', dataStr);
    link.setAttribute('download', `navo_market_zaxira_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (Array.isArray(parsed)) {
          onImportRecords(parsed);
        } else {
          setImportError("Fayl formati noto'g'ri! Iltimos, JSON zaxira faylini tanlang.");
        }
      } catch {
        setImportError("Faylni o'qishda xatolik yuz berdi!");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-5">
      {/* Top Search & Filter Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Saqlangan Kassa Ma'lumotlari va Qidiruv</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Istalgan sana, firma nomi, qarzdor ismi yoki rasxod bo'yicha qidiring va qayta oching
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel (CSV)
            </button>
            <button
              type="button"
              onClick={handleExportJSON}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Zaxira (JSON)
            </button>
            <label className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition cursor-pointer">
              <Upload className="w-4 h-4" />
              Tiklash
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>
          </div>
        </div>

        {importError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold">
            {importError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Qidirish: firma, qarz olgan odam, kassir, sana..."
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
            />
          </div>

          <div className="md:col-span-2">
            <select
              value={registerFilter}
              onChange={(e) => setRegisterFilter(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
            >
              <option value="all">Barcha kassalar</option>
              {uniqueRegisters.map(reg => (
                <option key={reg} value={reg}>{reg}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={cashierFilter}
              onChange={(e) => setCashierFilter(e.target.value)}
              className="w-full px-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
            >
              <option value="all">Barcha kassirlar</option>
              {uniqueCashiers.map(c => (
                <option key={c} value={c}>👤 {c}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
            >
              <option value="all">Barcha natija</option>
              <option value="kam">Kam chiqqan</option>
              <option value="togri">To'g'ri (0)</option>
              <option value="ortiqcha">Ortiqcha</option>
            </select>
          </div>
        </div>
      </div>

      {/* Individual Matched Entries when searching by name */}
      {matchedLineItems.length > 0 && (
        <div className="bg-amber-50/70 rounded-2xl border border-amber-200 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              "{searchQuery}" bo'yicha topilgan alohida yozuvlar ({matchedLineItems.length} ta)
            </h3>
            <span className="text-xs font-bold mono text-amber-900">
              Jami: {formatMoney(matchedLineItems.reduce((s, x) => s + x.summa, 0))}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {matchedLineItems.slice(0, 12).map((m, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-amber-200/80 p-3 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-900">{m.nomi}</div>
                  <div className="text-[11px] text-slate-500">
                    {m.date} · {m.kassaNomi} · {m.turi} ({m.vaqt})
                  </div>
                </div>
                <div className="font-bold mono text-slate-900">{formatMoney(m.summa)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtered Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Jami Naqd</span>
          <span className="text-sm font-bold mono text-emerald-700">{formatMoney(aggregate.naqd)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Jami Terminal</span>
          <span className="text-sm font-bold mono text-blue-700">{formatMoney(aggregate.terminal)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Jami Click</span>
          <span className="text-sm font-bold mono text-indigo-700">{formatMoney(aggregate.click)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Jami Qarzga</span>
          <span className="text-sm font-bold mono text-amber-700">{formatMoney(aggregate.qarz)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Jami Firmaga</span>
          <span className="text-sm font-bold mono text-orange-700">{formatMoney(aggregate.firma)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Chek Jami</span>
          <span className="text-sm font-bold mono text-slate-900">{formatMoney(aggregate.chek)}</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3.5">
          <span className="text-[11px] text-slate-500 font-semibold block">Umumiy Farq</span>
          <span className={`text-sm font-bold mono ${aggregate.farq < 0 ? 'text-rose-600' : aggregate.farq > 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
            {aggregate.farq > 0 ? '+' : ''}{formatMoney(aggregate.farq)}
          </span>
        </div>
      </div>

      {/* Saved Days Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Calendar className="w-10 h-10 mx-auto text-slate-300 mb-2 stroke-1" />
            <p className="text-sm font-semibold text-slate-600">Saqlangan ma'lumotlar topilmadi</p>
            <p className="text-xs text-slate-400 mt-1">
              Kunlik kassani kiritib saqlaganingizda barcha kunlar shu yerda saqlanib boradi
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Sana & Kassa</th>
                  <th className="py-3 px-4 text-right">Naqd</th>
                  <th className="py-3 px-4 text-right">Terminal</th>
                  <th className="py-3 px-4 text-right">Click</th>
                  <th className="py-3 px-4 text-right">Qarzga</th>
                  <th className="py-3 px-4 text-right">Firmaga</th>
                  <th className="py-3 px-4 text-right">Jami Hisob</th>
                  <th className="py-3 px-4 text-right">Chek Summa</th>
                  <th className="py-3 px-4 text-center">Farq Natijasi</th>
                  <th className="py-3 px-4 text-right">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(r => {
                  const t = calculateTotals(r);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{formatUzbekDate(r.date)}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span>{r.kassaNomi}</span>
                          {r.kassirIsmi && <span>· {r.kassirIsmi}</span>}
                          <span>·</span>
                          <span>{r.isOchiq ? 'Ochiq' : 'Yopilgan'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right mono font-semibold text-emerald-700">
                        {formatMoney(t.sofNaqd)}
                      </td>
                      <td className="py-3 px-4 text-right mono text-blue-700">
                        {formatMoney(t.terminalJami)}
                      </td>
                      <td className="py-3 px-4 text-right mono text-indigo-700">
                        {formatMoney(t.clickJami)}
                      </td>
                      <td className="py-3 px-4 text-right mono text-amber-700">
                        {formatMoney(t.qarzJami)}
                        {r.qarzList.length > 0 && <span className="text-[10px] text-slate-400 block">{r.qarzList.length} ta</span>}
                      </td>
                      <td className="py-3 px-4 text-right mono text-orange-700">
                        {formatMoney(t.firmaJami)}
                        {r.firmaList.length > 0 && <span className="text-[10px] text-slate-400 block">{r.firmaList.length} ta</span>}
                      </td>
                      <td className="py-3 px-4 text-right mono font-bold text-slate-900">
                        {formatMoney(t.jamiHisoblangan)}
                      </td>
                      <td className="py-3 px-4 text-right mono font-bold text-slate-700">
                        {formatMoney(t.chekdagiSumma)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {t.chekdagiSumma === 0 && t.jamiHisoblangan === 0 ? (
                          <span className="text-slate-400 text-[11px]">-</span>
                        ) : t.farq === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                            To'g'ri (0)
                          </span>
                        ) : t.farq < 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded mono">
                            Kam: {formatMoney(Math.abs(t.farq))}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded mono">
                            +{formatMoney(t.farq)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenRecord(r)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer"
                          >
                            Ochish
                            <ArrowRight className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteRecord(r.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 cursor-pointer"
                            title="O'chirish"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
