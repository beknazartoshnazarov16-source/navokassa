import React, { useState, useMemo } from 'react';
import {
  Search,
  Calendar,
  Download,
  Upload,
  ArrowRight,
  Trash2,
  FileSpreadsheet,
  Users,
  ListChecks,
  Award,
  ChevronDown,
  ChevronUp,
  UserCheck
} from 'lucide-react';
import { CashierProfile, KassaDayRecord } from '../types/kassa';
import { calculateTotals } from '../utils/storage';
import { formatMoney, formatUzbekDate, getTodayDateString } from '../utils/format';

interface ArchiveSearchViewProps {
  records: KassaDayRecord[];
  cashiers?: CashierProfile[];
  onOpenRecord: (record: KassaDayRecord) => void;
  onDeleteRecord: (id: string) => void;
  onImportRecords: (records: KassaDayRecord[]) => void;
}

interface CashierSummaryRow {
  key: string;
  ism: string;
  isRegistered: boolean;
  asosiyKassa?: string;
  telefon?: string;
  telegramUsername?: string;
  shiftsCount: number;
  naqd: number;
  terminal: number;
  click: number;
  qarz: number;
  firma: number;
  rasxod: number;
  jamiHisoblangan: number;
  chek: number;
  farq: number;
  records: KassaDayRecord[];
}

