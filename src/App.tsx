import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Store,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Calculator,
  Printer,
  Copy,
  Check,
  Send,
  Lock,
  Unlock,
  RotateCcw,
  Search,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  BellRing,
  User,
  Smartphone
} from 'lucide-react';
import { CashierProfile, KassaDayRecord, SimpleEntry } from './types/kassa';
import {
  createEmptyRecord,
  calculateTotals,
  loadLocalRecords,
  saveLocalRecords,
  loadRegisters,
  saveRegisters,
  fetchRecordsFromServer,
  saveRecordToServer,
  deleteRecordFromServer,
  bulkSaveRecordsToServer,
  loadLocalCashiers,
  saveLocalCashiers,
  loadActiveCashierId,
  saveActiveCashierId,
  fetchCashiersFromServer,
  registerCashierOnServer,
  deleteCashierFromServer
} from './utils/storage';
import {
  formatMoney,
  formatNumber,
  formatUzbekDate,
  getCurrentTime,
  getTodayDateString,
  generatePlainReportText
} from './utils/format';
import {
  TelegramConfig,
  loadTelegramConfig,
  saveTelegramConfig,
  fetchTelegramConfigFromServer,
  sendTelegramMessage,
  formatKassaOchishMessage,
  formatKassaYopishHtml,
  formatNewCashierHtml
} from './utils/telegram';
import {
  initTelegramMiniApp,
  isTelegramMiniApp,
  hapticSuccess,
  hapticImpact,
  TelegramMiniAppUser
} from './utils/telegramWebApp';
import { BillCounterModal } from './components/BillCounterModal';
import { TelegramSettingsModal } from './components/TelegramSettingsModal';
import { ArchiveSearchView } from './components/ArchiveSearchView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { CashierAuthModal } from './components/CashierAuthModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<'kassa' | 'arxiv'>('kassa');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateString());
  const [registers, setRegisters] = useState<string[]>(() => loadRegisters());
  const [selectedRegister, setSelectedRegister] = useState<string>(() => loadRegisters()[0] || '1-Kassa');

  // All saved records across dates & registers
  const [records, setRecords] = useState<KassaDayRecord[]>(() => loadLocalRecords());
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  // Telegram configuration
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>(() => loadTelegramConfig());
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false);
  const [sendingTelegram, setSendingTelegram] = useState(false);

  // Telegram Mini App & Registered Cashiers
  const [tgUser, setTgUser] = useState<TelegramMiniAppUser | null>(null);
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [cashiers, setCashiers] = useState<CashierProfile[]>(() => loadLocalCashiers());
  const [activeCashierId, setActiveCashierId] = useState<string | null>(() => loadActiveCashierId());
  const [isCashierModalOpen, setIsCashierModalOpen] = useState(false);

  const activeCashier = useMemo(
    () => cashiers.find(c => c.id === activeCashierId) || null,
    [cashiers, activeCashierId]
  );

  // Modals
  const [isBillCounterOpen, setIsBillCounterOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isAddRegisterOpen, setIsAddRegisterOpen] = useState(false);
  const [newRegisterName, setNewRegisterName] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Notification Toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Inline quick-add form states
  const [terminalAddSum, setTerminalAddSum] = useState('');
  const [terminalAddName, setTerminalAddName] = useState('');

  const [clickAddSum, setClickAddSum] = useState('');
  const [clickAddName, setClickAddName] = useState('');

  const [qarzName, setQarzName] = useState('');
  const [qarzSum, setQarzSum] = useState('');

  const [firmaName, setFirmaName] = useState('');
  const [firmaSum, setFirmaSum] = useState('');

  const [rasxodName, setRasxodName] = useState('');
  const [rasxodSum, setRasxodSum] = useState('');

  // Show/hide optional sdacha & rasxod section helper
  const [showSdacha, setShowSdacha] = useState(false);

  // Load initial data from server & init Telegram Mini App
  useEffect(() => {
    let mounted = true;
    const miniAppUser = initTelegramMiniApp();
    const insideMiniApp = isTelegramMiniApp();
    if (miniAppUser) setTgUser(miniAppUser);
    setIsMiniApp(insideMiniApp);

    (async () => {
      const [serverRecords, serverTg, serverCashiers] = await Promise.all([
        fetchRecordsFromServer(),
        fetchTelegramConfigFromServer(),
        fetchCashiersFromServer()
      ]);

      if (mounted && serverRecords && serverRecords.length > 0) {
        setRecords(prev => {
          const map = new Map<string, KassaDayRecord>();
          prev.forEach(r => map.set(r.id, r));
          serverRecords.forEach(r => {
            const existing = map.get(r.id);
            if (!existing || (r.updatedAt || '') >= (existing.updatedAt || '')) {
              map.set(r.id, r);
            }
          });
          const merged = Array.from(map.values());
          saveLocalRecords(merged);
          return merged;
        });
      } else if (mounted) {
        const local = loadLocalRecords();
        if (local.length > 0) {
          bulkSaveRecordsToServer(local);
        }
      }

      if (mounted && serverTg && serverTg.botToken) {
        setTelegramConfig(prev => {
          const merged = {
            ...serverTg,
            ...prev,
            botToken: prev.botToken || serverTg.botToken,
            chatId: prev.chatId || serverTg.chatId,
            enabled: Boolean((prev.botToken || serverTg.botToken) && (prev.chatId || serverTg.chatId)),
            miniAppUrl: serverTg.miniAppUrl ?? prev.miniAppUrl
          };
          return merged;
        });
      }

      if (mounted) {
        const effectiveCashiers = serverCashiers || loadLocalCashiers();
        if (serverCashiers) {
          setCashiers(serverCashiers);
          saveLocalCashiers(serverCashiers);
        }

        const savedId = loadActiveCashierId();
        let matched = savedId ? effectiveCashiers.find(c => c.id === savedId) : undefined;

        // Auto-match cashier by Telegram ID if opened in Telegram Mini App
        if (!matched && miniAppUser) {
          matched = effectiveCashiers.find(c => c.telegramId === String(miniAppUser.id));
        }

        if (matched) {
          setActiveCashierId(matched.id);
          saveActiveCashierId(matched.id);
        } else {
          setActiveCashierId(null);
          saveActiveCashierId(null);
          setIsCashierModalOpen(true);
        }
      }
    })();

    // Background live sync so reports submitted from phone Telegram Bot appear immediately
    const liveSyncTimer = window.setInterval(async () => {
      if (!mounted || document.hidden) return;
      const [srvRecords, srvCashiers] = await Promise.all([
        fetchRecordsFromServer(),
        fetchCashiersFromServer()
      ]);
      if (!mounted) return;
      if (srvRecords && srvRecords.length > 0) {
        setRecords(prev => {
          const map = new Map<string, KassaDayRecord>();
          prev.forEach(r => map.set(r.id, r));
          let changed = false;
          srvRecords.forEach(r => {
            const existing = map.get(r.id);
            if (!existing || (r.updatedAt || '') > (existing.updatedAt || '')) {
              map.set(r.id, r);
              changed = true;
            }
          });
          if (!changed) return prev;
          const merged = Array.from(map.values());
          saveLocalRecords(merged);
          return merged;
        });
      }
      if (srvCashiers) {
        setCashiers(prev => {
          if (JSON.stringify(prev) === JSON.stringify(srvCashiers)) return prev;
          saveLocalCashiers(srvCashiers);
          return srvCashiers;
        });
      }
    }, 8000);

    const handleOnlineSync = async () => {
      const local = loadLocalRecords();
      if (local.length > 0) {
        const ok = await bulkSaveRecordsToServer(local);
        if (ok && mounted) {
          showToast("Internet ulandi — oflayn ma'lumotlar serverga saqlandi ✓");
        }
      }
    };

    window.addEventListener('online', handleOnlineSync);
    return () => {
      mounted = false;
      window.clearInterval(liveSyncTimer);
      window.removeEventListener('online', handleOnlineSync);
    };
  }, []);

  // Current active day + register record
  const currentId = `${selectedDate}__${selectedRegister}`;
  const currentRecord: KassaDayRecord = useMemo(() => {
    const found = records.find(r => r.id === currentId);
    if (found) return found;
    return createEmptyRecord(
      selectedDate,
      selectedRegister,
      activeCashier?.ism || telegramConfig.kassirIsmi || '',
      activeCashier?.id
    );
  }, [records, currentId, selectedDate, selectedRegister, activeCashier, telegramConfig.kassirIsmi]);

  useEffect(() => {
    if (currentRecord.ertalabkiSdacha > 0) {
      setShowSdacha(true);
    }
  }, [currentId, currentRecord.ertalabkiSdacha]);

  const totals = useMemo(() => calculateTotals(currentRecord), [currentRecord]);

  // Debounced auto-save to server + immediate local save
  const saveTimerRef = useRef<number | null>(null);
  const updateCurrentRecord = (patch: Partial<KassaDayRecord>) => {
    const updated: KassaDayRecord = {
      ...currentRecord,
      ...patch,
      id: currentId,
      date: selectedDate,
      kassaNomi: selectedRegister,
      updatedAt: new Date().toISOString()
    };

    setRecords(prev => {
      const exists = prev.some(r => r.id === updated.id);
      const next = exists ? prev.map(r => (r.id === updated.id ? updated : r)) : [updated, ...prev];
      saveLocalRecords(next);
      return next;
    });

    setSaveStatus('saving');
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(async () => {
      await saveRecordToServer(updated);
      setSaveStatus('saved');
    }, 350);
  };

  // Explicit Save Button
  const handleExplicitSave = async () => {
    setSaveStatus('saving');
    const updated: KassaDayRecord = {
      ...currentRecord,
      id: currentId,
      date: selectedDate,
      kassaNomi: selectedRegister,
      updatedAt: new Date().toISOString()
    };
    setRecords(prev => {
      const exists = prev.some(r => r.id === updated.id);
      const next = exists ? prev.map(r => (r.id === updated.id ? updated : r)) : [updated, ...prev];
      saveLocalRecords(next);
      return next;
    });
    const ok = await saveRecordToServer(updated);
    setSaveStatus('saved');
    showToast(ok ? "Ma'lumotlar serverga va xotiraga saqlandi! ✓" : "Brauzer xotirasiga saqlandi ✓");
  };

  // Date navigation
  const changeDateBy = (delta: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, '0');
    const nd = String(dt.getDate()).padStart(2, '0');
    setSelectedDate(`${ny}-${nm}-${nd}`);
  };

  // Add new custom register (e.g. 3-Kassa)
  const handleAddRegister = () => {
    setNewRegisterName('');
    setIsAddRegisterOpen(true);
  };

  const handleConfirmAddRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newRegisterName.trim();
    if (!clean) return;
    if (!registers.includes(clean)) {
      const next = [...registers, clean];
      setRegisters(next);
      saveRegisters(next);
    }
    setSelectedRegister(clean);
    setIsAddRegisterOpen(false);
    showToast(`${clean} qo'shildi ✓`);
  };

  // Helper to parse positive int from string
  const parseAmount = (val: string) => parseInt(val.replace(/\D/g, ''), 10) || 0;

  // 2. Terminal add item
  const handleAddTerminalItem = (e: React.FormEvent) => {
    e.preventDefault();
    const sum = parseAmount(terminalAddSum);
    if (sum <= 0) return;
    const existingList = [...(currentRecord.terminalList || [])];
    if (existingList.length === 0 && currentRecord.terminalSumma > 0) {
      existingList.push({
        id: `term-init-${Date.now()}`,
        nomi: 'Terminal (asosiy)',
        summa: currentRecord.terminalSumma,
        vaqt: getCurrentTime()
      });
    }
    existingList.push({
      id: `term-${Date.now()}`,
      nomi: terminalAddName.trim() || `Terminal ${existingList.length + 1}`,
      summa: sum,
      vaqt: getCurrentTime()
    });
    updateCurrentRecord({
      terminalList: existingList,
      terminalSumma: existingList.reduce((s, x) => s + x.summa, 0)
    });
    setTerminalAddSum('');
    setTerminalAddName('');
  };

  const handleDeleteTerminalItem = (id: string) => {
    const nextList = (currentRecord.terminalList || []).filter(x => x.id !== id);
    updateCurrentRecord({
      terminalList: nextList,
      terminalSumma: nextList.reduce((s, x) => s + x.summa, 0)
    });
  };

  // 3. Click add item
  const handleAddClickItem = (e: React.FormEvent) => {
    e.preventDefault();
    const sum = parseAmount(clickAddSum);
    if (sum <= 0) return;
    const existingList = [...(currentRecord.clickList || [])];
    if (existingList.length === 0 && currentRecord.clickSumma > 0) {
      existingList.push({
        id: `clk-init-${Date.now()}`,
        nomi: 'Click (asosiy)',
        summa: currentRecord.clickSumma,
        vaqt: getCurrentTime()
      });
    }
    existingList.push({
      id: `clk-${Date.now()}`,
      nomi: clickAddName.trim() || `Click ${existingList.length + 1}`,
      summa: sum,
      vaqt: getCurrentTime()
    });
    updateCurrentRecord({
      clickList: existingList,
      clickSumma: existingList.reduce((s, x) => s + x.summa, 0)
    });
    setClickAddSum('');
    setClickAddName('');
  };

  const handleDeleteClickItem = (id: string) => {
    const nextList = (currentRecord.clickList || []).filter(x => x.id !== id);
    updateCurrentRecord({
      clickList: nextList,
      clickSumma: nextList.reduce((s, x) => s + x.summa, 0)
    });
  };

  // 4. Qarzga add/delete
  const handleAddQarz = (e: React.FormEvent) => {
    e.preventDefault();
    const sum = parseAmount(qarzSum);
    if (sum <= 0) return;
    const item: SimpleEntry = {
      id: `qarz-${Date.now()}`,
      nomi: qarzName.trim() || `Qarz #${currentRecord.qarzList.length + 1}`,
      summa: sum,
      vaqt: getCurrentTime()
    };
    updateCurrentRecord({ qarzList: [item, ...currentRecord.qarzList] });
    setQarzName('');
    setQarzSum('');
  };

  const handleDeleteQarz = (id: string) => {
    updateCurrentRecord({ qarzList: currentRecord.qarzList.filter(x => x.id !== id) });
  };

  // 5. Firmaga add/delete
  const handleAddFirma = (e: React.FormEvent) => {
    e.preventDefault();
    const sum = parseAmount(firmaSum);
    if (sum <= 0) return;
    const item: SimpleEntry = {
      id: `firma-${Date.now()}`,
      nomi: firmaName.trim() || `Firma #${currentRecord.firmaList.length + 1}`,
      summa: sum,
      vaqt: getCurrentTime()
    };
    updateCurrentRecord({ firmaList: [item, ...currentRecord.firmaList] });
    setFirmaName('');
    setFirmaSum('');
  };

  const handleDeleteFirma = (id: string) => {
    updateCurrentRecord({ firmaList: currentRecord.firmaList.filter(x => x.id !== id) });
  };

  // 6. Rasxod add/delete
  const handleAddRasxod = (e: React.FormEvent) => {
    e.preventDefault();
    const sum = parseAmount(rasxodSum);
    if (sum <= 0) return;
    const item: SimpleEntry = {
      id: `rasxod-${Date.now()}`,
      nomi: rasxodName.trim() || `Rasxod #${currentRecord.rasxodList.length + 1}`,
      summa: sum,
      vaqt: getCurrentTime()
    };
    updateCurrentRecord({ rasxodList: [item, ...currentRecord.rasxodList] });
    setRasxodName('');
    setRasxodSum('');
  };

  const handleDeleteRasxod = (id: string) => {
    updateCurrentRecord({ rasxodList: currentRecord.rasxodList.filter(x => x.id !== id) });
  };

  // Open Shift & Notify Telegram
  const handleOpenShift = async () => {
    const vaqt = getCurrentTime();
    const updated: KassaDayRecord = {
      ...currentRecord,
      isOchiq: true,
      ochilganVaqt: vaqt
    };
    updateCurrentRecord(updated);
    await saveRecordToServer(updated);

    if (telegramConfig.enabled && telegramConfig.autoSendOnOpen) {
      setSendingTelegram(true);
      const html = formatKassaOchishMessage({
        kassaNomi: selectedRegister,
        kassirIsmi: currentRecord.kassirIsmi || telegramConfig.kassirIsmi,
        sana: formatUzbekDate(selectedDate),
        vaqt,
        ertalabkiSdacha: currentRecord.ertalabkiSdacha
      });
      const res = await sendTelegramMessage(
        telegramConfig.botToken,
        telegramConfig.chatId,
        html,
        telegramConfig.botUsername
      );
      setSendingTelegram(false);
      if (res.ok) {
        showToast(`${selectedRegister} ochildi va adminga Telegramdan xabar ketdi! 🟢`);
      } else {
        showToast(`Kassa ochildi, lekin Telegram xatosi: ${res.description}`, 'error');
      }
    } else {
      showToast(`${selectedRegister} ochildi! 🟢`);
    }
  };

  // Close Shift & Send Z-Report to Telegram
  const handleCloseShiftAndSend = async () => {
    const vaqt = getCurrentTime();
    const updated: KassaDayRecord = {
      ...currentRecord,
      isOchiq: false,
      yopilganVaqt: vaqt,
      updatedAt: new Date().toISOString()
    };
    updateCurrentRecord(updated);
    await saveRecordToServer(updated);

    if (telegramConfig.enabled) {
      setSendingTelegram(true);
      const html = formatKassaYopishHtml(updated, formatUzbekDate(selectedDate), vaqt);
      const res = await sendTelegramMessage(
        telegramConfig.botToken,
        telegramConfig.chatId,
        html,
        telegramConfig.botUsername
      );
      setSendingTelegram(false);
      if (res.ok) {
        showToast(`${selectedRegister} yopildi va to'liq hisobot adminga yuborildi! 🔒✅`);
      } else {
        showToast(`Saqlandi, lekin Telegram xatosi: ${res.description}`, 'error');
      }
    } else {
      showToast(`${selectedRegister} yopildi va saqlandi! 🔒 (Bot ulanmagan)`);
    }
  };

  // Copy plain text report
  const handleCopyText = () => {
    const text = generatePlainReportText(currentRecord);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Reset current day to 0
  const handleResetDay = () => {
    setConfirmDialog({
      title: "Kunlik yozuvni tozalash",
      message: `${selectedDate} (${selectedRegister}) ma'lumotlarini 0 ga tushirmoqchimisiz?`,
      onConfirm: () => {
        const fresh = createEmptyRecord(
          selectedDate,
          selectedRegister,
          activeCashier?.ism || currentRecord.kassirIsmi,
          activeCashier?.id
        );
        updateCurrentRecord(fresh);
        showToast("Kunlik yozuvlar tozalandi (0 qilindi)", 'info');
        setConfirmDialog(null);
      }
    });
  };

  // Delete from Archive
  const handleDeleteArchiveRecord = (id: string) => {
    setConfirmDialog({
      title: "Yozuvni o'chirish",
      message: "Ushbu kun yozuvini butunlay o'chirmoqchimisiz?",
      onConfirm: async () => {
        setRecords(prev => {
          const next = prev.filter(r => r.id !== id);
          saveLocalRecords(next);
          return next;
        });
        await deleteRecordFromServer(id);
        showToast("Yozuv o'chirildi", 'info');
        setConfirmDialog(null);
      }
    });
  };

  // Import records
  const handleImportRecords = async (imported: KassaDayRecord[]) => {
    setRecords(imported);
    saveLocalRecords(imported);
    await bulkSaveRecordsToServer(imported);
    showToast(`${imported.length} ta kunlik yozuv tiklandi va serverga saqlandi! ✓`);
  };

  // Register new cashier or log in as existing
  const handleRegisterCashier = async (payload: {
    ism: string;
    telefon?: string;
    asosiyKassa?: string;
  }): Promise<{ ok: boolean; error?: string }> => {
    const res = await registerCashierOnServer({
      ism: payload.ism,
      telefon: payload.telefon,
      asosiyKassa: payload.asosiyKassa,
      telegramId: tgUser ? String(tgUser.id) : undefined,
      telegramUsername: tgUser?.username
    });

    if (!res.ok || !res.cashier) {
      return { ok: false, error: res.error || "Ro'yxatdan o'tishda xatolik!" };
    }

    const updatedList = res.cashiers || [res.cashier, ...cashiers];
    setCashiers(updatedList);
    saveLocalCashiers(updatedList);
    setActiveCashierId(res.cashier.id);
    saveActiveCashierId(res.cashier.id);
    setIsCashierModalOpen(false);
    hapticSuccess();

    if (res.cashier.asosiyKassa && registers.includes(res.cashier.asosiyKassa)) {
      setSelectedRegister(res.cashier.asosiyKassa);
    }

    if (currentRecord.isOchiq || !currentRecord.kassirIsmi) {
      updateCurrentRecord({
        kassirIsmi: res.cashier.ism,
        kassirId: res.cashier.id
      });
    }

    showToast(
      res.isNew
        ? `Xush kelibsiz, ${res.cashier.ism}! Ro'yxatdan o'tdingiz ✓`
        : `Tizimga kirdingiz: ${res.cashier.ism} ✓`
    );

    if (res.isNew && telegramConfig.enabled) {
      const html = formatNewCashierHtml({
        ism: res.cashier.ism,
        telefon: res.cashier.telefon,
        asosiyKassa: res.cashier.asosiyKassa,
        telegramUsername: res.cashier.telegramUsername,
        vaqt: getCurrentTime()
      });
      sendTelegramMessage(
        telegramConfig.botToken,
        telegramConfig.chatId,
        html,
        telegramConfig.botUsername
      );
    }

    return { ok: true };
  };

  const handleSelectCashier = (cashier: CashierProfile) => {
    setActiveCashierId(cashier.id);
    saveActiveCashierId(cashier.id);
    setIsCashierModalOpen(false);
    hapticImpact();
    if (cashier.asosiyKassa && registers.includes(cashier.asosiyKassa)) {
      setSelectedRegister(cashier.asosiyKassa);
    }
    if (currentRecord.isOchiq || !currentRecord.kassirIsmi) {
      updateCurrentRecord({
        kassirIsmi: cashier.ism,
        kassirId: cashier.id
      });
    }
    showToast(`Kassir tanlandi: ${cashier.ism} ✓`);
  };

  const handleDeleteCashier = (id: string) => {
    const target = cashiers.find(c => c.id === id);
    if (!target) return;
    setConfirmDialog({
      title: "Kassirni o'chirish",
      message: `${target.ism} ni kassirlar ro'yxatidan o'chirmoqchimisiz?`,
      onConfirm: async () => {
        const serverList = await deleteCashierFromServer(id);
        const next = serverList || cashiers.filter(c => c.id !== id);
        setCashiers(next);
        saveLocalCashiers(next);
        showToast(`${target.ism} ro'yxatdan o'chirildi`, 'info');
        setConfirmDialog(null);
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl border text-xs font-bold max-w-sm ${
          toast.type === 'error'
            ? 'bg-rose-900 text-white border-rose-700'
            : toast.type === 'info'
            ? 'bg-slate-900 text-white border-slate-700'
            : 'bg-emerald-900 text-white border-emerald-700'
        }`}>
          <BellRing className="w-4 h-4 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}

      <OfflineIndicator />

      {/* Main Header (Hidden when printing) */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-slate-900 leading-none">
                  Navo Market <span className="text-emerald-600">Kassa</span>
                </h1>
                {isMiniApp && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-md inline-flex items-center gap-0.5">
                    <Smartphone className="w-2.5 h-2.5" />
                    Mini App
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">
                {saveStatus === 'saving' ? 'Saqlanmoqda...' : '✓ Barcha ma\'lumotlar saqlangan'}
              </span>
            </div>
          </div>

          {/* Zone 2: Navigation Tabs */}
          <nav className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('kassa')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap ${
                activeTab === 'kassa'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bugungi Kassa
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('arxiv')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                activeTab === 'arxiv'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              Saqlanganlar ({records.length})
            </button>
          </nav>

          {/* Zone 3: PWA Install, Telegram & Receipt Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setIsTelegramModalOpen(true)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                telegramConfig.enabled
                  ? 'bg-blue-50 border-blue-200 text-blue-800 hover:bg-blue-100'
                  : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>{telegramConfig.enabled ? 'Bot Ulangan ✓' : 'Botni Ulash'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsReceiptModalOpen(true)}
              className="px-3.5 py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Chek / Z-Hisobot</span>
            </button>
          </div>
        </div>

        {/* Sub-bar: Date, Register Selector & Cashier (only on kassa tab) */}
        {activeTab === 'kassa' && (
          <div className="border-t border-slate-100 bg-slate-50/90 px-4 sm:px-6 py-2.5">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
              {/* Date & Register */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changeDateBy(-1)}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                    title="Oldingi kun"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={e => e.target.value && setSelectedDate(e.target.value)}
                      className="bg-transparent focus:outline-hidden cursor-pointer"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => changeDateBy(1)}
                    className="p-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-600 cursor-pointer"
                    title="Keyingi kun"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  {selectedDate !== getTodayDateString() && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(getTodayDateString())}
                      className="px-2.5 py-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                    >
                      Bugun
                    </button>
                  )}
                </div>

                <span className="hidden md:inline text-xs font-medium text-slate-500 ml-1">
                  {formatUzbekDate(selectedDate)}
                </span>
              </div>

              {/* Register Selector + Cashier + Shift Status */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Register Picker */}
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                  {registers.map(reg => (
                    <button
                      key={reg}
                      type="button"
                      onClick={() => setSelectedRegister(reg)}
                      className={`px-2.5 py-1 text-xs font-bold rounded-md transition cursor-pointer ${
                        selectedRegister === reg
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {reg}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddRegister}
                    title="Yangi kassa qo'shish"
                    className="px-2 py-1 text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                  >
                    +
                  </button>
                </div>

                {/* Active Cashier Profile / Switcher */}
                <button
                  type="button"
                  onClick={() => setIsCashierModalOpen(true)}
                  className="px-3 py-1.5 text-xs font-bold bg-white hover:bg-emerald-50 text-slate-800 border border-slate-200 hover:border-emerald-300 rounded-lg flex items-center gap-1.5 cursor-pointer transition"
                  title="Kassirni almashtirish yoki yangi kassir ro'yxatdan o'tkazish"
                >
                  <User className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{currentRecord.kassirIsmi || activeCashier?.ism || "Kassir kirish"}</span>
                  <span className="text-[10px] text-emerald-700 font-semibold ml-0.5">· Almashtirish</span>
                </button>

                {/* Open / Close Shift toggle */}
                {currentRecord.isOchiq ? (
                  <button
                    type="button"
                    onClick={handleOpenShift}
                    disabled={sendingTelegram}
                    className="px-3 py-1 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg flex items-center gap-1 cursor-pointer transition"
                    title="Kassa ochilgani haqida adminga xabar yuborish"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>Ochiq · Adminga bildirish</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateCurrentRecord({ isOchiq: true })}
                    className="px-3 py-1 text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg flex items-center gap-1 cursor-pointer transition"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Yopilgan (Qayta ochish)</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResetDay}
                  title="Bugungi summani 0 ga tushirish"
                  className="p-1.5 text-slate-400 hover:text-rose-600 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 no-print">
        {activeTab === 'kassa' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* ============================================================== */}
            {/* CHAP TOMON (7 ustun): 6 TA ANIQ PUL QATAMI                     */}
            {/* ============================================================== */}
            <div className="lg:col-span-7 space-y-4">
              {/* 1. NAQD PUL */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">1. 💵 Naqd Pul</h2>
                    <p className="text-xs text-slate-500">Kassadan sanab chiqilgan naqd pul summasini kiriting</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsBillCounterOpen(true)}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    Kupura bo'yicha sanash
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    value={currentRecord.naqdPul || ''}
                    placeholder="0"
                    onChange={e => updateCurrentRecord({ naqdPul: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-4 py-3 text-xl font-bold mono text-emerald-800 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                  />
                  <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-400">SO'M</span>
                </div>

                {/* Optional Ertalabki sdacha */}
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowSdacha(v => !v)}
                    className="text-slate-500 hover:text-slate-800 font-medium underline cursor-pointer"
                  >
                    {showSdacha ? 'Ertalabki sdachani yashirish' : "+ Ertalabki sdacha (mayda pul) bo'lsa ayirish"}
                  </button>

                  {showSdacha && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600 font-semibold">Ertalabki sdacha:</span>
                      <input
                        type="number"
                        min="0"
                        value={currentRecord.ertalabkiSdacha || ''}
                        placeholder="0"
                        onChange={e => updateCurrentRecord({ ertalabkiSdacha: parseInt(e.target.value, 10) || 0 })}
                        className="w-32 px-2.5 py-1 text-right font-bold mono bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-hidden"
                      />
                      <span className="text-slate-400">so'm</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. TERMINAL */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">2. 💳 Terminal (Humo / Uzcard)</h2>
                    <p className="text-xs text-slate-500">Terminal cheklarini hisoblab kiriting (yoki bitta-bitta qo'shing)</p>
                  </div>
                  <span className="text-base font-bold mono text-blue-700">{formatMoney(totals.terminalJami)}</span>
                </div>

                {/* Direct input if no itemized list */}
                {(!currentRecord.terminalList || currentRecord.terminalList.length === 0) ? (
                  <div className="relative mb-3">
                    <input
                      type="number"
                      min="0"
                      value={currentRecord.terminalSumma || ''}
                      placeholder="0"
                      onChange={e => updateCurrentRecord({ terminalSumma: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-4 py-3 text-xl font-bold mono text-blue-800 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                    />
                    <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-400">SO'M</span>
                  </div>
                ) : (
                  <div className="mb-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {currentRecord.terminalList.map((item, idx) => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-blue-50/50 border border-blue-100 rounded-xl text-xs">
                        <div>
                          <span className="text-slate-400 mono mr-2">{idx + 1}.</span>
                          <span className="font-bold text-slate-800">{item.nomi}</span>
                          <span className="text-slate-400 ml-2">{item.vaqt}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold mono text-blue-800">{formatMoney(item.summa)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteTerminalItem(item.id)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mini adder for multiple terminal slips */}
                <form onSubmit={handleAddTerminalItem} className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
                  <input
                    type="text"
                    placeholder="Masalan: Humo / Uzcard (ixtiyoriy)"
                    value={terminalAddName}
                    onChange={e => setTerminalAddName(e.target.value)}
                    className="flex-1 min-w-[140px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden"
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Qo'shiladigan summa..."
                    value={terminalAddSum}
                    onChange={e => setTerminalAddSum(e.target.value)}
                    className="w-36 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold mono text-right focus:bg-white focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Qo'shish
                  </button>
                </form>
              </div>

              {/* 3. CLICK / PAYME */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">3. 📱 Click / Payme</h2>
                    <p className="text-xs text-slate-500">Kliklarni hisoblab umumiy kiriting yoki bitta-bitta qo'shib boring</p>
                  </div>
                  <span className="text-base font-bold mono text-indigo-700">{formatMoney(totals.clickJami)}</span>
                </div>

                {(!currentRecord.clickList || currentRecord.clickList.length === 0) ? (
                  <div className="relative mb-3">
                    <input
                      type="number"
                      min="0"
                      value={currentRecord.clickSumma || ''}
                      placeholder="0"
                      onChange={e => updateCurrentRecord({ clickSumma: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-4 py-3 text-xl font-bold mono text-indigo-800 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <span className="absolute right-4 top-3.5 text-xs font-bold text-slate-400">SO'M</span>
                  </div>
                ) : (
                  <div className="mb-3 space-y-1.5 max-h-40 overflow-y-auto">
                    {currentRecord.clickList.map((item, idx) => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs">
                        <div>
                          <span className="text-slate-400 mono mr-2">{idx + 1}.</span>
                          <span className="font-bold text-slate-800">{item.nomi}</span>
                          <span className="text-slate-400 ml-2">{item.vaqt}</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold mono text-indigo-800">{formatMoney(item.summa)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteClickItem(item.id)}
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={handleAddClickItem} className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
                  <input
                    type="text"
                    placeholder="Izoh (ixtiyoriy, masalan: Mijoz ismi)"
                    value={clickAddName}
                    onChange={e => setClickAddName(e.target.value)}
                    className="flex-1 min-w-[140px] px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-hidden"
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Click summasi..."
                    value={clickAddSum}
                    onChange={e => setClickAddSum(e.target.value)}
                    className="w-36 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold mono text-right focus:bg-white focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Qo'shish
                  </button>
                </form>
              </div>

              {/* 4. QARZGA BERILGAN PULLAR */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">4. 📝 Qarzga Berilgan Pullar (Nasiya)</h2>
                    <p className="text-xs text-slate-500">Qarzga ketgan tovar yoki berilgan pullarni qo'shing — hammasini jamlaydi</p>
                  </div>
                  <span className="text-base font-bold mono text-amber-700">{formatMoney(totals.qarzJami)}</span>
                </div>

                <form onSubmit={handleAddQarz} className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs">
                  <input
                    type="text"
                    placeholder="Kim oldi? (masalan: Dilshod aka)"
                    value={qarzName}
                    onChange={e => setQarzName(e.target.value)}
                    className="flex-1 min-w-[150px] px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden"
                  />
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Summa (so'm)..."
                    value={qarzSum}
                    onChange={e => setQarzSum(e.target.value)}
                    className="w-36 px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold mono text-right focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Qo'shish
                  </button>
                </form>

                {currentRecord.qarzList.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-2">Qarzga berilganlar kiritilmagan (0 so'm)</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {currentRecord.qarzList.map((item, idx) => (
                      <div key={item.id} className="py-2 px-2 flex items-center justify-between text-xs hover:bg-slate-50 rounded-lg">
                        <div>
                          <span className="text-slate-400 mono mr-2">{idx + 1}.</span>
                          <span className="font-bold text-slate-900">{item.nomi}</span>
                          <span className="text-slate-400 ml-2">{item.vaqt}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold mono text-amber-800">{formatMoney(item.summa)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteQarz(item.id)}
                            className="text-slate-300 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. FIRMAGA BERILGAN PULLAR */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">5. 🚚 Firmaga Berilgan Pullar</h2>
                    <p className="text-xs text-slate-500">Tovar olib kelgan firmalarga berilgan pullarni qo'shing</p>
                  </div>
                  <span className="text-base font-bold mono text-orange-700">{formatMoney(totals.firmaJami)}</span>
                </div>

                <form onSubmit={handleAddFirma} className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-orange-50/70 border border-orange-200 rounded-xl text-xs">
                  <input
                    type="text"
                    placeholder="Firma nomi (masalan: Coca-Cola, Sut, Non)"
                    value={firmaName}
                    onChange={e => setFirmaName(e.target.value)}
                    className="flex-1 min-w-[150px] px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden"
                  />
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Summa (so'm)..."
                    value={firmaSum}
                    onChange={e => setFirmaSum(e.target.value)}
                    className="w-36 px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold mono text-right focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Qo'shish
                  </button>
                </form>

                {currentRecord.firmaList.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-2">Firmalarga to'lov kiritilmagan (0 so'm)</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {currentRecord.firmaList.map((item, idx) => (
                      <div key={item.id} className="py-2 px-2 flex items-center justify-between text-xs hover:bg-slate-50 rounded-lg">
                        <div>
                          <span className="text-slate-400 mono mr-2">{idx + 1}.</span>
                          <span className="font-bold text-slate-900">{item.nomi}</span>
                          <span className="text-slate-400 ml-2">{item.vaqt}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold mono text-orange-800">{formatMoney(item.summa)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteFirma(item.id)}
                            className="text-slate-300 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. RASXODLAR (DO'KON XARAJATLARI) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">6. 📦 Boshqa Rasxodlar (Abed, Paket, Yo'lkira...)</h2>
                    <p className="text-xs text-slate-500">Kassadan qilingan mayda xarajatlarni qo'shing (bo'lmasa bo'sh qoldiring)</p>
                  </div>
                  <span className="text-base font-bold mono text-rose-700">{formatMoney(totals.rasxodJami)}</span>
                </div>

                <form onSubmit={handleAddRasxod} className="flex flex-wrap items-center gap-2 mb-3 p-2.5 bg-rose-50/70 border border-rose-200 rounded-xl text-xs">
                  <input
                    type="text"
                    placeholder="Nima uchun? (masalan: Tushlik, Paket)"
                    value={rasxodName}
                    onChange={e => setRasxodName(e.target.value)}
                    className="flex-1 min-w-[150px] px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden"
                  />
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Summa (so'm)..."
                    value={rasxodSum}
                    onChange={e => setRasxodSum(e.target.value)}
                    className="w-36 px-3 py-2 bg-white border border-slate-200 rounded-lg font-bold mono text-right focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Qo'shish
                  </button>
                </form>

                {currentRecord.rasxodList.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-2">Rasxod kiritilmagan (0 so'm)</p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {currentRecord.rasxodList.map((item, idx) => (
                      <div key={item.id} className="py-2 px-2 flex items-center justify-between text-xs hover:bg-slate-50 rounded-lg">
                        <div>
                          <span className="text-slate-400 mono mr-2">{idx + 1}.</span>
                          <span className="font-bold text-slate-900">{item.nomi}</span>
                          <span className="text-slate-400 ml-2">{item.vaqt}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold mono text-rose-800">{formatMoney(item.summa)}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteRasxod(item.id)}
                            className="text-slate-300 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ============================================================== */}
            {/* O'NG TOMON (5 ustun, Sticky): YAKUNIY HISOB VA CHEK BILAN FARQ */}
            {/* ============================================================== */}
            <div className="lg:col-span-5 lg:sticky lg:top-28 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-base font-extrabold text-slate-900">Yakuniy Hisob-Kitob va Chek Farqi</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Barcha pullar qo'shiladi va chekdagi summa bilan solishtiriladi
                  </p>
                </div>

                {/* Vertical breakdown of every sum */}
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">1. Naqd pul:</span>
                    <span className="font-bold mono text-emerald-700">{formatMoney(totals.sofNaqd)}</span>
                  </div>
                  {totals.ertalabkiSdacha > 0 && (
                    <div className="text-[11px] text-slate-400 text-right -mt-2">
                      ({formatNumber(totals.naqdSanalgan)} sanalgan - {formatNumber(totals.ertalabkiSdacha)} sdacha)
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">2. Terminal:</span>
                    <span className="font-bold mono text-blue-700">{formatMoney(totals.terminalJami)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">3. Click / Payme:</span>
                    <span className="font-bold mono text-indigo-700">{formatMoney(totals.clickJami)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">4. Qarzga berilgan ({currentRecord.qarzList.length} ta):</span>
                    <span className="font-bold mono text-amber-700">{formatMoney(totals.qarzJami)}</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">5. Firmaga berilgan ({currentRecord.firmaList.length} ta):</span>
                    <span className="font-bold mono text-orange-700">{formatMoney(totals.firmaJami)}</span>
                  </div>

                  {totals.rasxodJami > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">6. Rasxodlar ({currentRecord.rasxodList.length} ta):</span>
                      <span className="font-bold mono text-rose-700">{formatMoney(totals.rasxodJami)}</span>
                    </div>
                  )}

                  {/* JAMI */}
                  <div className="pt-3 border-t-2 border-slate-200 flex items-center justify-between">
                    <span className="text-sm font-extrabold text-slate-900 uppercase">Jami Hisoblangan:</span>
                    <span className="text-xl font-extrabold mono text-slate-900">{formatMoney(totals.jamiHisoblangan)}</span>
                  </div>
                </div>

                {/* CHEKDAGI SUMMA */}
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    🧾 Chekdagi Summa (Kassa apparat / Kompyuter):
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      value={currentRecord.chekdagiSumma || ''}
                      placeholder="Chekdagi umumiy summani yozing..."
                      onChange={e => updateCurrentRecord({ chekdagiSumma: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-4 py-3 text-xl font-extrabold mono text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-slate-900 focus:outline-hidden"
                    />
                    <span className="absolute right-4 top-4 text-xs font-bold text-slate-400">SO'M</span>
                  </div>
                </div>

                {/* FARQ (NATIJA) KARTASI */}
                {totals.chekdagiSumma === 0 && totals.jamiHisoblangan === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-xs flex items-center gap-2.5">
                    <Info className="w-5 h-5 text-slate-400 shrink-0" />
                    <span>
                      Chap tarafdagi pullarni va yuqoridagi <strong>Chekdagi summani</strong> kiriting, farqi shu yerda darhol chiqadi.
                    </span>
                  </div>
                ) : totals.farq < 0 ? (
                  <div className="p-5 rounded-xl bg-rose-50 border-2 border-rose-300 text-rose-900 space-y-1">
                    <div className="flex items-center gap-2 text-rose-700 font-extrabold text-xs uppercase tracking-wider">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>KASSADA KAMOMAD BOR!</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold mono text-rose-700 tracking-tight">
                      {formatMoney(Math.abs(totals.farq))} KAM CHIQDI
                    </div>
                    <p className="text-xs text-rose-800 pt-1">
                      Hisoblangan pullar chekdagi summadan <strong>{formatMoney(Math.abs(totals.farq))}</strong> kam chiqyapti.
                    </p>
                  </div>
                ) : totals.farq > 0 ? (
                  <div className="p-5 rounded-xl bg-blue-50 border-2 border-blue-300 text-blue-900 space-y-1">
                    <div className="flex items-center gap-2 text-blue-700 font-extrabold text-xs uppercase tracking-wider">
                      <Info className="w-4 h-4 shrink-0" />
                      <span>ORTIQCHA PUL CHIQDI</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold mono text-blue-700 tracking-tight">
                      +{formatMoney(totals.farq)} ORTIQCHA
                    </div>
                    <p className="text-xs text-blue-800 pt-1">
                      Hisoblangan pullar chekdagi summadan <strong>{formatMoney(totals.farq)}</strong> ko'p chiqdi.
                    </p>
                  </div>
                ) : (
                  <div className="p-5 rounded-xl bg-emerald-50 border-2 border-emerald-300 text-emerald-900 space-y-1">
                    <div className="flex items-center gap-2 text-emerald-700 font-extrabold text-xs uppercase tracking-wider">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>KASSA 100% TO'G'RI CHIQDI!</span>
                    </div>
                    <div className="text-2xl sm:text-3xl font-extrabold mono text-emerald-700 tracking-tight">
                      0 so'm farq ✓
                    </div>
                    <p className="text-xs text-emerald-800 pt-1">
                      Chekdagi summa bilan barcha pullar bir xil chiqdi!
                    </p>
                  </div>
                )}

                {/* Izoh */}
                <div>
                  <input
                    type="text"
                    value={currentRecord.izoh || ''}
                    onChange={e => updateCurrentRecord({ izoh: e.target.value })}
                    placeholder="Kunlik izoh (ixtiyoriy)..."
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden"
                  />
                </div>

                {/* Action buttons */}
                <div className="space-y-2.5 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleExplicitSave}
                      className="py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition shadow-xs"
                    >
                      <Save className="w-4 h-4" />
                      <span>Saqlash</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyText}
                      className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      <span>{copied ? 'Nusxalandi!' : 'Matn nusxa'}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCloseShiftAndSend}
                    disabled={sendingTelegram}
                    className="w-full py-3.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-xs disabled:opacity-60"
                  >
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <span>
                      {sendingTelegram
                        ? "Yuborilmoqda..."
                        : telegramConfig.enabled
                        ? "Kassani Yopish & Adminga Yuborish"
                        : "Kassani Yopish & Saqlash"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <ArchiveSearchView
            records={records}
            onOpenRecord={r => {
              setSelectedDate(r.date);
              if (!registers.includes(r.kassaNomi)) {
                const next = [...registers, r.kassaNomi];
                setRegisters(next);
                saveRegisters(next);
              }
              setSelectedRegister(r.kassaNomi);
              setActiveTab('kassa');
            }}
            onDeleteRecord={handleDeleteArchiveRecord}
            onImportRecords={handleImportRecords}
          />
        )}
      </main>

      {/* Printable / Z-Report Modal */}
      {isReceiptModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 no-print">
              <h3 className="font-bold text-slate-800 text-sm">Z-Hisobot (Chek Ko'rinishi)</h3>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div id="printable-receipt" className="p-6 overflow-y-auto text-xs mono text-slate-800 space-y-3">
              <div className="text-center border-b border-dashed border-slate-300 pb-3">
                <h2 className="font-bold text-base uppercase tracking-wider text-black">NAVO MARKET</h2>
                <p className="text-[11px] text-slate-600">{selectedRegister} · Z-HISOBOT</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Sana: {formatUzbekDate(selectedDate)}</p>
                {currentRecord.kassirIsmi && (
                  <p className="text-[10px] text-slate-500">Kassir: {currentRecord.kassirIsmi}</p>
                )}
              </div>

              <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span>1. Naqd pul:</span>
                  <span className="font-bold">{formatMoney(totals.sofNaqd)}</span>
                </div>
                <div className="flex justify-between">
                  <span>2. Terminal:</span>
                  <span className="font-bold">{formatMoney(totals.terminalJami)}</span>
                </div>
                <div className="flex justify-between">
                  <span>3. Click / Payme:</span>
                  <span className="font-bold">{formatMoney(totals.clickJami)}</span>
                </div>
                <div className="flex justify-between">
                  <span>4. Qarzga ({currentRecord.qarzList.length} ta):</span>
                  <span className="font-bold">{formatMoney(totals.qarzJami)}</span>
                </div>
                <div className="flex justify-between">
                  <span>5. Firmaga ({currentRecord.firmaList.length} ta):</span>
                  <span className="font-bold">{formatMoney(totals.firmaJami)}</span>
                </div>
                {totals.rasxodJami > 0 && (
                  <div className="flex justify-between">
                    <span>6. Rasxod ({currentRecord.rasxodList.length} ta):</span>
                    <span className="font-bold">{formatMoney(totals.rasxodJami)}</span>
                  </div>
                )}
              </div>

              {currentRecord.qarzList.length > 0 && (
                <div className="border-b border-dashed border-slate-300 pb-2">
                  <div className="font-bold text-[10px] uppercase mb-1">Qarzga olganlar:</div>
                  {currentRecord.qarzList.map((q, i) => (
                    <div key={q.id} className="flex justify-between text-[11px]">
                      <span>{i + 1}. {q.nomi}</span>
                      <span>{formatMoney(q.summa)}</span>
                    </div>
                  ))}
                </div>
              )}

              {currentRecord.firmaList.length > 0 && (
                <div className="border-b border-dashed border-slate-300 pb-2">
                  <div className="font-bold text-[10px] uppercase mb-1">Firmalarga berilgan:</div>
                  {currentRecord.firmaList.map((fp, i) => (
                    <div key={fp.id} className="flex justify-between text-[11px]">
                      <span>{i + 1}. {fp.nomi}</span>
                      <span>{formatMoney(fp.summa)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-slate-50 p-2.5 rounded-lg border border-dashed border-slate-300 space-y-1">
                <div className="flex justify-between font-bold">
                  <span>JAMI HISOBLANGAN:</span>
                  <span>{formatMoney(totals.jamiHisoblangan)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>CHEKDAGI SUMMA:</span>
                  <span>{formatMoney(totals.chekdagiSumma)}</span>
                </div>
                <div className={`flex justify-between font-bold text-sm pt-1 border-t border-slate-300 ${
                  totals.farq < 0 ? 'text-rose-700' : totals.farq > 0 ? 'text-blue-700' : 'text-emerald-700'
                }`}>
                  <span>FARQ:</span>
                  <span>
                    {totals.farq === 0
                      ? "0 so'm (TO'G'RI)"
                      : totals.farq < 0
                      ? `${formatMoney(Math.abs(totals.farq))} KAM`
                      : `+${formatMoney(totals.farq)} ORTIQ`}
                  </span>
                </div>
              </div>

              <div className="text-center text-[10px] text-slate-400 pt-2">
                Kassir imzosi: ___________________
              </div>
            </div>

            <div className="p-4 border-t bg-slate-50 flex gap-2 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Chop etish
              </button>
              <button
                type="button"
                onClick={handleCopyText}
                className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsReceiptModalOpen(false)}
                className="px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-semibold text-xs cursor-pointer"
              >
                Yopish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bill Counter Modal */}
      <BillCounterModal
        isOpen={isBillCounterOpen}
        onClose={() => setIsBillCounterOpen(false)}
        currentActualCash={currentRecord.naqdPul}
        onApplyTotal={total => updateCurrentRecord({ naqdPul: total })}
      />

      {/* Telegram Settings Modal */}
      <TelegramSettingsModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        config={telegramConfig}
        onSave={cfg => {
          setTelegramConfig(cfg);
          saveTelegramConfig(cfg);
          showToast("Telegram bot sozlamalari saqlandi! ✓");
        }}
      />

      {/* Cashier Registration & Profile Switcher Modal */}
      <CashierAuthModal
        isOpen={isCashierModalOpen}
        forceOpen={!activeCashier}
        onClose={() => setIsCashierModalOpen(false)}
        cashiers={cashiers}
        activeCashier={activeCashier}
        registers={registers}
        tgUser={tgUser}
        onRegisterCashier={handleRegisterCashier}
        onSelectCashier={handleSelectCashier}
        onDeleteCashier={handleDeleteCashier}
      />

      {/* Add Custom Register Modal */}
      {isAddRegisterOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmAddRegister}
            className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4"
          >
            <h3 className="text-sm font-extrabold text-slate-900">Yangi kassa qo&apos;shish</h3>
            <input
              type="text"
              autoFocus
              required
              value={newRegisterName}
              onChange={e => setNewRegisterName(e.target.value)}
              placeholder="Masalan: 3-Kassa yoki Kechki Kassa"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddRegisterOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl cursor-pointer"
              >
                Bekor
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer"
              >
                Qo&apos;shish
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Dialog Modal */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-60 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900">{confirmDialog.title}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl cursor-pointer"
              >
                Yo&apos;q, bekor
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl cursor-pointer"
              >
                Ha, tasdiqlayman
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
