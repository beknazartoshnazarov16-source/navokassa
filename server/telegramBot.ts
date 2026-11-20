import {
  readRecordsFromDisk,
  writeRecordsToDisk,
  readTgConfigFromDisk,
  writeTgConfigToDisk,
  readCashiersFromDisk,
  writeCashiersToDisk,
  readLastPollUpdateId,
  writeLastPollUpdateId,
  readBotSessionsFromDisk,
  writeBotSessionsToDisk,
} from './storage.ts';

// ==========================================
// TELEGRAM BOT ENGINE (LONG-POLLING, PERSISTENT SESSIONS, HTML-SAFE)
// ==========================================

export interface BotSession {
  step:
    | 'idle'
    | 'awaiting_name'
    | 'awaiting_custom_kassa'
    | 'awaiting_open_sdacha'
    | 'kirim_qarz_name'
    | 'kirim_qarz_amount'
    | 'kirim_firma_name'
    | 'kirim_firma_amount'
    | 'kirim_rasxod_name'
    | 'kirim_rasxod_amount'
    | 'kirim_naqd'
    | 'kirim_terminal'
    | 'kirim_click'
    | 'kirim_chek'
    | 'close_naqd'
    | 'close_terminal'
    | 'close_click'
    | 'close_qarz'
    | 'close_firma'
    | 'close_rasxod'
    | 'close_chek'
    | 'close_confirm';
  updatedAt: number;
  draft?: {
    itemName?: string;
    naqdPul?: number;
    terminalSumma?: number;
    clickSumma?: number;
    qarzSumma?: number;
    firmaSumma?: number;
    rasxodSumma?: number;
    chekdagiSumma?: number;
    keepExistingTerminalList?: boolean;
    keepExistingClickList?: boolean;
    keepExistingQarz?: boolean;
    keepExistingFirma?: boolean;
    keepExistingRasxod?: boolean;
  };
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_IDS = 500;
const MAX_AMOUNT_UZS = 100_000_000_000;

let lastPolledUpdateId = readLastPollUpdateId();
const processedUpdateIds = new Set<number>();
let lastPollHandledAt = 0;
let recentDetectedChat: { chatId: number | string; senderName: string; senderUsername?: string } | null = null;
let webhookClearedForToken = '';
let pollerStarted = false;
let pollerAbortController: AbortController | null = null;
let activePolledToken = '';

const botSessionsMap = new Map<string, BotSession>();

// Hydrate saved sessions on startup
(function hydrateSessions() {
  const saved = readBotSessionsFromDisk();
  const now = Date.now();
  for (const [k, v] of Object.entries(saved)) {
    if (v && typeof v === 'object' && typeof v.step === 'string') {
      if (!v.updatedAt || now - v.updatedAt < SESSION_TTL_MS) {
        botSessionsMap.set(k, v as BotSession);
      }
    }
  }
})();

function getSession(chatId: string): BotSession {
  const s = botSessionsMap.get(chatId);
  if (!s) return { step: 'idle', updatedAt: Date.now() };
  if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
    const fresh: BotSession = { step: 'idle', updatedAt: Date.now() };
    botSessionsMap.set(chatId, fresh);
    persistSessions();
    return fresh;
  }
  return s;
}

function setSession(chatId: string, session: Omit<BotSession, 'updatedAt'>) {
  botSessionsMap.set(chatId, { ...session, updatedAt: Date.now() });
  persistSessions();
}

function persistSessions() {
  const obj: Record<string, BotSession> = {};
  const now = Date.now();
  for (const [k, v] of botSessionsMap.entries()) {
    if (now - v.updatedAt < SESSION_TTL_MS && v.step !== 'idle') {
      obj[k] = v;
    }
  }
  writeBotSessionsToDisk(obj);
}

export function getRecentDetectedChat() {
  return { recentDetectedChat, lastPollHandledAt, activePolledToken };
}

