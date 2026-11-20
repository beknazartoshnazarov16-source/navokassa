import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.resolve(__dirname, '..', 'data');
export const RECORDS_FILE = path.join(DATA_DIR, 'kassa-records.json');
export const TG_CONFIG_FILE = path.join(DATA_DIR, 'telegram-config.json');
export const CASHIERS_FILE = path.join(DATA_DIR, 'cashiers.json');
export const POLL_STATE_FILE = path.join(DATA_DIR, 'telegram-poll-state.json');
export const SESSIONS_FILE = path.join(DATA_DIR, 'telegram-sessions.json');

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function atomicWriteJson(filePath: string, data: unknown) {
  ensureDataDir();
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function readRecordsFromDisk(): any[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(RECORDS_FILE)) {
      atomicWriteJson(RECORDS_FILE, []);
      return [];
    }
    const raw = fs.readFileSync(RECORDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Diskdan kassa yozuvlarini o'qishda xatolik:", err);
    return [];
  }
}

export function writeRecordsToDisk(records: any[]) {
  atomicWriteJson(RECORDS_FILE, records);
}

export function readTgConfigFromDisk(): any | null {
  try {
    ensureDataDir();
    if (!fs.existsSync(TG_CONFIG_FILE)) return null;
    const raw = fs.readFileSync(TG_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeTgConfigToDisk(config: any) {
  atomicWriteJson(TG_CONFIG_FILE, config);
}

export function readCashiersFromDisk(): any[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(CASHIERS_FILE)) {
      atomicWriteJson(CASHIERS_FILE, []);
      return [];
    }
    const raw = fs.readFileSync(CASHIERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCashiersToDisk(cashiers: any[]) {
  atomicWriteJson(CASHIERS_FILE, cashiers);
}

export function readLastPollUpdateId(): number {
  try {
    ensureDataDir();
    if (!fs.existsSync(POLL_STATE_FILE)) return 0;
    const raw = JSON.parse(fs.readFileSync(POLL_STATE_FILE, 'utf-8'));
    return typeof raw?.lastUpdateId === 'number' ? raw.lastUpdateId : 0;
  } catch {
    return 0;
  }
}

export function writeLastPollUpdateId(updateId: number) {
  try {
    atomicWriteJson(POLL_STATE_FILE, { lastUpdateId: updateId });
  } catch {}
}

export function readBotSessionsFromDisk(): Record<string, any> {
  try {
    ensureDataDir();
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeBotSessionsToDisk(sessions: Record<string, any>) {
  try {
    atomicWriteJson(SESSIONS_FILE, sessions);
  } catch {}
}
