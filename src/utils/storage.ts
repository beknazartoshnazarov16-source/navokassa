import { CashierProfile, KassaDayRecord } from '../types/kassa';

const LOCAL_RECORDS_KEY = 'navo_market_kassa_records_v4';
const LOCAL_REGISTERS_KEY = 'navo_market_registers_v4';
const LOCAL_CASHIERS_KEY = 'navo_market_cashiers_v1';
const LOCAL_ACTIVE_CASHIER_KEY = 'navo_market_active_cashier_id_v1';

export const DEFAULT_REGISTERS = ['1-Kassa', '2-Kassa'];

export function createEmptyRecord(
  date: string,
  kassaNomi: string,
  kassirIsmi = '',
  kassirId?: string
): KassaDayRecord {
  return {
    id: `${date}__${kassaNomi}`,
    date,
    kassaNomi,
    kassirIsmi,
    kassirId,
    isOchiq: true,
    naqdPul: 0,
    ertalabkiSdacha: 0,
    terminalSumma: 0,
    terminalList: [],
    clickSumma: 0,
    clickList: [],
    qarzList: [],
    firmaList: [],
    rasxodList: [],
    chekdagiSumma: 0,
    izoh: '',
  };
}

export interface RecordTotals {
  naqdSanalgan: number;
  ertalabkiSdacha: number;
  sofNaqd: number;
  terminalJami: number;
  clickJami: number;
  qarzJami: number;
  firmaJami: number;
  rasxodJami: number;
  jamiHisoblangan: number; // Naqd + Terminal + Click + Qarz + Firma + Rasxod
  chekdagiSumma: number;
  farq: number; // jamiHisoblangan - chekdagiSumma (manfiy bo'lsa KAM CHIQDI)
}

export function calculateTotals(r: KassaDayRecord): RecordTotals {
  const naqdSanalgan = Number(r.naqdPul) || 0;
  const ertalabkiSdacha = Number(r.ertalabkiSdacha) || 0;
  const sofNaqd = naqdSanalgan - ertalabkiSdacha;

  const terminalJami =
    r.terminalList && r.terminalList.length > 0
      ? r.terminalList.reduce((sum, item) => sum + (Number(item.summa) || 0), 0)
      : Number(r.terminalSumma) || 0;

  const clickJami =
    r.clickList && r.clickList.length > 0
      ? r.clickList.reduce((sum, item) => sum + (Number(item.summa) || 0), 0)
      : Number(r.clickSumma) || 0;

  const qarzJami = (r.qarzList || []).reduce((sum, item) => sum + (Number(item.summa) || 0), 0);
  const firmaJami = (r.firmaList || []).reduce((sum, item) => sum + (Number(item.summa) || 0), 0);
  const rasxodJami = (r.rasxodList || []).reduce((sum, item) => sum + (Number(item.summa) || 0), 0);

  const jamiHisoblangan = sofNaqd + terminalJami + clickJami + qarzJami + firmaJami + rasxodJami;
  const chekdagiSumma = Number(r.chekdagiSumma) || 0;
  const farq = jamiHisoblangan - chekdagiSumma;

  return {
    naqdSanalgan,
    ertalabkiSdacha,
    sofNaqd,
    terminalJami,
    clickJami,
    qarzJami,
    firmaJami,
    rasxodJami,
    jamiHisoblangan,
    chekdagiSumma,
    farq,
  };
}

export function loadLocalRecords(): KassaDayRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_RECORDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Local records load error:', e);
  }
  return [];
}

export function saveLocalRecords(records: KassaDayRecord[]): void {
  try {
    localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify(records));
  } catch (e) {
    console.error('Local records save error:', e);
  }
}

export function loadRegisters(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_REGISTERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_REGISTERS;
}

export function saveRegisters(regs: string[]): void {
  try {
    localStorage.setItem(LOCAL_REGISTERS_KEY, JSON.stringify(regs));
  } catch {}
}

// Cashiers Local Storage
export function loadLocalCashiers(): CashierProfile[] {
  try {
    const raw = localStorage.getItem(LOCAL_CASHIERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveLocalCashiers(cashiers: CashierProfile[]): void {
  try {
    localStorage.setItem(LOCAL_CASHIERS_KEY, JSON.stringify(cashiers));
  } catch {}
}

export function loadActiveCashierId(): string | null {
  try {
    return localStorage.getItem(LOCAL_ACTIVE_CASHIER_KEY);
  } catch {
    return null;
  }
}

export function saveActiveCashierId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(LOCAL_ACTIVE_CASHIER_KEY, id);
    } else {
      localStorage.removeItem(LOCAL_ACTIVE_CASHIER_KEY);
    }
  } catch {}
}

// Server API Sync Helpers
export async function fetchRecordsFromServer(): Promise<KassaDayRecord[] | null> {
  try {
    const res = await fetch('/api/records');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && Array.isArray(data.records)) {
      return data.records;
    }
  } catch (err) {
    console.warn('Serverdan ma\'lumot olib bo\'lmadi (offline rejim):', err);
  }
  return null;
}

export async function saveRecordToServer(record: KassaDayRecord): Promise<boolean> {
  try {
    const res = await fetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteRecordFromServer(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/records/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function bulkSaveRecordsToServer(records: KassaDayRecord[]): Promise<boolean> {
  try {
    const res = await fetch('/api/records/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Cashiers Server API
export async function fetchCashiersFromServer(): Promise<CashierProfile[] | null> {
  try {
    const res = await fetch('/api/cashiers');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && Array.isArray(data.cashiers)) {
      return data.cashiers;
    }
  } catch {}
  return null;
}

export async function registerCashierOnServer(payload: {
  ism: string;
  telefon?: string;
  telegramId?: string;
  telegramUsername?: string;
  asosiyKassa?: string;
}): Promise<{ ok: boolean; cashier?: CashierProfile; cashiers?: CashierProfile[]; isNew?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/cashiers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data;
  } catch {
    // Offline fallback: register locally so offline cashiers still work
    const local = loadLocalCashiers();
    const cleanName = payload.ism.trim();
    const existing = local.find(c => c.ism.toLowerCase() === cleanName.toLowerCase());
    if (existing) {
      const updated = { ...existing, ...payload, ism: cleanName, lastActiveAt: new Date().toISOString() };
      const next = local.map(c => (c.id === existing.id ? updated : c));
      saveLocalCashiers(next);
      return { ok: true, cashier: updated, cashiers: next, isNew: false };
    }
    const created: CashierProfile = {
      id: `kassir-${Date.now()}`,
      ism: cleanName,
      telefon: payload.telefon,
      telegramId: payload.telegramId,
      telegramUsername: payload.telegramUsername,
      asosiyKassa: payload.asosiyKassa,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    const next = [created, ...local];
    saveLocalCashiers(next);
    return { ok: true, cashier: created, cashiers: next, isNew: true };
  }
}

export async function deleteCashierFromServer(id: string): Promise<CashierProfile[] | null> {
  try {
    const res = await fetch(`/api/cashiers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (res.ok && data.ok && Array.isArray(data.cashiers)) {
      return data.cashiers;
    }
  } catch {}
  return null;
}