export function resetWebhookCacheForConfigUpdate() {
  webhookClearedForToken = '';
  if (pollerAbortController) {
    try {
      pollerAbortController.abort();
    } catch {}
  }
}

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function getUzbekTodayDate(offsetDays = 0): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const uz = new Date(utcMs + 5 * 3600_000 + offsetDays * 86_400_000);
  const y = uz.getFullYear();
  const m = String(uz.getMonth() + 1).padStart(2, '0');
  const d = String(uz.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getUzbekTimeStr(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const uz = new Date(utcMs + 5 * 3600_000);
  const hh = String(uz.getHours()).padStart(2, '0');
  const mm = String(uz.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('uz-UZ');
}

export function parseBotAmount(text: string): number | null {
  let s = String(text || '').trim();
  if (!s) return null;
  // Allow quick-pick button format like "Hozirgi: 1 500 000" or "Saqlash: 0"
  s = s.replace(/^(hozirgi|saqlash)\s*:\s*/i, '');
  // Strip explicit currency words ("so'm", "som", "sum") and thousands separators (spaces, commas, dots, underscores)
  s = s.replace(/\b(so['’`]?m|som|sum)\b/gi, '').replace(/[\s,._'’`]+/g, '');
  if (!/^\d+$/.test(s)) return null;
  const val = parseInt(s, 10);
  if (!Number.isSafeInteger(val) || val < 0 || val > MAX_AMOUNT_UZS) return null;
  return val;
}

export function isPublicMiniAppUrl(rawUrl: string): boolean {
  const url = String(rawUrl || '').trim();
  if (!url.startsWith('https://')) return false;
  const lower = url.toLowerCase();
  if (
    lower.includes('ais-dev-') ||
    lower.includes('ais-pre-') ||
    lower.includes('ai.studio/') ||
    lower.includes('aistudio.google.com/') ||
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('0.0.0.0')
  ) {
    return false;
  }
  return true;
}

export function getEffectiveMiniAppUrl(cfg: any): string {
  if (cfg?.miniAppDisabled) return '';
  const saved = String(cfg?.miniAppUrl || '').trim();
  if (isPublicMiniAppUrl(saved)) return saved;
  const envUrl = String(process.env.APP_URL || '').trim();
  if (isPublicMiniAppUrl(envUrl)) return envUrl;
  return '';
}

function mainBotKeyboard(miniAppUrl?: string, isPrivateChat = true, isAdmin = false) {
  const rows: any[][] = [];
  if (isPrivateChat && miniAppUrl && miniAppUrl.startsWith('https://')) {
    rows.push([{ text: '📱 Mini App Ochish (Kassa)', web_app: { url: miniAppUrl } }]);
  }
  rows.push([{ text: '🟢 Kassa Ochish' }, { text: '🔒 Kassa Yopish' }]);
  rows.push([{ text: '➕ Kirim / Chiqim' }, { text: '📊 Bugungi Natija' }]);
  rows.push([{ text: '🏪 Kassani Tanlash' }, { text: "👤 Ismni O'zgartirish" }]);
  if (isAdmin) {
    rows.push([{ text: '👑 Admin Panel' }]);
  }
  return {
    keyboard: rows,
    resize_keyboard: true,
  };
}

function cancelKeyboard(quickAmounts: Array<{ label?: string; value: number }> = []) {
  const rows: any[][] = [];
  if (quickAmounts.length > 0) {
    const btns = quickAmounts.map((q) => ({
      text: q.label || String(q.value),
    }));
    // Split into rows of max 2-3 buttons
    for (let i = 0; i < btns.length; i += 2) {
      rows.push(btns.slice(i, i + 2));
    }
  }
  rows.push([{ text: '❌ Bekor qilish' }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
  };
}

function kirimInlineKeyboard(hasUndoable: boolean) {
  const rows: any[][] = [
    [
      { text: '📝 Qarzga (+)', callback_data: 'kirim:qarz' },
      { text: '🚚 Firmaga (+)', callback_data: 'kirim:firma' },
    ],
    [
      { text: '📦 Rasxod (+)', callback_data: 'kirim:rasxod' },
      { text: '💵 Naqd kiritish', callback_data: 'kirim:naqd' },
    ],
    [
      { text: '💳 Terminal', callback_data: 'kirim:terminal' },
      { text: '📱 Click / Payme', callback_data: 'kirim:click' },
    ],
    [{ text: '🧾 Chek Summasini Kiritish', callback_data: 'kirim:chek' }],
  ];
  if (hasUndoable) {
    rows.push([{ text: "🗑 Oxirgi Qo'shilgan Yozuvni O'chirish", callback_data: 'kirim:undo' }]);
  }
  rows.push([
    { text: '📊 Bugungi Natija', callback_data: 'nav:today' },
    { text: '🔒 Kassa Yopish', callback_data: 'nav:yopish' },
  ]);
  return { inline_keyboard: rows };
}

export async function setMenuButtonForChat(
  botToken: string,
  menuButton: any,
  chatId?: string | number
): Promise<{ ok: boolean; description?: string }> {
  try {
    const body: any = { menu_button: menuButton };
    if (chatId !== undefined && chatId !== null && String(chatId).trim() !== '') {
      const n = Number(chatId);
      if (!Number.isNaN(n)) body.chat_id = n;
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return { ok: Boolean(res.ok && data.ok), description: data.description };
  } catch (e: any) {
    return { ok: false, description: e?.message };
  }
}

export async function syncBotCommands(botToken: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Asosiy menyu va Mini App' },
          { command: 'kassa', description: 'Asosiy kassa menyusi' },
          { command: 'ochish', description: '🟢 Kassa ochish' },
          { command: 'kirim', description: '➕ Qarz, Firma, Rasxod kiritish' },
          { command: 'natija', description: '📊 Bugungi kassa natijasi' },
          { command: 'yopish', description: '🔒 Kassa yopish (Z-hisobot)' },
          { command: 'admin', description: '👑 Barcha kassalar holati (Admin)' },
          { command: 'bekor', description: '❌ Joriy amalni bekor qilish' },
        ],
      }),
    });
  } catch {}
}

export async function syncMiniAppMenuButtons(
  botToken: string,
  miniAppUrl: string,
  buttonText = '📱 Kassa',
  extraChatIds: Array<string | number | undefined> = []
) {
  const menuBtn = miniAppUrl
    ? { type: 'web_app', text: buttonText, web_app: { url: miniAppUrl } }
    : { type: 'commands' };

  const defaultRes = await setMenuButtonForChat(botToken, menuBtn);

  const uniqueChats = new Set<string>();
  const cfg = readTgConfigFromDisk();
  if (cfg?.chatId) uniqueChats.add(String(cfg.chatId).trim());
  for (const c of readCashiersFromDisk()) {
    if (c?.telegramId) uniqueChats.add(String(c.telegramId).trim());
  }
  for (const id of extraChatIds) {
    if (id !== undefined && id !== null && String(id).trim() !== '') {
      uniqueChats.add(String(id).trim());
    }
  }

  for (const cid of uniqueChats) {
    if (!cid.startsWith('-')) {
      await setMenuButtonForChat(botToken, menuBtn, cid);
    }
  }

  return defaultRes;
}

export async function tgSend(
  botToken: string,
  chatId: string | number,
  text: string,
  replyMarkup?: any
): Promise<{ ok: boolean; description?: string; result?: any }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (res.ok && data.ok) {
      return { ok: true, result: data.result };
    }

    // Fallback 1: If reply_markup rejected (e.g., web_app inside group chat), retry without reply_markup
    if (replyMarkup) {
      const retryRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const retryData = await retryRes.json().catch(() => ({ ok: false }));
      if (retryRes.ok && retryData.ok) {
        return { ok: true, result: retryData.result };
      }
    }

    // Fallback 2: If HTML entity parsing failed, retry as plain text so important reports never silently vanish
    if (String(data.description || '').toLowerCase().includes('parse entities')) {
      const plainRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: stripHtmlTags(text),
          disable_web_page_preview: true,
        }),
      });
      const plainData = await plainRes.json().catch(() => ({ ok: false }));
      if (plainRes.ok && plainData.ok) {
        return { ok: true, result: plainData.result };
      }
    }

    console.warn(`tgSend xatoligi (${chatId}):`, data.description || res.status);
    return { ok: false, description: data.description || `HTTP ${res.status}` };
  } catch (err: any) {
    console.warn(`tgSend tarmoq xatoligi (${chatId}):`, err?.message || err);
    return { ok: false, description: err?.message };
  }
}

export async function tgEdit(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string,
  replyMarkup?: any
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (res.ok && data.ok) return true;
    // "message is not modified" is benign
    if (String(data.description || '').includes('message is not modified')) return true;
    return false;
  } catch {
    return false;
  }
}

export async function tgAnswerCallback(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false
) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        ...(text ? { text } : {}),
        ...(showAlert ? { show_alert: true } : {}),
      }),
    });
  } catch {}
}

export function computeTotalsServer(r: any) {
  const sdacha = Number(r.ertalabkiSdacha) || 0;
  const naqdSanalgan = Number(r.naqdPul) || 0;
  const sofNaqd = naqdSanalgan - sdacha;
  const terminalJami =
    Array.isArray(r.terminalList) && r.terminalList.length > 0
      ? r.terminalList.reduce((s: number, x: any) => s + (Number(x.summa) || 0), 0)
      : Number(r.terminalSumma) || 0;
  const clickJami =
    Array.isArray(r.clickList) && r.clickList.length > 0
      ? r.clickList.reduce((s: number, x: any) => s + (Number(x.summa) || 0), 0)
      : Number(r.clickSumma) || 0;
  const qarzJami = (r.qarzList || []).reduce((s: number, x: any) => s + (Number(x.summa) || 0), 0);
  const firmaJami = (r.firmaList || []).reduce((s: number, x: any) => s + (Number(x.summa) || 0), 0);
  const rasxodJami = (r.rasxodList || []).reduce((s: number, x: any) => s + (Number(x.summa) || 0), 0);
  const jamiHisoblangan = sofNaqd + terminalJami + clickJami + qarzJami + firmaJami + rasxodJami;
  const chekdagiSumma = Number(r.chekdagiSumma) || 0;
  const farq = jamiHisoblangan - chekdagiSumma;
  return {
    sdacha,
    naqdSanalgan,
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

function formatListPreview(items: any[], maxItems = 8): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  const shown = items.slice(0, maxItems);
  const lines = shown.map(
    (item, idx) => `   ${idx + 1}. ${escapeHtml(item.nomi || '-')}: <code>${fmtNum(Number(item.summa) || 0)} so'm</code>`
  );
  if (items.length > maxItems) {
    lines.push(`   <i>... va yana ${items.length - maxItems} ta</i>`);
  }
  return lines.join('\n') + '\n';
}

export function buildReportHtml(r: any, vaqt: string, isPreview = false): string {
  const t = computeTotalsServer(r);
  let farqMatn = `✅ <b>TO'G'RI CHIQDI! (Farq: 0 so'm)</b>`;
  if (t.farq < 0) farqMatn = `⚠️ <b>KAM CHIQDI:</b> <code>${fmtNum(Math.abs(t.farq))} so'm</code> kam chiqdi!`;
  else if (t.farq > 0) farqMatn = `ℹ️ <b>ORTIQCHA CHIQDI:</b> <code>+${fmtNum(t.farq)} so'm</code> ko'p chiqdi`;

  const statusBadge = isPreview
    ? '📝 <b>[HISOBOTNI TEKSHIRING — TASDIQLANMAGAN]</b>'
    : r.isOchiq
      ? '🟢 <b>[NAVO MARKET — JORIY KASSA HOLATI]</b>'
      : '🔒 <b>[NAVO MARKET — KASSA HISOBOTI]</b>';

  const qarzList = Array.isArray(r.qarzList) ? r.qarzList : [];
  const firmaList = Array.isArray(r.firmaList) ? r.firmaList : [];
  const rasxodList = Array.isArray(r.rasxodList) ? r.rasxodList : [];

  return (
    `${statusBadge}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>Kassa:</b> ${escapeHtml(r.kassaNomi || '1-Kassa')}\n` +
    `👤 <b>Kassir:</b> ${escapeHtml(r.kassirIsmi || '-')}\n` +
    `📅 <b>Sana:</b> ${escapeHtml(r.date)}\n` +
    `⏰ <b>Vaqt:</b> ${escapeHtml(vaqt)}\n\n` +
    `💵 <b>Naqd pul (sof):</b> <code>${fmtNum(t.sofNaqd)} so'm</code>` +
    (t.sdacha > 0 ? ` <i>(${fmtNum(t.naqdSanalgan)} - ${fmtNum(t.sdacha)} sdacha)</i>` : '') +
    `\n` +
    `💳 <b>Terminal:</b> <code>${fmtNum(t.terminalJami)} so'm</code>\n` +
    `📱 <b>Click / Payme:</b> <code>${fmtNum(t.clickJami)} so'm</code>\n\n` +
    `📝 <b>Qarzga (${qarzList.length} ta):</b> <code>${fmtNum(t.qarzJami)} so'm</code>\n` +
    formatListPreview(qarzList) +
    `🚚 <b>Firmaga (${firmaList.length} ta):</b> <code>${fmtNum(t.firmaJami)} so'm</code>\n` +
    formatListPreview(firmaList) +
    (t.rasxodJami > 0 || rasxodList.length > 0
      ? `📦 <b>Rasxodlar (${rasxodList.length} ta):</b> <code>${fmtNum(t.rasxodJami)} so'm</code>\n${formatListPreview(rasxodList)}`
      : '') +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🧮 <b>JAMI HISOBLANGAN:</b> <code>${fmtNum(t.jamiHisoblangan)} so'm</code>\n` +
    `🧾 <b>CHEKDAGI SUMMA:</b> <code>${fmtNum(t.chekdagiSumma)} so'm</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${farqMatn}`
  );
}

function buildAdminSummaryHtml(dateStr: string, label: string): string {
  const records = readRecordsFromDisk().filter((r: any) => r.date === dateStr);
  if (records.length === 0) {
    return (
      `👑 <b>[ADMIN — ${escapeHtml(label)}]</b>\n` +
      `📅 <b>Sana:</b> ${escapeHtml(dateStr)}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `ℹ️ Ushbu sanada hali birorta kassa ochilmagan.`
    );
  }

  let totalNaqd = 0;
  let totalTerm = 0;
  let totalClick = 0;
  let totalQarz = 0;
  let totalFirma = 0;
  let totalRasxod = 0;
  let totalHisoblangan = 0;
  let totalChek = 0;

  const lines = records.map((r: any) => {
    const t = computeTotalsServer(r);
    totalNaqd += t.sofNaqd;
    totalTerm += t.terminalJami;
    totalClick += t.clickJami;
    totalQarz += t.qarzJami;
    totalFirma += t.firmaJami;
    totalRasxod += t.rasxodJami;
    totalHisoblangan += t.jamiHisoblangan;
    totalChek += t.chekdagiSumma;

    const status = r.isOchiq ? '🟢 Ochiq' : '🔒 Yopiq';
    const farqTxt =
      t.farq === 0 ? '0' : t.farq > 0 ? `+${fmtNum(t.farq)}` : `-${fmtNum(Math.abs(t.farq))}`;
    return (
      `🏪 <b>${escapeHtml(r.kassaNomi)}</b> (${status})\n` +
      `   👤 ${escapeHtml(r.kassirIsmi || '-')}\n` +
      `   🧮 Hisoblangan: <code>${fmtNum(t.jamiHisoblangan)}</code> | 🧾 Chek: <code>${fmtNum(t.chekdagiSumma)}</code> | Farq: <code>${farqTxt}</code>`
    );
  });

  const grandFarq = totalHisoblangan - totalChek;
  const grandFarqTxt =
    grandFarq === 0
      ? "✅ <b>0 so'm (To'g'ri)</b>"
      : grandFarq > 0
        ? `ℹ️ <b>+${fmtNum(grandFarq)} so'm</b>`
        : `⚠️ <b>-${fmtNum(Math.abs(grandFarq))} so'm</b>`;

  return (
    `👑 <b>[ADMIN — ${escapeHtml(label)}]</b>\n` +
    `📅 <b>Sana:</b> ${escapeHtml(dateStr)} | ⏰ ${getUzbekTimeStr()}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    lines.join('\n\n') +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `📊 <b>DO'KON BO'YICHA JAMI (${records.length} ta kassa):</b>\n` +
    `💵 Naqd (sof): <code>${fmtNum(totalNaqd)} so'm</code>\n` +
    `💳 Terminal: <code>${fmtNum(totalTerm)} so'm</code>\n` +
    `📱 Click: <code>${fmtNum(totalClick)} so'm</code>\n` +
    `📝 Qarz: <code>${fmtNum(totalQarz)} so'm</code> | 🚚 Firma: <code>${fmtNum(totalFirma)} so'm</code>` +
    (totalRasxod > 0 ? ` | 📦 Rasxod: <code>${fmtNum(totalRasxod)} so'm</code>` : '') +
    `\n🧮 <b>Jami Hisoblangan:</b> <code>${fmtNum(totalHisoblangan)} so'm</code>\n` +
    `🧾 <b>Jami Chek:</b> <code>${fmtNum(totalChek)} so'm</code>\n` +
    `⚖️ <b>Umumiy Farq:</b> ${grandFarqTxt}`
  );
}

function adminInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔄 Yangilash (Bugun)', callback_data: 'admin:today' },
        { text: '📅 Kechagi Kun', callback_data: 'admin:yesterday' },
      ],
      [{ text: "👥 Kassirlar Ro'yxati", callback_data: 'admin:cashiers' }],
    ],
  };
}

function getOrInitTodayRecord(activeKassa: string, cashier: any) {
  const today = getUzbekTodayDate();
  const recordId = `${today}__${activeKassa}`;
  const records = readRecordsFromDisk();
  const idx = records.findIndex((r: any) => r.id === recordId);
  if (idx >= 0) {
    return { records, idx, record: records[idx], recordId, today };
  }
  const fresh = {
    id: recordId,
    date: today,
    kassaNomi: activeKassa,
    kassirIsmi: cashier.ism,
    kassirId: cashier.id,
    isOchiq: true,
    ochilganVaqt: getUzbekTimeStr(),
    ertalabkiSdacha: 0,
    naqdPul: 0,
    terminalSumma: 0,
    terminalList: [],
    clickSumma: 0,
    clickList: [],
    qarzList: [],
    firmaList: [],
    rasxodList: [],
    chekdagiSumma: 0,
    izoh: '',
    updatedAt: new Date().toISOString(),
  };
  records.unshift(fresh);
  return { records, idx: 0, record: fresh, recordId, today };
}

function buildCloseDraftRecord(prev: any, draft: NonNullable<BotSession['draft']>, activeKassa: string, cashier: any, today: string, vaqt: string) {
  const qarzList = draft.keepExistingQarz
    ? prev.qarzList || []
    : draft.qarzSumma && draft.qarzSumma > 0
      ? [{ id: `qarz-bot-${Date.now()}`, nomi: 'Telegramdan kiritildi', summa: draft.qarzSumma, vaqt }]
      : [];

  const firmaList = draft.keepExistingFirma
    ? prev.firmaList || []
    : draft.firmaSumma && draft.firmaSumma > 0
      ? [{ id: `firma-bot-${Date.now()}`, nomi: 'Firmalar (Telegramdan)', summa: draft.firmaSumma, vaqt }]
      : [];

  const rasxodList = draft.keepExistingRasxod
    ? prev.rasxodList || []
    : draft.rasxodSumma && draft.rasxodSumma > 0
      ? [{ id: `rasxod-bot-${Date.now()}`, nomi: 'Rasxodlar (Telegramdan)', summa: draft.rasxodSumma, vaqt }]
      : [];

  return {
    id: `${today}__${activeKassa}`,
    date: today,
    kassaNomi: activeKassa,
    kassirIsmi: cashier.ism,
    kassirId: cashier.id,
    isOchiq: false,
    ochilganVaqt: prev.ochilganVaqt || vaqt,
    yopilganVaqt: vaqt,
    naqdPul: draft.naqdPul ?? 0,
    ertalabkiSdacha: Number(prev.ertalabkiSdacha) || 0,
    terminalSumma: draft.terminalSumma ?? 0,
    terminalList: draft.keepExistingTerminalList ? prev.terminalList || [] : [],
    clickSumma: draft.clickSumma ?? 0,
    clickList: draft.keepExistingClickList ? prev.clickList || [] : [],
    qarzList,
    firmaList,
    rasxodList,
    chekdagiSumma: draft.chekdagiSumma ?? 0,
    izoh: prev.izoh || 'Telegram bot orqali yopildi',
    updatedAt: new Date().toISOString(),
  };
}

async function startKassaOchishFlow(botToken: string, chatId: string, activeKassa: string) {
  const today = getUzbekTodayDate();
  const existing = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
  const curSdacha = Number(existing?.ertalabkiSdacha) || 0;
  setSession(chatId, { step: 'awaiting_open_sdacha' });

  const quick = [
    { label: curSdacha > 0 ? `Hozirgi: ${curSdacha}` : '0', value: curSdacha },
    ...(curSdacha > 0 ? [{ value: 0 }] : []),
    { value: 50000 },
    { value: 100000 },
  ];

  await tgSend(
    botToken,
    chatId,
    `🟢 <b>${escapeHtml(activeKassa)} ni ochish</b>\n` +
      (existing?.isOchiq
        ? `ℹ️ Bu kassa bugun allaqachon <b>ochilgan</b> (${escapeHtml(existing.ochilganVaqt || '-')}, sdacha: <code>${fmtNum(curSdacha)} so'm</code>).\nYangilash uchun `
        : '') +
      `Ertalab kassada qoldirilgan mayda pul (<b>sdacha</b>) qancha? (bo'lmasa <code>0</code> bosing):`,
    cancelKeyboard(quick)
  );
}

async function startKassaYopishFlow(botToken: string, chatId: string, activeKassa: string) {
  const today = getUzbekTodayDate();
  const prev = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
  const curNaqd = Number(prev?.naqdPul) || 0;

  setSession(chatId, { step: 'close_naqd', draft: {} });
  const quick = curNaqd > 0 ? [{ label: `Hozirgi: ${curNaqd}`, value: curNaqd }, { value: 0 }] : [{ value: 0 }];

  await tgSend(
    botToken,
    chatId,
    `🔒 <b>${escapeHtml(activeKassa)} — Kunlik Hisobot Yopish (1/7)</b>\n\n` +
      `1️⃣ Kassadan sanab chiqilgan jami <b>Naqd pul</b> qancha?` +
      (curNaqd > 0 ? `\n<i>(Avval kiritilgan: <code>${fmtNum(curNaqd)} so'm</code>)</i>` : ''),
    cancelKeyboard(quick)
  );
}

async function showBugungiNatija(
  botToken: string,
  chatId: string,
  activeKassa: string,
  editMessageId?: number
) {
  const today = getUzbekTodayDate();
  const recordId = `${today}__${activeKassa}`;
  const found = readRecordsFromDisk().find((r: any) => r.id === recordId);

  const inlineKb = {
    inline_keyboard: [
      [
        { text: '🔄 Yangilash', callback_data: 'nav:today' },
        { text: '➕ Kirim / Chiqim', callback_data: 'nav:kirim' },
      ],
      [{ text: '🔒 Kassa Yopish', callback_data: 'nav:yopish' }],
    ],
  };

  if (!found) {
    const emptyMsg =
      `ℹ️ Bugun (<b>${escapeHtml(today)}</b>) <b>${escapeHtml(activeKassa)}</b> uchun hali ma'lumot kiritilmagan.\n\n` +
      `🟢 <b>Kassa Ochish</b> yoki ➕ <b>Kirim / Chiqim</b> tugmasini bosing.`;
    if (editMessageId) {
      await tgEdit(botToken, chatId, editMessageId, emptyMsg, inlineKb);
    } else {
      await tgSend(botToken, chatId, emptyMsg, inlineKb);
    }
    return;
  }

  const reportHtml = buildReportHtml(found, getUzbekTimeStr());
  if (editMessageId) {
    await tgEdit(botToken, chatId, editMessageId, reportHtml, inlineKb);
  } else {
    await tgSend(botToken, chatId, reportHtml, inlineKb);
  }
}

async function showKirimMenu(
  botToken: string,
  chatId: string,
  activeKassa: string,
  editMessageId?: number
) {
  const today = getUzbekTodayDate();
  const found = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
  const t = found ? computeTotalsServer(found) : null;
  const hasUndoable = Boolean(
    found &&
      ((found.qarzList && found.qarzList.length > 0) ||
        (found.firmaList && found.firmaList.length > 0) ||
        (found.rasxodList && found.rasxodList.length > 0))
  );

  const summaryLine = t
    ? `💵 Naqd: <code>${fmtNum(t.naqdSanalgan)}</code> | 💳 Term: <code>${fmtNum(t.terminalJami)}</code> | 📱 Click: <code>${fmtNum(t.clickJami)}</code>\n` +
      `📝 Qarz: <code>${fmtNum(t.qarzJami)}</code> | 🚚 Firma: <code>${fmtNum(t.firmaJami)}</code> | 📦 Rasxod: <code>${fmtNum(t.rasxodJami)}</code>`
    : `<i>Bugun hali yozuv kiritilmagan</i>`;

  const msg =
    `➕ <b>[${escapeHtml(activeKassa)} — KIRIM / CHIQIM KIRITISH]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${summaryLine}\n\n` +
    `Kerakli bo'limni tanlang 👇`;

  const kb = kirimInlineKeyboard(hasUndoable);
  if (editMessageId) {
    await tgEdit(botToken, chatId, editMessageId, msg, kb);
  } else {
    await tgSend(botToken, chatId, msg, kb);
  }
}

export async function handleIncomingBotUpdate(botToken: string, cfg: any, upd: any) {
  if (upd.callback_query) {
    await handleCallbackQuery(botToken, cfg, upd.callback_query);
    return;
  }
  if (upd.message) {
    await handleIncomingBotMessage(botToken, cfg, upd.message);
  }
}

async function handleCallbackQuery(botToken: string, cfg: any, cq: any) {
  const cqId = cq.id;
  const msg = cq.message;
  if (!msg || !msg.chat) {
    await tgAnswerCallback(botToken, cqId);
    return;
  }

  const chatId = String(msg.chat.id);
  const fromId = String(cq.from?.id || msg.chat.id);
  const messageId = Number(msg.message_id);
  const data = String(cq.data || '');
  const adminChatId = cfg?.chatId ? String(cfg.chatId).trim() : '';
  const isAdmin = Boolean(adminChatId && (chatId === adminChatId || fromId === adminChatId));
  const isPrivateChat = msg.chat?.type === 'private';
  const miniAppUrl = getEffectiveMiniAppUrl(cfg);
  const botKb = mainBotKeyboard(miniAppUrl, isPrivateChat, isAdmin);

  await tgAnswerCallback(botToken, cqId);

  // Admin inline actions
  if (data.startsWith('admin:')) {
    if (!isAdmin) {
      await tgSend(botToken, chatId, `⛔ Bu bo'lim faqat do'kon egasi (Admin) uchun.`);
      return;
    }
    if (data === 'admin:today') {
      await tgEdit(botToken, chatId, messageId, buildAdminSummaryHtml(getUzbekTodayDate(0), 'BUGUNGI BARCHA KASSALAR'), adminInlineKeyboard());
      return;
    }
    if (data === 'admin:yesterday') {
      await tgEdit(botToken, chatId, messageId, buildAdminSummaryHtml(getUzbekTodayDate(-1), 'KECHAGI BARCHA KASSALAR'), adminInlineKeyboard());
      return;
    }
    if (data === 'admin:cashiers') {
      const cashiers = readCashiersFromDisk();
      const today = getUzbekTodayDate();
      const todayRecs = readRecordsFromDisk().filter((r: any) => r.date === today);
      const listTxt =
        cashiers.length === 0
          ? `<i>Hali birorta kassir ro'yxatdan o'tmagan.</i>`
          : cashiers
              .map((c: any, idx: number) => {
                const activeRec = todayRecs.find((r: any) => r.kassirId === c.id || r.kassirIsmi === c.ism);
                const status = activeRec ? (activeRec.isOchiq ? '🟢 Smenada' : '🔒 Yopgan') : '⚪️ Kirmagan';
                const uname = c.telegramUsername ? ` (@${escapeHtml(c.telegramUsername)})` : '';
                return `${idx + 1}. <b>${escapeHtml(c.ism)}</b>${uname} — 🏪 ${escapeHtml(c.asosiyKassa || '1-Kassa')} | ${status}`;
              })
              .join('\n');

      await tgEdit(
        botToken,
        chatId,
        messageId,
        `👥 <b>[RO'YXATDAN O'TGAN KASSIRLAR (${cashiers.length} ta)]</b>\n━━━━━━━━━━━━━━━━━━━━\n${listTxt}`,
        adminInlineKeyboard()
      );
      return;
    }
  }

  const cashiers = readCashiersFromDisk();
  const cashier = cashiers.find(
    (c: any) => String(c.telegramId || '') === fromId || String(c.telegramId || '') === chatId
  );

  if (!cashier) {
    setSession(chatId, { step: 'awaiting_name' });
    await tgSend(botToken, chatId, `📝 Avval ro'yxatdan o'ting — ismingizni yozib yuboring:`);
    return;
  }

  const activeKassa = cashier.asosiyKassa || '1-Kassa';
  const today = getUzbekTodayDate();

  if (data === 'nav:today') {
    await showBugungiNatija(botToken, chatId, activeKassa, messageId);
    return;
  }

  if (data === 'nav:kirim') {
    setSession(chatId, { step: 'idle' });
    await showKirimMenu(botToken, chatId, activeKassa, messageId);
    return;
  }

  if (data === 'nav:ochish') {
    await startKassaOchishFlow(botToken, chatId, activeKassa);
    return;
  }

  if (data === 'nav:yopish') {
    await startKassaYopishFlow(botToken, chatId, activeKassa);
    return;
  }

  if (data === 'kirim:qarz') {
    setSession(chatId, { step: 'kirim_qarz_name', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `📝 <b>Qarzga berildi</b> (${escapeHtml(activeKassa)})\nKim qarz oldi? Ism yoki izoh yozing:`,
      cancelKeyboard()
    );
    return;
  }

  if (data === 'kirim:firma') {
    setSession(chatId, { step: 'kirim_firma_name', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `🚚 <b>Firmaga to'lov</b> (${escapeHtml(activeKassa)})\nQaysi firmaga pul berildi? Firma nomini yozing:`,
      cancelKeyboard()
    );
    return;
  }

  if (data === 'kirim:rasxod') {
    setSession(chatId, { step: 'kirim_rasxod_name', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `📦 <b>Kunlik rasxod</b> (${escapeHtml(activeKassa)})\nNima uchun xarajat qilindi? (masalan: Abed, Paket, Taksi):`,
      cancelKeyboard()
    );
    return;
  }

  if (data === 'kirim:naqd') {
    const rec = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
    const cur = Number(rec?.naqdPul) || 0;
    setSession(chatId, { step: 'kirim_naqd', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `💵 <b>Naqd pul kiritish</b> (${escapeHtml(activeKassa)})\nHozirgi qiymat: <code>${fmtNum(cur)} so'm</code>\nYangi jami naqd pul summasini kiriting:`,
      cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }] : [])
    );
    return;
  }

  if (data === 'kirim:terminal') {
    const rec = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
    const cur = rec ? computeTotalsServer(rec).terminalJami : 0;
    setSession(chatId, { step: 'kirim_terminal', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `💳 <b>Terminal (Humo/Uzcard) kiritish</b> (${escapeHtml(activeKassa)})\nHozirgi qiymat: <code>${fmtNum(cur)} so'm</code>\nTerminal summasini kiriting:`,
      cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }] : [])
    );
    return;
  }

  if (data === 'kirim:click') {
    const rec = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
    const cur = rec ? computeTotalsServer(rec).clickJami : 0;
    setSession(chatId, { step: 'kirim_click', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `📱 <b>Click / Payme kiritish</b> (${escapeHtml(activeKassa)})\nHozirgi qiymat: <code>${fmtNum(cur)} so'm</code>\nClick/Payme summasini kiriting:`,
      cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }] : [])
    );
    return;
  }

  if (data === 'kirim:chek') {
    const rec = readRecordsFromDisk().find((r: any) => r.id === `${today}__${activeKassa}`);
    const cur = Number(rec?.chekdagiSumma) || 0;
    setSession(chatId, { step: 'kirim_chek', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `🧾 <b>Chekdagi summa kiritish</b> (${escapeHtml(activeKassa)})\nHozirgi qiymat: <code>${fmtNum(cur)} so'm</code>\nZ-hisobot chekidagi umumiy summani kiriting:`,
      cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }] : [])
    );
    return;
  }

  if (data === 'kirim:undo') {
    const { records, idx, record } = getOrInitTodayRecord(activeKassa, cashier);
    const candidates: Array<{ type: 'qarz' | 'firma' | 'rasxod'; item: any; label: string }> = [];
    if (Array.isArray(record.qarzList) && record.qarzList.length > 0) {
      const last = record.qarzList[record.qarzList.length - 1];
      candidates.push({ type: 'qarz', item: last, label: `📝 Qarz: ${last.nomi} (${fmtNum(last.summa)})` });
    }
    if (Array.isArray(record.firmaList) && record.firmaList.length > 0) {
      const last = record.firmaList[record.firmaList.length - 1];
      candidates.push({ type: 'firma', item: last, label: `🚚 Firma: ${last.nomi} (${fmtNum(last.summa)})` });
    }
    if (Array.isArray(record.rasxodList) && record.rasxodList.length > 0) {
      const last = record.rasxodList[record.rasxodList.length - 1];
      candidates.push({ type: 'rasxod', item: last, label: `📦 Rasxod: ${last.nomi} (${fmtNum(last.summa)})` });
    }
    if (candidates.length === 0) {
      await showKirimMenu(botToken, chatId, activeKassa, messageId);
      return;
    }
    const rows = candidates.map((c) => [
      { text: `🗑 O'chirish: ${c.label}`, callback_data: `undo_do:${c.type}` },
    ]);
    rows.push([{ text: '⬅️ Orqaga', callback_data: 'nav:kirim' }]);
    await tgEdit(
      botToken,
      chatId,
      messageId,
      `🗑 <b>Qaysi oxirgi yozuvni o'chirmoqchisiz?</b>`,
      { inline_keyboard: rows }
    );
    void records;
    void idx;
    return;
  }

  if (data.startsWith('undo_do:')) {
    const kind = data.split(':')[1] as 'qarz' | 'firma' | 'rasxod';
    const { records, idx, record } = getOrInitTodayRecord(activeKassa, cashier);
    const key = kind === 'qarz' ? 'qarzList' : kind === 'firma' ? 'firmaList' : 'rasxodList';
    const list = Array.isArray(record[key]) ? [...record[key]] : [];
    const removed = list.pop();
    if (removed) {
      records[idx] = { ...record, [key]: list, updatedAt: new Date().toISOString() };
      writeRecordsToDisk(records);
    }
    await showKirimMenu(botToken, chatId, activeKassa, messageId);
    return;
  }

  // Close shift confirmation callbacks
  if (data === 'close:confirm') {
    const session = getSession(chatId);
    if (session.step !== 'close_confirm' || !session.draft) {
      await tgEdit(botToken, chatId, messageId, `ℹ️ Bu hisobot allaqachon yakunlangan yoki bekor qilingan.`);
      return;
    }

    const vaqt = getUzbekTimeStr();
    const records = readRecordsFromDisk();
    const recordId = `${today}__${activeKassa}`;
    const idx = records.findIndex((r: any) => r.id === recordId);
    const prev = idx >= 0 ? records[idx] : {};

    const updated = buildCloseDraftRecord(prev, session.draft, activeKassa, cashier, today, vaqt);
    if (idx >= 0) records[idx] = updated;
    else records.unshift(updated);
    writeRecordsToDisk(records);
    setSession(chatId, { step: 'idle' });

    const reportHtml = buildReportHtml(updated, vaqt, false);
    await tgEdit(
      botToken,
      chatId,
      messageId,
      `✅ <b>Hisobot saqlandi va adminga yuborildi!</b>\n\n${reportHtml}`
    );
    await tgSend(botToken, chatId, `🏠 Asosiy menyu:`, botKb);

    const shouldNotifyAdmin = cfg?.autoSendOnClose !== false;
    if (shouldNotifyAdmin && adminChatId && adminChatId !== chatId) {
      await tgSend(botToken, adminChatId, reportHtml);
    }
    return;
  }

  if (data === 'close:restart') {
    await startKassaYopishFlow(botToken, chatId, activeKassa);
    return;
  }

  if (data === 'close:cancel') {
    setSession(chatId, { step: 'idle' });
    await tgEdit(botToken, chatId, messageId, `❌ Kassa yopish bekor qilindi.`);
    await tgSend(botToken, chatId, `Kerakli bo'limni tanlang 👇`, botKb);
    return;
  }
}