function shiftDateString(dateStr: string, daysDelta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + daysDelta);
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export const ArchiveSearchView: React.FC<ArchiveSearchViewProps> = ({
  records,
  cashiers = [],
  onOpenRecord,
  onDeleteRecord,
  onImportRecords
}) => {
  const [viewMode, setViewMode] = useState<'records' | 'cashiers'>('records');

  // Records View Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [registerFilter, setRegisterFilter] = useState<string>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'kam' | 'togri' | 'ortiqcha'>('all');
  const [importError, setImportError] = useState<string | null>(null);

  // Cashier Summary View Date Range & Filters
  const todayStr = useMemo(() => getTodayDateString(), []);
  const monthStartStr = useMemo(() => `${todayStr.slice(0, 8)}01`, [todayStr]);
  const [startDate, setStartDate] = useState<string>(monthStartStr);
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [summaryRegisterFilter, setSummaryRegisterFilter] = useState<string>('all');
  const [expandedCashierKey, setExpandedCashierKey] = useState<string | null>(null);

  const uniqueRegisters = useMemo(() => {
    const set = new Set<string>();
    records.forEach(r => set.add(r.kassaNomi));
    return Array.from(set);
  }, [records]);

  const uniqueCashiers = useMemo(() => {
    const set = new Set<string>();
    cashiers.forEach(c => {
      if (c.ism && c.ism.trim()) set.add(c.ism.trim());
    });
    records.forEach(r => {
      if (r.kassirIsmi && r.kassirIsmi.trim()) {
        set.add(r.kassirIsmi.trim());
      }
    });
    return Array.from(set);
  }, [records, cashiers]);

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

  // Cashier Summary over selected date range
  const { cashierSummaries, summaryTotals } = useMemo(() => {
    const effectiveStart = startDate && endDate && startDate > endDate ? endDate : startDate;
    const effectiveEnd = startDate && endDate && startDate > endDate ? startDate : endDate;

    const rangeRecords = sortedRecords.filter(r => {
      if (effectiveStart && r.date < effectiveStart) return false;
      if (effectiveEnd && r.date > effectiveEnd) return false;
      if (summaryRegisterFilter !== 'all' && r.kassaNomi !== summaryRegisterFilter) return false;
      return true;
    });

    const rowMap = new Map<string, CashierSummaryRow>();

    // Seed all registered cashiers so even cashiers with 0 sales in range are visible
    cashiers.forEach(c => {
      rowMap.set(c.id, {
        key: c.id,
        ism: c.ism,
        isRegistered: true,
        asosiyKassa: c.asosiyKassa,
        telefon: c.telefon,
        telegramUsername: c.telegramUsername,
        shiftsCount: 0,
        naqd: 0,
        terminal: 0,
        click: 0,
        qarz: 0,
        firma: 0,
        rasxod: 0,
        jamiHisoblangan: 0,
        chek: 0,
        farq: 0,
        records: []
      });
    });

    // Helper to match a record to a registered cashier by ID first, then case-insensitive name
    const findRegisteredKey = (r: KassaDayRecord): string | null => {
      if (r.kassirId && rowMap.has(r.kassirId)) {
        return r.kassirId;
      }
      const normName = (r.kassirIsmi || '').trim().toLowerCase();
      if (!normName) return null;
      for (const c of cashiers) {
        if ((c.ism || '').trim().toLowerCase() === normName) {
          return c.id;
        }
      }
      return null;
    };

    const totals = {
      shiftsCount: 0,
      naqd: 0,
      terminal: 0,
      click: 0,
      qarz: 0,
      firma: 0,
      rasxod: 0,
      jamiHisoblangan: 0,
      chek: 0,
      farq: 0
    };

    rangeRecords.forEach(r => {
      const t = calculateTotals(r);
      const regKey = findRegisteredKey(r);
      let row: CashierSummaryRow;

      if (regKey) {
        row = rowMap.get(regKey)!;
      } else {
        const rawName = (r.kassirIsmi || '').trim();
        const unregKey = rawName ? `unreg__${rawName.toLowerCase()}` : 'unreg__unknown';
        if (!rowMap.has(unregKey)) {
          rowMap.set(unregKey, {
            key: unregKey,
            ism: rawName || "Kassir ko'rsatilmagan",
            isRegistered: false,
            shiftsCount: 0,
            naqd: 0,
            terminal: 0,
            click: 0,
            qarz: 0,
            firma: 0,
            rasxod: 0,
            jamiHisoblangan: 0,
            chek: 0,
            farq: 0,
            records: []
          });
        }
        row = rowMap.get(unregKey)!;
      }

      row.shiftsCount += 1;
      row.naqd += t.sofNaqd;
      row.terminal += t.terminalJami;
      row.click += t.clickJami;
      row.qarz += t.qarzJami;
      row.firma += t.firmaJami;
      row.rasxod += t.rasxodJami;
      row.jamiHisoblangan += t.jamiHisoblangan;
      row.chek += t.chekdagiSumma;
      row.farq += t.farq;
      row.records.push(r);

      totals.shiftsCount += 1;
      totals.naqd += t.sofNaqd;
      totals.terminal += t.terminalJami;
      totals.click += t.clickJami;
      totals.qarz += t.qarzJami;
      totals.firma += t.firmaJami;
      totals.rasxod += t.rasxodJami;
      totals.jamiHisoblangan += t.jamiHisoblangan;
      totals.chek += t.chekdagiSumma;
      totals.farq += t.farq;
    });

    const list = Array.from(rowMap.values()).sort((a, b) => {
      if (b.jamiHisoblangan !== a.jamiHisoblangan) return b.jamiHisoblangan - a.jamiHisoblangan;
      if (b.chek !== a.chek) return b.chek - a.chek;
      if (b.shiftsCount !== a.shiftsCount) return b.shiftsCount - a.shiftsCount;
      if (a.isRegistered !== b.isRegistered) return a.isRegistered ? -1 : 1;
      return a.ism.localeCompare(b.ism);
    });

    return { cashierSummaries: list, summaryTotals: totals };
  }, [sortedRecords, cashiers, startDate, endDate, summaryRegisterFilter]);

  const topCashier = useMemo(() => {
    return cashierSummaries.find(c => c.shiftsCount > 0 && (c.jamiHisoblangan > 0 || c.chek > 0)) || null;
  }, [cashierSummaries]);

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

  const handleExportCashierSummaryCSV = () => {
    const headers = [
      'Kassir',
      'Holati',
      'Smenalar soni',
      'Naqd Pul',
      'Terminal',
      'Click',
      'Qarzga',
      'Firmaga',
      'Rasxod',
      'Jami Hisoblangan',
      'Chekdagi Savdo',
      'Farq'
    ];

    const rows = cashierSummaries.map(c =>
      [
        `"${c.ism}"`,
        `"${c.isRegistered ? "Ro'yxatdan o'tgan" : "Ro'yxatdan o'tmagan"}"`,
        c.shiftsCount,
        c.naqd,
        c.terminal,
        c.click,
        c.qarz,
        c.firma,
        c.rasxod,
        c.jamiHisoblangan,
        c.chek,
        c.farq
      ].join(',')
    );

    const rangeLabel = `${startDate || 'boshidan'}_${endDate || 'bugun'}`;
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `kassirlar_hisoboti_${rangeLabel}.csv`);
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

  const applyDatePreset = (preset: 'today' | '7days' | 'month' | 'all') => {
    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '7days') {
      setStartDate(shiftDateString(todayStr, -6));
      setEndDate(todayStr);
    } else if (preset === 'month') {
      setStartDate(monthStartStr);
      setEndDate(todayStr);
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Sub-View Switcher */}
      <div className="bg-white rounded-2xl border border-slate-200 p-2 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setViewMode('records')}
            className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'records'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListChecks className="w-4 h-4 text-emerald-600" />
            <span>Kunlik Yozuvlar ({records.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cashiers')}
            className={`flex-1 sm:flex-initial px-4 py-2 text-xs font-bold rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'cashiers'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4 text-blue-600" />
            <span>Kassirlar Hisoboti ({cashiers.length})</span>
          </button>
        </div>

        <span className="text-[11px] text-slate-500 px-2 hidden md:inline">
          {viewMode === 'records'
            ? "Barcha kunlar va smenalar bo'yicha batafsil arxiv"
            : "Tanlangan sanalar oralig'ida har bir kassirning umumiy savdo hisoboti"}
        </span>
      </div>

      {viewMode === 'cashiers' ? (
        <>
          {/* Date Range Filter & Export Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Kassirlar Bo&apos;yicha Savdo Hisoboti</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tanlangan sana oralig&apos;ida har bir ro&apos;yxatdan o&apos;tgan kassirning umumiy savdosi
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportCashierSummaryCSV}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Hisobotni Excel (CSV)</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Boshlanish sanasi (Dan)
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full bg-transparent focus:outline-hidden cursor-pointer"
                  />
                </div>
              </div>

              <div className="md:col-span-3">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Tugash sanasi (Gacha)
                </label>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full bg-transparent focus:outline-hidden cursor-pointer"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                  Kassa filtri
                </label>
                <select
                  value={summaryRegisterFilter}
                  onChange={e => setSummaryRegisterFilter(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden"
                >
                  <option value="all">Barcha kassalar</option>
                  {uniqueRegisters.map(reg => (
                    <option key={reg} value={reg}>{reg}</option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-4 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => applyDatePreset('today')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                    startDate === todayStr && endDate === todayStr
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  Bugun
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('7days')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                    startDate === shiftDateString(todayStr, -6) && endDate === todayStr
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  7 kun
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('month')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                    startDate === monthStartStr && endDate === todayStr
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  Shu oy
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset('all')}
                  className={`px-3 py-2 text-xs font-bold rounded-xl border transition cursor-pointer ${
                    !startDate && !endDate
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  Hammasi
                </button>
              </div>
            </div>
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase block">Ro&apos;yxatdagi Kassirlar</span>
              <span className="text-xl font-extrabold text-slate-900 mt-1 block">{cashiers.length} nafar</span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Jami smenalar: <strong>{summaryTotals.shiftsCount} ta</strong>
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase block">Jami Hisoblangan Savdo</span>
              <span className="text-xl font-extrabold mono text-emerald-700 mt-1 block">
                {formatMoney(summaryTotals.jamiHisoblangan)}
              </span>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                Naqd + Terminal + Click + Qarz + Firma
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase block">Chekdagi Umumiy Savdo</span>
              <span className="text-xl font-extrabold mono text-slate-900 mt-1 block">
                {formatMoney(summaryTotals.chek)}
              </span>
              <span className={`text-[11px] font-bold mt-0.5 block mono ${
                summaryTotals.farq < 0 ? 'text-rose-600' : summaryTotals.farq > 0 ? 'text-blue-600' : 'text-emerald-600'
              }`}>
                Farq: {summaryTotals.farq > 0 ? '+' : ''}{formatMoney(summaryTotals.farq)}
              </span>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <Award className="w-3.5 h-3.5 text-amber-500" />
                Eng Ko&apos;p Savdo Qilgan
              </span>
              {topCashier ? (
                <>
                  <span className="text-lg font-extrabold text-slate-900 mt-1 block truncate">
                    {topCashier.ism}
                  </span>
                  <span className="text-[11px] font-bold mono text-emerald-700 mt-0.5 block">
                    {formatMoney(topCashier.jamiHisoblangan)} ({topCashier.shiftsCount} smena)
                  </span>
                </>
              ) : (
                <span className="text-sm font-semibold text-slate-400 mt-2 block">Savdo ma&apos;lumoti yo&apos;q</span>
              )}
            </div>
          </div>

          {/* Cashier Sales Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            {cashierSummaries.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Users className="w-10 h-10 mx-auto text-slate-300 mb-2 stroke-1" />
                <p className="text-sm font-semibold text-slate-600">Hali ro&apos;yxatdan o&apos;tgan kassirlar yo&apos;q</p>
                <p className="text-xs text-slate-400 mt-1">
                  Kassirlar ro&apos;yxatdan o&apos;tib kassa yopganidan so&apos;ng umumiy savdo hisoboti shu yerda chiqadi
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Kassir</th>
                      <th className="py-3 px-3 text-center">Smena</th>
                      <th className="py-3 px-3 text-right">Naqd</th>
                      <th className="py-3 px-3 text-right">Terminal</th>
                      <th className="py-3 px-3 text-right">Click</th>
                      <th className="py-3 px-3 text-right">Qarzga</th>
                      <th className="py-3 px-3 text-right">Firmaga</th>
                      <th className="py-3 px-3 text-right">Rasxod</th>
                      <th className="py-3 px-3 text-right">Jami Hisoblangan</th>
                      <th className="py-3 px-3 text-right">Chek Savdo</th>
                      <th className="py-3 px-3 text-center">Farq</th>
                      <th className="py-3 px-4 text-right">Tafsilot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashierSummaries.map(row => {
                      const isExpanded = expandedCashierKey === row.key;
                      const sharePct =
                        summaryTotals.jamiHisoblangan > 0
                          ? Math.round((row.jamiHisoblangan / summaryTotals.jamiHisoblangan) * 100)
                          : 0;

                      return (
                        <React.Fragment key={row.key}>
                          <tr className={`hover:bg-slate-50 transition-colors ${row.shiftsCount === 0 ? 'opacity-65' : ''}`}>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                                  row.isRegistered ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {row.ism.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                    <span>{row.ism}</span>
                                    {row.isRegistered ? (
                                      <span title="Ro'yxatdan o'tgan kassir" className="inline-flex">
                                        <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                                      </span>
                                    ) : (
                                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                        Ro&apos;yxatda yo&apos;q
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                                    {row.asosiyKassa && <span>{row.asosiyKassa}</span>}
                                    {sharePct > 0 && <span>· {sharePct}% ulush</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-center">
                              <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-800 font-bold">
                                {row.shiftsCount}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-right mono font-semibold text-emerald-700">
                              {formatMoney(row.naqd)}
                            </td>
                            <td className="py-3 px-3 text-right mono text-blue-700">
                              {formatMoney(row.terminal)}
                            </td>
                            <td className="py-3 px-3 text-right mono text-indigo-700">
                              {formatMoney(row.click)}
                            </td>
                            <td className="py-3 px-3 text-right mono text-amber-700">
                              {formatMoney(row.qarz)}
                            </td>
                            <td className="py-3 px-3 text-right mono text-orange-700">
                              {formatMoney(row.firma)}
                            </td>
                            <td className="py-3 px-3 text-right mono text-rose-700">
                              {formatMoney(row.rasxod)}
                            </td>
                            <td className="py-3 px-3 text-right mono font-extrabold text-slate-900">
                              {formatMoney(row.jamiHisoblangan)}
                            </td>
                            <td className="py-3 px-3 text-right mono font-bold text-slate-700">
                              {formatMoney(row.chek)}
                            </td>
                            <td className="py-3 px-3 text-center">
                              {row.shiftsCount === 0 || (row.chek === 0 && row.jamiHisoblangan === 0) ? (
                                <span className="text-slate-400 text-[11px]">-</span>
                              ) : row.farq === 0 ? (
                                <span className="inline-flex items-center text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                                  0 so&apos;m ✓
                                </span>
                              ) : row.farq < 0 ? (
                                <span className="inline-flex items-center text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded mono">
                                  Kam: {formatMoney(Math.abs(row.farq))}
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[11px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded mono">
                                  +{formatMoney(row.farq)}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              {row.records.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setExpandedCashierKey(isExpanded ? null : row.key)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg cursor-pointer"
                                >
                                  <span>{isExpanded ? 'Yopish' : 'Kunlar'}</span>
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">Bo&apos;sh</span>
                              )}
                            </td>
                          </tr>

                          {isExpanded && row.records.length > 0 && (
                            <tr className="bg-slate-50/80">
                              <td colSpan={12} className="p-3 sm:px-6">
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 uppercase mb-1">
                                    <span>{row.ism} — Tanlangan davrdagi smenalari ({row.records.length} ta)</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCashierFilter(row.ism);
                                        setViewMode('records');
                                      }}
                                      className="text-emerald-700 hover:underline cursor-pointer normal-case"
                                    >
                                      Arxivda alohida ochish →
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {row.records.map(rec => {
                                      const rt = calculateTotals(rec);
                                      return (
                                        <div
                                          key={rec.id}
                                          className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2"
                                        >
                                          <div>
                                            <div className="font-bold text-slate-900 text-xs">{formatUzbekDate(rec.date)}</div>
                                            <div className="text-[11px] text-slate-500">
                                              {rec.kassaNomi} · Chek: <span className="mono font-semibold">{formatMoney(rt.chekdagiSumma)}</span>
                                            </div>
                                            <div className="text-[11px] text-emerald-700 font-bold mono">
                                              Jami: {formatMoney(rt.jamiHisoblangan)}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => onOpenRecord(rec)}
                                            className="px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg cursor-pointer shrink-0 inline-flex items-center gap-1"
                                          >
                                            Ochish
                                            <ArrowRight className="w-3 h-3" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-extrabold text-slate-900">
                      <td className="py-3 px-4">JAMI ({cashierSummaries.length} ta)</td>
                      <td className="py-3 px-3 text-center">{summaryTotals.shiftsCount}</td>
                      <td className="py-3 px-3 text-right mono text-emerald-700">{formatMoney(summaryTotals.naqd)}</td>
                      <td className="py-3 px-3 text-right mono text-blue-700">{formatMoney(summaryTotals.terminal)}</td>
                      <td className="py-3 px-3 text-right mono text-indigo-700">{formatMoney(summaryTotals.click)}</td>
                      <td className="py-3 px-3 text-right mono text-amber-700">{formatMoney(summaryTotals.qarz)}</td>
                      <td className="py-3 px-3 text-right mono text-orange-700">{formatMoney(summaryTotals.firma)}</td>
                      <td className="py-3 px-3 text-right mono text-rose-700">{formatMoney(summaryTotals.rasxod)}</td>
                      <td className="py-3 px-3 text-right mono">{formatMoney(summaryTotals.jamiHisoblangan)}</td>
                      <td className="py-3 px-3 text-right mono">{formatMoney(summaryTotals.chek)}</td>
                      <td className={`py-3 px-3 text-center mono ${
                        summaryTotals.farq < 0 ? 'text-rose-600' : summaryTotals.farq > 0 ? 'text-blue-600' : 'text-emerald-600'
                      }`}>
                        {summaryTotals.farq > 0 ? '+' : ''}{formatMoney(summaryTotals.farq)}
                      </td>
                      <td className="py-3 px-4" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Top Search & Filter Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Saqlangan Kassa Ma&apos;lumotlari va Qidiruv</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Istalgan sana, firma nomi, qarzdor ismi yoki rasxod bo&apos;yicha qidiring va qayta oching
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
                  <option value="togri">To&apos;g&apos;ri (0)</option>
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
                  &quot;{searchQuery}&quot; bo&apos;yicha topilgan alohida yozuvlar ({matchedLineItems.length} ta)
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
                <p className="text-sm font-semibold text-slate-600">Saqlangan ma&apos;lumotlar topilmadi</p>
                <p className="text-xs text-slate-400 mt-1">
                  Kunlik kassani kiritib saqlaganingizda barcha kunlar shu yerda saqlanib boradi
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[11px]">
                      <th className="py-3 px-4">Sana &amp; Kassa</th>
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
                                To&apos;g&apos;ri (0)
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
        </>
      )}
    </div>
  );
};