export async function handleIncomingBotMessage(botToken: string, cfg: any, msg: any) {
  const chatId = String(msg.chat.id);
  const fromId = String(msg.from?.id || msg.chat.id);
  const tgFirstName = msg.from?.first_name || msg.chat.title || 'Kassir';
  const tgUsername = msg.from?.username;
  const text = String(msg.text || '').trim();
  if (!text) return;

  const isPrivateChat = msg.chat?.type === 'private';
  const miniAppUrl = getEffectiveMiniAppUrl(cfg);
  const adminChatId = cfg?.chatId ? String(cfg.chatId).trim() : '';
  const isAdmin = Boolean(adminChatId && (chatId === adminChatId || fromId === adminChatId));
  const botKb = mainBotKeyboard(miniAppUrl, isPrivateChat, isAdmin);

  const cashiers = readCashiersFromDisk();
  let cashier = cashiers.find(
    (c: any) => String(c.telegramId || '') === fromId || String(c.telegramId || '') === chatId
  );

  const session = getSession(chatId);

  // Global cancel or /bekor
  if (text === '❌ Bekor qilish' || text.startsWith('/bekor')) {
    setSession(chatId, { step: 'idle' });
    if (cashier) {
      await tgSend(botToken, chatId, `Bekor qilindi. Kerakli bo'limni tanlang 👇`, botKb);
    } else {
      await tgSend(botToken, chatId, `Ismingizni yozib yuboring (masalan: Dilshod Karimov):`);
    }
    return;
  }

  // Admin panel (allowed even before cashier registration if adminChatId matches!)
  if (text === '👑 Admin Panel' || text.startsWith('/admin')) {
    if (!isAdmin) {
      await tgSend(
        botToken,
        chatId,
        `⛔ Bu bo'lim faqat do'kon egasi (Admin) uchun.\nSizning Chat ID: <code>${escapeHtml(chatId)}</code>`,
        cashier ? botKb : undefined
      );
      return;
    }
    setSession(chatId, { step: 'idle' });
    await tgSend(
      botToken,
      chatId,
      buildAdminSummaryHtml(getUzbekTodayDate(0), 'BUGUNGI BARCHA KASSALAR'),
      adminInlineKeyboard()
    );
    return;
  }

  // /start or /kassa
  if (text.startsWith('/start') || text.startsWith('/kassa')) {
    if (isPrivateChat && miniAppUrl) {
      setMenuButtonForChat(
        botToken,
        { type: 'web_app', text: '📱 Kassa', web_app: { url: miniAppUrl } },
        chatId
      ).catch(() => {});
    }
    if (!cashier) {
      setSession(chatId, { step: 'awaiting_name' });
      const suggested =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || tgFirstName;
      await tgSend(
        botToken,
        chatId,
        `👋 <b>Assalomu alaykum, ${escapeHtml(tgFirstName)}!</b>\n\n` +
          `🏪 <b>Navo Market Kassa</b> botiga xush kelibsiz!\n` +
          `📝 Ro'yxatdan o'tish uchun o'z <b>ismingizni</b> yozib yuboring (yoki pastdagi tugmani bosing):`,
        {
          keyboard: [[{ text: suggested }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        }
      );
      return;
    }

    setSession(chatId, { step: 'idle' });
    await tgSend(
      botToken,
      chatId,
      `👋 <b>Xush kelibsiz, ${escapeHtml(cashier.ism)}!</b>\n` +
        `🏪 Faol kassa: <b>${escapeHtml(cashier.asosiyKassa || '1-Kassa')}</b>\n\n` +
        (isPrivateChat && miniAppUrl
          ? `📱 <b>Mini App</b> tayyor! Pastdagi <b>«📱 Mini App Ochish (Kassa)»</b> tugmasini yoki chap pastdagi <b>📱 Kassa</b> menyusini bosing 👇`
          : `Pastdagi tugmalar orqali kassa ochish, kirim/chiqim kiritish yoki hisobot yopishingiz mumkin 👇`),
      botKb
    );
    return;
  }

  // Registered cashier menu overrides (can interrupt any active flow cleanly)
  if (cashier) {
    if (text === '🏪 Kassani Tanlash') {
      setSession(chatId, { step: 'idle' });
      await tgSend(botToken, chatId, `Qaysi kassada ishlayapsiz? Tanlang:`, {
        keyboard: [
          [{ text: '🏪 1-Kassa' }, { text: '🏪 2-Kassa' }],
          [{ text: '🏪 3-Kassa' }, { text: '🏪 4-Kassa' }],
          [{ text: '✏️ Boshqa kassa nomi' }, { text: '❌ Bekor qilish' }],
        ],
        resize_keyboard: true,
      });
      return;
    }

    if (text === '✏️ Boshqa kassa nomi') {
      setSession(chatId, { step: 'awaiting_custom_kassa' });
      await tgSend(botToken, chatId, `Kassa nomini yozing (masalan: <code>Asosiy Kassa</code>):`, cancelKeyboard());
      return;
    }

    if (text.startsWith('🏪 ') && text.includes('Kassa')) {
      setSession(chatId, { step: 'idle' });
      const kassaName = text.replace('🏪 ', '').trim();
      const updatedCashiers = readCashiersFromDisk().map((c: any) =>
        c.id === cashier.id ? { ...c, asosiyKassa: kassaName, lastActiveAt: new Date().toISOString() } : c
      );
      writeCashiersToDisk(updatedCashiers);
      await tgSend(botToken, chatId, `✅ Faol kassa o'zgartirildi: <b>${escapeHtml(kassaName)}</b>`, botKb);
      return;
    }

    if (text === "👤 Ismni O'zgartirish") {
      setSession(chatId, { step: 'awaiting_name' });
      await tgSend(botToken, chatId, `Yangi ismingizni yozib yuboring:`, cancelKeyboard());
      return;
    }
  }

  // Custom register name step
  if (cashier && session.step === 'awaiting_custom_kassa') {
    const kassaName = text.replace(/^🏪\s*/, '').trim();
    if (kassaName.length < 2 || kassaName.startsWith('/')) {
      await tgSend(botToken, chatId, `Kassa nomi kamida 2 ta belgidan iborat bo'lsin:`);
      return;
    }
    const updatedCashiers = readCashiersFromDisk().map((c: any) =>
      c.id === cashier.id ? { ...c, asosiyKassa: kassaName, lastActiveAt: new Date().toISOString() } : c
    );
    writeCashiersToDisk(updatedCashiers);
    setSession(chatId, { step: 'idle' });
    await tgSend(botToken, chatId, `✅ Faol kassa o'zgartirildi: <b>${escapeHtml(kassaName)}</b>`, botKb);
    return;
  }

  // Registration step: awaiting_name
  if (session.step === 'awaiting_name' || !cashier) {
    const cleanName = text.replace(/^👤\s*/, '').trim();
    if (cleanName.length < 2 || cleanName.startsWith('/')) {
      await tgSend(botToken, chatId, `Iltimos, to'liq ismingizni yozing (kamida 2 ta harf):`);
      return;
    }

    const now = new Date().toISOString();
    const existingByNameIdx = cashiers.findIndex(
      (c: any) => String(c.ism || '').trim().toLowerCase() === cleanName.toLowerCase()
    );
    let isNew = false;

    if (existingByNameIdx >= 0) {
      cashier = {
        ...cashiers[existingByNameIdx],
        ism: cleanName,
        telegramId: fromId,
        telegramUsername: tgUsername || cashiers[existingByNameIdx].telegramUsername,
        lastActiveAt: now,
      };
      cashiers[existingByNameIdx] = cashier;
    } else {
      isNew = true;
      cashier = {
        id: `kassir-${Date.now()}`,
        ism: cleanName,
        telefon: '',
        telegramId: fromId,
        telegramUsername: tgUsername,
        asosiyKassa: '1-Kassa',
        createdAt: now,
        lastActiveAt: now,
      };
      cashiers.unshift(cashier);
    }
    writeCashiersToDisk(cashiers);
    setSession(chatId, { step: 'idle' });

    await tgSend(
      botToken,
      chatId,
      `✅ <b>Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>\n` +
        `👤 Kassir: <b>${escapeHtml(cashier.ism)}</b>\n` +
        `🏪 Kassa: <b>${escapeHtml(cashier.asosiyKassa)}</b>\n\n` +
        `Endi pastdagi tugmalardan bemalol foydalanishingiz mumkin 👇`,
      botKb
    );

    if (isNew && adminChatId && adminChatId !== chatId) {
      await tgSend(
        botToken,
        adminChatId,
        `👤 <b>[YANGI KASSIR RO'YXATDAN O'TDI]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🏷 <b>Ismi:</b> ${escapeHtml(cashier.ism)}\n` +
          (tgUsername ? `📱 <b>Telegram:</b> @${escapeHtml(tgUsername)}\n` : '') +
          `🏪 <b>Kassa:</b> ${escapeHtml(cashier.asosiyKassa)}\n` +
          `⏰ <b>Vaqt:</b> ${getUzbekTimeStr()}`
      );
    }
    return;
  }

  const activeKassa = cashier.asosiyKassa || '1-Kassa';
  const today = getUzbekTodayDate();
  const recordId = `${today}__${activeKassa}`;

  // Top-level action buttons & slash shortcuts
  if (text === '🟢 Kassa Ochish' || text.startsWith('/ochish')) {
    await startKassaOchishFlow(botToken, chatId, activeKassa);
    return;
  }

  if (text === '📊 Bugungi Natija' || text.startsWith('/natija')) {
    setSession(chatId, { step: 'idle' });
    await showBugungiNatija(botToken, chatId, activeKassa);
    return;
  }

  if (text === '➕ Kirim / Chiqim' || text.startsWith('/kirim')) {
    setSession(chatId, { step: 'idle' });
    await showKirimMenu(botToken, chatId, activeKassa);
    return;
  }

  if (
    text === '🔒 Kassa Yopish' ||
    text === '🔒 Kassa Yopish (Hisobot)' ||
    text.startsWith('/yopish')
  ) {
    await startKassaYopishFlow(botToken, chatId, activeKassa);
    return;
  }

  // Open shift sdacha
  if (session.step === 'awaiting_open_sdacha') {
    const sdacha = parseBotAmount(text);
    if (sdacha === null) {
      await tgSend(botToken, chatId, `⚠️ Iltimos, faqat raqam kiriting (masalan: <code>0</code> yoki <code>75000</code>):`);
      return;
    }
    const vaqt = getUzbekTimeStr();
    const { records, idx, record } = getOrInitTodayRecord(activeKassa, cashier);
    const updated = {
      ...record,
      kassirIsmi: cashier.ism,
      kassirId: cashier.id,
      isOchiq: true,
      ochilganVaqt: record.ochilganVaqt || vaqt,
      ertalabkiSdacha: sdacha,
      updatedAt: new Date().toISOString(),
    };
    records[idx] = updated;
    writeRecordsToDisk(records);
    setSession(chatId, { step: 'idle' });

    const openMsg =
      `🟢 <b>[NAVO MARKET — KASSA OCHILDI]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏪 <b>Kassa:</b> ${escapeHtml(activeKassa)}\n` +
      `👤 <b>Kassir:</b> ${escapeHtml(cashier.ism)}\n` +
      `📅 <b>Sana:</b> ${escapeHtml(today)}\n` +
      `⏰ <b>Ochilgan vaqt:</b> ${vaqt}\n` +
      (sdacha > 0 ? `💵 <b>Ertalabki sdacha:</b> <code>${fmtNum(sdacha)} so'm</code>\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Smena boshlandi!`;

    await tgSend(botToken, chatId, openMsg, botKb);
    if (cfg?.autoSendOnOpen !== false && adminChatId && adminChatId !== chatId) {
      await tgSend(botToken, adminChatId, openMsg);
    }
    return;
  }

  // Intraday Kirim / Chiqim entry steps
  if (
    session.step === 'kirim_qarz_name' ||
    session.step === 'kirim_firma_name' ||
    session.step === 'kirim_rasxod_name'
  ) {
    if (text.length < 2 || text.startsWith('/')) {
      await tgSend(botToken, chatId, `Iltimos, kamida 2 ta harfli nom yoki izoh yozing:`);
      return;
    }
    const nextStep =
      session.step === 'kirim_qarz_name'
        ? 'kirim_qarz_amount'
        : session.step === 'kirim_firma_name'
          ? 'kirim_firma_amount'
          : 'kirim_rasxod_amount';
    setSession(chatId, { step: nextStep, draft: { itemName: text } });
    await tgSend(
      botToken,
      chatId,
      `💰 <b>${escapeHtml(text)}</b> uchun summa qancha? (faqat raqam yozing):`,
      cancelKeyboard()
    );
    return;
  }

  if (
    session.step === 'kirim_qarz_amount' ||
    session.step === 'kirim_firma_amount' ||
    session.step === 'kirim_rasxod_amount'
  ) {
    const val = parseBotAmount(text);
    if (val === null || val <= 0) {
      await tgSend(botToken, chatId, `⚠️ Iltimos, 0 dan katta raqam kiriting (masalan: <code>50000</code>):`);
      return;
    }
    const itemName = session.draft?.itemName || 'Kiritildi';
    const vaqt = getUzbekTimeStr();
    const { records, idx, record } = getOrInitTodayRecord(activeKassa, cashier);

    const isQarz = session.step === 'kirim_qarz_amount';
    const isFirma = session.step === 'kirim_firma_amount';
    const listKey = isQarz ? 'qarzList' : isFirma ? 'firmaList' : 'rasxodList';
    const prefix = isQarz ? 'qarz' : isFirma ? 'firma' : 'rasxod';
    const entry = { id: `${prefix}-bot-${Date.now()}`, nomi: itemName, summa: val, vaqt };

    const updated = {
      ...record,
      kassirIsmi: cashier.ism,
      kassirId: cashier.id,
      [listKey]: [...(Array.isArray(record[listKey]) ? record[listKey] : []), entry],
      updatedAt: new Date().toISOString(),
    };
    records[idx] = updated;
    writeRecordsToDisk(records);
    setSession(chatId, { step: 'idle' });

    const label = isQarz ? '📝 Qarzga' : isFirma ? "🚚 Firmaga to'lov" : '📦 Rasxod';
    const totals = computeTotalsServer(updated);
    const bucketTotal = isQarz ? totals.qarzJami : isFirma ? totals.firmaJami : totals.rasxodJami;

    await tgSend(
      botToken,
      chatId,
      `✅ <b>Saqlandi!</b>\n` +
        `${label}: <b>${escapeHtml(itemName)}</b> — <code>${fmtNum(val)} so'm</code>\n` +
        `📊 Bugungi jami (${label}): <code>${fmtNum(bucketTotal)} so'm</code>`,
      botKb
    );

    if (cfg?.autoSendOnTransaction && adminChatId && adminChatId !== chatId) {
      await tgSend(
        botToken,
        adminChatId,
        `⚡ <b>[YANGI AMALIYOT — ${escapeHtml(activeKassa)}]</b>\n` +
          `👤 <b>Kassir:</b> ${escapeHtml(cashier.ism)}\n` +
          `${label}: <b>${escapeHtml(itemName)}</b>\n` +
          `💰 <b>Summa:</b> <code>${fmtNum(val)} so'm</code>\n` +
          `⏰ <b>Vaqt:</b> ${vaqt}`
      );
    }
    return;
  }

  if (
    session.step === 'kirim_naqd' ||
    session.step === 'kirim_terminal' ||
    session.step === 'kirim_click' ||
    session.step === 'kirim_chek'
  ) {
    const val = parseBotAmount(text);
    if (val === null) {
      await tgSend(botToken, chatId, `⚠️ Iltimos, faqat raqam kiriting (masalan: <code>1500000</code> yoki <code>0</code>):`);
      return;
    }
    const { records, idx, record } = getOrInitTodayRecord(activeKassa, cashier);
    const updated = { ...record, kassirIsmi: cashier.ism, kassirId: cashier.id, updatedAt: new Date().toISOString() };
    let label = '';
    if (session.step === 'kirim_naqd') {
      updated.naqdPul = val;
      label = '💵 Naqd pul';
    } else if (session.step === 'kirim_terminal') {
      updated.terminalSumma = val;
      updated.terminalList = [];
      label = '💳 Terminal';
    } else if (session.step === 'kirim_click') {
      updated.clickSumma = val;
      updated.clickList = [];
      label = '📱 Click / Payme';
    } else {
      updated.chekdagiSumma = val;
      label = '🧾 Chekdagi summa';
    }
    records[idx] = updated;
    writeRecordsToDisk(records);
    setSession(chatId, { step: 'idle' });

    await tgSend(
      botToken,
      chatId,
      `✅ <b>${label}</b> yangilandi: <code>${fmtNum(val)} so'm</code>\n🏪 ${escapeHtml(activeKassa)}`,
      botKb
    );
    return;
  }

  // Smart 7-step Close Shift Flow
  if (session.step.startsWith('close_')) {
    if (session.step === 'close_confirm') {
      await tgSend(
        botToken,
        chatId,
        `👆 Tepadagi hisobot ostidagi <b>✅ Tasdiqlash va Yopish</b> tugmasini bosing yoki <b>❌ Bekor qilish</b> ni tanlang.`
      );
      return;
    }

    const val = parseBotAmount(text);
    if (val === null) {
      await tgSend(botToken, chatId, `⚠️ Iltimos, faqat raqam kiriting (masalan: <code>1500000</code> yoki <code>0</code>):`);
      return;
    }

    const prev = readRecordsFromDisk().find((r: any) => r.id === recordId) || {};
    const prevTotals = computeTotalsServer(prev);
    const draft = { ...(session.draft || {}) };

    if (session.step === 'close_naqd') {
      draft.naqdPul = val;
      setSession(chatId, { step: 'close_terminal', draft });
      const cur = prevTotals.terminalJami;
      await tgSend(
        botToken,
        chatId,
        `2️⃣ <b>Terminal</b> (Humo / Uzcard) jami qancha bo'ldi? (2/7)` +
          (cur > 0 ? `\n<i>(Avval kiritilgan: <code>${fmtNum(cur)} so'm</code>)</i>` : ''),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [{ value: 0 }])
      );
      return;
    }

    if (session.step === 'close_terminal') {
      draft.terminalSumma = val;
      draft.keepExistingTerminalList =
        val === prevTotals.terminalJami && Array.isArray(prev.terminalList) && prev.terminalList.length > 0;
      setSession(chatId, { step: 'close_click', draft });
      const cur = prevTotals.clickJami;
      await tgSend(
        botToken,
        chatId,
        `3️⃣ <b>Click / Payme</b> jami qancha bo'ldi? (3/7)` +
          (cur > 0 ? `\n<i>(Avval kiritilgan: <code>${fmtNum(cur)} so'm</code>)</i>` : ''),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [{ value: 0 }])
      );
      return;
    }

    if (session.step === 'close_click') {
      draft.clickSumma = val;
      draft.keepExistingClickList =
        val === prevTotals.clickJami && Array.isArray(prev.clickList) && prev.clickList.length > 0;
      setSession(chatId, { step: 'close_qarz', draft });
      const cur = prevTotals.qarzJami;
      const count = Array.isArray(prev.qarzList) ? prev.qarzList.length : 0;
      await tgSend(
        botToken,
        chatId,
        `4️⃣ <b>Qarzga berilgan pullar</b> jami qancha? (4/7)` +
          (cur > 0
            ? `\n<i>(Kiritilgan ${count} ta qarz jami: <code>${fmtNum(cur)} so'm</code>. Ro'yxatni saqlab qolish uchun «Hozirgi» tugmasini bosing)</i>`
            : ` (bo'lmasa <code>0</code>)`),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [{ value: 0 }])
      );
      return;
    }

    if (session.step === 'close_qarz') {
      draft.qarzSumma = val;
      draft.keepExistingQarz =
        val === prevTotals.qarzJami && Array.isArray(prev.qarzList) && prev.qarzList.length > 0;
      setSession(chatId, { step: 'close_firma', draft });
      const cur = prevTotals.firmaJami;
      const count = Array.isArray(prev.firmaList) ? prev.firmaList.length : 0;
      await tgSend(
        botToken,
        chatId,
        `5️⃣ <b>Firmaga berilgan pullar</b> jami qancha? (5/7)` +
          (cur > 0
            ? `\n<i>(Kiritilgan ${count} ta firma to'lovi jami: <code>${fmtNum(cur)} so'm</code>. Ro'yxatni saqlab qolish uchun «Hozirgi» tugmasini bosing)</i>`
            : ` (bo'lmasa <code>0</code>)`),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [{ value: 0 }])
      );
      return;
    }

    if (session.step === 'close_firma') {
      draft.firmaSumma = val;
      draft.keepExistingFirma =
        val === prevTotals.firmaJami && Array.isArray(prev.firmaList) && prev.firmaList.length > 0;
      setSession(chatId, { step: 'close_rasxod', draft });
      const cur = prevTotals.rasxodJami;
      const count = Array.isArray(prev.rasxodList) ? prev.rasxodList.length : 0;
      await tgSend(
        botToken,
        chatId,
        `6️⃣ <b>Boshqa rasxodlar</b> (abed, paket...) jami qancha? (6/7)` +
          (cur > 0
            ? `\n<i>(Kiritilgan ${count} ta rasxod jami: <code>${fmtNum(cur)} so'm</code>. Ro'yxatni saqlab qolish uchun «Hozirgi» tugmasini bosing)</i>`
            : ` (bo'lmasa <code>0</code>)`),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [{ value: 0 }])
      );
      return;
    }

    if (session.step === 'close_rasxod') {
      draft.rasxodSumma = val;
      draft.keepExistingRasxod =
        val === prevTotals.rasxodJami && Array.isArray(prev.rasxodList) && prev.rasxodList.length > 0;
      setSession(chatId, { step: 'close_chek', draft });
      const cur = Number(prev.chekdagiSumma) || 0;
      await tgSend(
        botToken,
        chatId,
        `7️⃣ <b>Chekdagi umumiy summa</b> (Kassa apparat / kompyuter) qancha? (7/7)` +
          (cur > 0 ? `\n<i>(Avval kiritilgan: <code>${fmtNum(cur)} so'm</code>)</i>` : ''),
        cancelKeyboard(cur > 0 ? [{ label: `Hozirgi: ${cur}`, value: cur }, { value: 0 }] : [])
      );
      return;
    }

    if (session.step === 'close_chek') {
      draft.chekdagiSumma = val;
      const vaqt = getUzbekTimeStr();
      const previewRecord = buildCloseDraftRecord(prev, draft, activeKassa, cashier, today, vaqt);
      setSession(chatId, { step: 'close_confirm', draft });

      const previewHtml = buildReportHtml(previewRecord, vaqt, true);
      await tgSend(botToken, chatId, previewHtml, {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlash va Yopish', callback_data: 'close:confirm' }],
          [
            { text: '✏️ Qayta kiritish', callback_data: 'close:restart' },
            { text: '❌ Bekor qilish', callback_data: 'close:cancel' },
          ],
        ],
      });
      return;
    }
  }

  // Fallback help
  await tgSend(
    botToken,
    chatId,
    `Pastdagi tugmalardan birini tanlang yoki /start bosing 👇`,
    botKb
  );
}

async function runTelegramLongPollCycle(): Promise<number> {
  const cfg = readTgConfigFromDisk();
  const botToken = cfg?.botToken ? String(cfg.botToken).trim() : '';

  if (!botToken) {
    activePolledToken = '';
    return 2500;
  }

  activePolledToken = botToken;

  try {
    if (webhookClearedForToken !== botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`).catch(() => {});
      const savedUrl = String(cfg?.miniAppUrl || '').trim();
      const effectiveUrl = getEffectiveMiniAppUrl(cfg);

      // Remove broken non-public preview/editor URLs (ais-dev, ais-pre, ai.studio) so Telegram never hits 403
      if (savedUrl && !isPublicMiniAppUrl(savedUrl)) {
        writeTgConfigToDisk({ ...cfg, miniAppUrl: '' });
      }

      if (effectiveUrl) {
        await syncMiniAppMenuButtons(botToken, effectiveUrl, '📱 Kassa').catch(() => {});
        if (!cfg?.miniAppUrl && !cfg?.miniAppDisabled) {
          writeTgConfigToDisk({ ...cfg, miniAppUrl: effectiveUrl });
        }
      } else {
        // Ensure old broken menu_button web_app link is removed from Telegram bot
        await syncMiniAppMenuButtons(botToken, '').catch(() => {});
      }
      await syncBotCommands(botToken);
      webhookClearedForToken = botToken;
    }

    const controller = new AbortController();
    pollerAbortController = controller;
    const abortTimer = setTimeout(() => controller.abort(), 28_000);

    const allowed = encodeURIComponent(JSON.stringify(['message', 'callback_query']));
    const offsetParam = lastPolledUpdateId > 0 ? `&offset=${lastPolledUpdateId + 1}` : '';
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?timeout=20&limit=30&allowed_updates=${allowed}${offsetParam}`;

    const res = await fetch(url, { signal: controller.signal }).finally(() => {
      clearTimeout(abortTimer);
      if (pollerAbortController === controller) pollerAbortController = null;
    });

    if (res.status === 409) {
      // Clear any stray webhook and pause cleanly so conflict heals automatically
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`).catch(() => {});
      return 8000;
    }

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok || !Array.isArray(data.result) || data.result.length === 0) {
      return 200;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let maxSeenId = lastPolledUpdateId;

    const freshUpdates: any[] = [];
    for (const upd of data.result) {
      const uid = typeof upd.update_id === 'number' ? upd.update_id : 0;
      if (uid > maxSeenId) maxSeenId = uid;
      if (uid > 0 && (uid <= lastPolledUpdateId || processedUpdateIds.has(uid))) {
        continue;
      }
      if (uid > 0) {
        processedUpdateIds.add(uid);
        if (processedUpdateIds.size > MAX_PROCESSED_IDS) {
          const oldest = processedUpdateIds.values().next().value;
          if (oldest !== undefined) processedUpdateIds.delete(oldest);
        }
      }
      freshUpdates.push(upd);
    }

    if (maxSeenId > lastPolledUpdateId) {
      lastPolledUpdateId = maxSeenId;
      writeLastPollUpdateId(lastPolledUpdateId);
    }

    for (const upd of freshUpdates) {
      const msg = upd.message || upd.callback_query?.message;
      const actor = upd.callback_query?.from || upd.message?.from;
      if (msg && msg.chat) {
        recentDetectedChat = {
          chatId: msg.chat.id,
          senderName: actor?.first_name || msg.chat.title || 'Kassir',
          senderUsername: actor?.username,
        };
      }

      // Skip stale backlog messages older than 120s on restart (callback queries never have date on cq itself, check sparingly)
      if (upd.message && typeof upd.message.date === 'number' && nowSec - upd.message.date > 120) {
        continue;
      }

      lastPollHandledAt = Date.now();
      await handleIncomingBotUpdate(botToken, cfg, upd).catch((err) => {
        console.error('Telegram update qayta ishlashda xatolik:', err);
      });
    }

    return 50;
  } catch (err: any) {
    if (err?.name === 'AbortError') return 200;
    return 2000;
  }
}

export function startTelegramBotPoller() {
  if (pollerStarted) return;
  pollerStarted = true;

  (async function loop() {
    while (pollerStarted) {
      const delayMs = await runTelegramLongPollCycle();
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  })();
}
