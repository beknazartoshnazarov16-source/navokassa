import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const RECORDS_FILE = path.join(DATA_DIR, 'kassa-records.json');
const TG_CONFIG_FILE = path.join(DATA_DIR, 'telegram-config.json');
const CASHIERS_FILE = path.join(DATA_DIR, 'cashiers.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readRecordsFromDisk(): any[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(RECORDS_FILE)) {
      fs.writeFileSync(RECORDS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(RECORDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Diskdan o\'qishda xatolik:', err);
    return [];
  }
}

function writeRecordsToDisk(records: any[]) {
  ensureDataDir();
  fs.writeFileSync(RECORDS_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

function readTgConfigFromDisk(): any | null {
  try {
    ensureDataDir();
    if (!fs.existsSync(TG_CONFIG_FILE)) return null;
    const raw = fs.readFileSync(TG_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeTgConfigToDisk(config: any) {
  ensureDataDir();
  fs.writeFileSync(TG_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function readCashiersFromDisk(): any[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(CASHIERS_FILE)) {
      fs.writeFileSync(CASHIERS_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(CASHIERS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCashiersToDisk(cashiers: any[]) {
  ensureDataDir();
  fs.writeFileSync(CASHIERS_FILE, JSON.stringify(cashiers, null, 2), 'utf-8');
}

// ==========================================
// TELEGRAM BOT INTERACTIVE SYSTEM (NO EMAIL / NO WEBVIEW NEEDED)
// ==========================================
let lastPolledUpdateId = 0;
let recentDetectedChat: { chatId: number | string; senderName: string; senderUsername?: string } | null = null;
let pollInFlight = false;
let pollPauseUntil = 0;
let webhookClearedForToken = '';

interface BotSession {
  step:
    | 'idle'
    | 'awaiting_name'
    | 'awaiting_open_sdacha'
    | 'close_naqd'
    | 'close_terminal'
    | 'close_click'
    | 'close_qarz'
    | 'close_firma'
    | 'close_rasxod'
    | 'close_chek';
  draft?: {
    naqdPul?: number;
    terminalSumma?: number;
    clickSumma?: number;
    qarzSumma?: number;
    firmaSumma?: number;
    rasxodSumma?: number;
  };
}

const botSessions = new Map<string, BotSession>();

function getUzbekTodayDate(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const uz = new Date(utcMs + 5 * 3600_000);
  const y = uz.getFullYear();
  const m = String(uz.getMonth() + 1).padStart(2, '0');
  const d = String(uz.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getUzbekTimeStr(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const uz = new Date(utcMs + 5 * 3600_000);
  const hh = String(uz.getHours()).padStart(2, '0');
  const mm = String(uz.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('uz-UZ');
}

function parseBotAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,._so'm]+/gi, '');
  if (!/^\d+$/.test(cleaned)) return null;
  return parseInt(cleaned, 10);
}

function getEffectiveMiniAppUrl(cfg: any): string {
  if (cfg?.miniAppDisabled) return '';
  const saved = String(cfg?.miniAppUrl || '').trim();
  if (saved.startsWith('https://')) return saved;
  const envUrl = String(process.env.APP_URL || '').trim();
  if (envUrl.startsWith('https://')) return envUrl;
  return '';
}

function mainBotKeyboard(miniAppUrl?: string, isPrivateChat = true) {
  const rows: any[][] = [];
  if (isPrivateChat && miniAppUrl && miniAppUrl.startsWith('https://')) {
    rows.push([{ text: '📱 Mini App Ochish (Kassa)', web_app: { url: miniAppUrl } }]);
  }
  rows.push([{ text: '🟢 Kassa Ochish' }, { text: '🔒 Kassa Yopish (Hisobot)' }]);
  rows.push([{ text: '📊 Bugungi Natija' }, { text: '🏪 Kassani Tanlash' }]);
  rows.push([{ text: "👤 Ismni O'zgartirish" }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
  };
}

function miniAppInlineKeyboard(miniAppUrl?: string) {
  if (!miniAppUrl || !miniAppUrl.startsWith('https://')) return undefined;
  return {
    inline_keyboard: [
      [
        {
          text: '📱 Navo Market Kassa (Mini App Ochish)',
          web_app: { url: miniAppUrl },
        },
      ],
    ],
  };
}

function cancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ Bekor qilish' }]],
    resize_keyboard: true,
  };
}

async function setMenuButtonForChat(
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

async function syncMiniAppMenuButtons(
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

async function tgSend(botToken: string, chatId: string | number, text: string, replyMarkup?: any) {
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
    if (!res.ok && replyMarkup) {
      // Fallback without reply_markup if Telegram rejects web_app in non-private chat
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }).catch(() => {});
    }
  } catch {}
}

function computeTotalsServer(r: any) {
  const sofNaqd = (Number(r.naqdPul) || 0) - (Number(r.ertalabkiSdacha) || 0);
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
  return { sofNaqd, terminalJami, clickJami, qarzJami, firmaJami, rasxodJami, jamiHisoblangan, chekdagiSumma, farq };
}

function buildReportHtml(r: any, vaqt: string): string {
  const t = computeTotalsServer(r);
  let farqMatn = `✅ <b>TO'G'RI CHIQDI! (Farq: 0 so'm)</b>`;
  if (t.farq < 0) farqMatn = `⚠️ <b>KAM CHIQDI:</b> <code>${fmtNum(Math.abs(t.farq))} so'm</code> kam chiqdi!`;
  else if (t.farq > 0) farqMatn = `ℹ️ <b>ORTIQCHA CHIQDI:</b> <code>+${fmtNum(t.farq)} so'm</code> ko'p chiqdi`;

  return (
    `🔒 <b>[NAVO MARKET — KASSA HISOBOTI]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>Kassa:</b> ${r.kassaNomi}\n` +
    `👤 <b>Kassir:</b> ${r.kassirIsmi || '-'}\n` +
    `📅 <b>Sana:</b> ${r.date}\n` +
    `⏰ <b>Vaqt:</b> ${vaqt}\n\n` +
    `💵 <b>Naqd pul:</b> <code>${fmtNum(t.sofNaqd)} so'm</code>\n` +
    `💳 <b>Terminal:</b> <code>${fmtNum(t.terminalJami)} so'm</code>\n` +
    `📱 <b>Click / Payme:</b> <code>${fmtNum(t.clickJami)} so'm</code>\n` +
    `📝 <b>Qarzga:</b> <code>${fmtNum(t.qarzJami)} so'm</code>\n` +
    `🚚 <b>Firmaga:</b> <code>${fmtNum(t.firmaJami)} so'm</code>\n` +
    (t.rasxodJami > 0 ? `📦 <b>Rasxod:</b> <code>${fmtNum(t.rasxodJami)} so'm</code>\n` : '') +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🧮 <b>JAMI HISOBLANGAN:</b> <code>${fmtNum(t.jamiHisoblangan)} so'm</code>\n` +
    `🧾 <b>CHEKDAGI SUMMA:</b> <code>${fmtNum(t.chekdagiSumma)} so'm</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${farqMatn}`
  );
}

async function handleIncomingBotMessage(botToken: string, cfg: any, msg: any) {
  const chatId = String(msg.chat.id);
  const fromId = String(msg.from?.id || msg.chat.id);
  const tgFirstName = msg.from?.first_name || msg.chat.title || 'Kassir';
  const tgUsername = msg.from?.username;
  const text = String(msg.text || '').trim();
  if (!text) return;

  const isPrivateChat = msg.chat?.type === 'private';
  const miniAppUrl = getEffectiveMiniAppUrl(cfg);
  const botKb = mainBotKeyboard(miniAppUrl, isPrivateChat);
  const inlineMiniApp = isPrivateChat ? miniAppInlineKeyboard(miniAppUrl) : undefined;

  const adminChatId = cfg?.chatId ? String(cfg.chatId).trim() : '';
  const cashiers = readCashiersFromDisk();
  let cashier = cashiers.find(
    (c: any) => String(c.telegramId || '') === fromId || String(c.telegramId || '') === chatId
  );

  let session = botSessions.get(chatId) || { step: 'idle' };

  // Global cancel or /start
  if (text === '❌ Bekor qilish') {
    botSessions.set(chatId, { step: 'idle' });
    if (cashier) {
      await tgSend(botToken, chatId, `Bekor qilindi. Kerakli bo'limni tanlang:`, botKb);
    } else {
      await tgSend(botToken, chatId, `Ismingizni yozib yuboring (masalan: Dilshod Karimov):`);
    }
    return;
  }

  if (text.startsWith('/start') || text.startsWith('/kassa')) {
    if (isPrivateChat && miniAppUrl) {
      await setMenuButtonForChat(
        botToken,
        { type: 'web_app', text: '📱 Kassa', web_app: { url: miniAppUrl } },
        chatId
      );
    }
    if (!cashier) {
      botSessions.set(chatId, { step: 'awaiting_name' });
      const suggested = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() || tgFirstName;
      if (inlineMiniApp) {
        await tgSend(
          botToken,
          chatId,
          `🏪 <b>Navo Market Kassa — Mini App</b>\nIlovani to'g'ridan-to'g'ri ochish uchun pastdagi tugmani bosing 👇`,
          inlineMiniApp
        );
      }
      await tgSend(
        botToken,
        chatId,
        `👋 <b>Assalomu alaykum, ${tgFirstName}!</b>\n\n` +
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

    botSessions.set(chatId, { step: 'idle' });
    await tgSend(
      botToken,
      chatId,
      `👋 <b>Xush kelibsiz, ${cashier.ism}!</b>\n` +
        `🏪 Faol kassa: <b>${cashier.asosiyKassa || '1-Kassa'}</b>\n\n` +
        (inlineMiniApp
          ? `📱 <b>Mini App</b> orqali to'liq kassa dasturini ochishingiz yoki pastdagi tezkor tugmalardan foydalanishingiz mumkin 👇`
          : `Pastdagi tugmalar orqali kassani ochishingiz yoki kunlik hisobot yuborishingiz mumkin 👇`),
      botKb
    );
    if (inlineMiniApp) {
      await tgSend(
        botToken,
        chatId,
        `📱 <b>Kassa Dasturi (Mini App):</b>`,
        inlineMiniApp
      );
    }
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
    botSessions.set(chatId, { step: 'idle' });

    await tgSend(
      botToken,
      chatId,
      `✅ <b>Muvaffaqiyatli ro'yxatdan o'tdingiz!</b>\n` +
        `👤 Kassir: <b>${cashier.ism}</b>\n` +
        `🏪 Kassa: <b>${cashier.asosiyKassa}</b>\n\n` +
        `Endi Mini App yoki pastdagi tugmalardan bemalol foydalanishingiz mumkin 👇`,
      botKb
    );
    if (inlineMiniApp) {
      await tgSend(
        botToken,
        chatId,
        `📱 <b>Kassa Dasturini Ochish (Mini App):</b>`,
        inlineMiniApp
      );
    }

    if (isNew && adminChatId && adminChatId !== chatId) {
      await tgSend(
        botToken,
        adminChatId,
        `👤 <b>[YANGI KASSIR RO'YXATDAN O'TDI]</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `🏷 <b>Ismi:</b> ${cashier.ism}\n` +
          (tgUsername ? `📱 <b>Telegram:</b> @${tgUsername}\n` : '') +
          `🏪 <b>Kassa:</b> ${cashier.asosiyKassa}\n` +
          `⏰ <b>Vaqt:</b> ${getUzbekTimeStr()}`
      );
    }
    return;
  }

  // Register picker
  if (text === '🏪 Kassani Tanlash') {
    await tgSend(botToken, chatId, `Qaysi kassada ishlayapsiz? Tanlang:`, {
      keyboard: [
        [{ text: '🏪 1-Kassa' }, { text: '🏪 2-Kassa' }],
        [{ text: '🏪 3-Kassa' }, { text: '❌ Bekor qilish' }],
      ],
      resize_keyboard: true,
    });
    return;
  }

  if (text.startsWith('🏪 ') && text.includes('Kassa')) {
    const kassaName = text.replace('🏪 ', '').trim();
    const updatedCashiers = readCashiersFromDisk().map((c: any) =>
      c.id === cashier.id ? { ...c, asosiyKassa: kassaName, lastActiveAt: new Date().toISOString() } : c
    );
    writeCashiersToDisk(updatedCashiers);
    await tgSend(botToken, chatId, `✅ Faol kassa o'zgartirildi: <b>${kassaName}</b>`, botKb);
    return;
  }

  if (text === "👤 Ismni O'zgartirish") {
    botSessions.set(chatId, { step: 'awaiting_name' });
    await tgSend(botToken, chatId, `Yangi ismingizni yozib yuboring:`, cancelKeyboard());
    return;
  }

  const activeKassa = cashier.asosiyKassa || '1-Kassa';
  const today = getUzbekTodayDate();
  const recordId = `${today}__${activeKassa}`;

  // Kassa ochish flow
  if (text === '🟢 Kassa Ochish') {
    botSessions.set(chatId, { step: 'awaiting_open_sdacha' });
    await tgSend(
      botToken,
      chatId,
      `🟢 <b>${activeKassa} ni ochish</b>\n` +
        `Ertalab kassada qoldirilgan mayda pul (sdacha) qancha? (bo'lmasa <code>0</code> yozing):`,
      {
        keyboard: [[{ text: '0' }, { text: '50000' }, { text: '100000' }], [{ text: '❌ Bekor qilish' }]],
        resize_keyboard: true,
      }
    );
    return;
  }

  if (session.step === 'awaiting_open_sdacha') {
    const sdacha = parseBotAmount(text);
    if (sdacha === null) {
      await tgSend(botToken, chatId, `Iltimos, faqat raqam kiriting (masalan: 0 yoki 75000):`);
      return;
    }
    const vaqt = getUzbekTimeStr();
    const records = readRecordsFromDisk();
    const idx = records.findIndex((r: any) => r.id === recordId);
    const base = idx >= 0 ? records[idx] : {
      id: recordId,
      date: today,
      kassaNomi: activeKassa,
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
    };
    const updated = {
      ...base,
      kassirIsmi: cashier.ism,
      kassirId: cashier.id,
      isOchiq: true,
      ochilganVaqt: vaqt,
      ertalabkiSdacha: sdacha,
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) records[idx] = updated;
    else records.unshift(updated);
    writeRecordsToDisk(records);
    botSessions.set(chatId, { step: 'idle' });

    const openMsg =
      `🟢 <b>[NAVO MARKET — KASSA OCHILDI]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏪 <b>Kassa:</b> ${activeKassa}\n` +
      `👤 <b>Kassir:</b> ${cashier.ism}\n` +
      `📅 <b>Sana:</b> ${today}\n` +
      `⏰ <b>Ochilgan vaqt:</b> ${vaqt}\n` +
      (sdacha > 0 ? `💵 <b>Ertalabki sdacha:</b> <code>${fmtNum(sdacha)} so'm</code>\n` : '') +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `✅ Smena boshlandi!`;

    await tgSend(botToken, chatId, openMsg, botKb);
    if (adminChatId && adminChatId !== chatId) {
      await tgSend(botToken, adminChatId, openMsg);
    }
    return;
  }

  // Bugungi Natija
  if (text === '📊 Bugungi Natija') {
    const records = readRecordsFromDisk();
    const found = records.find((r: any) => r.id === recordId);
    if (!found) {
      await tgSend(
        botToken,
        chatId,
        `ℹ️ Bugun (<b>${today}</b>) <b>${activeKassa}</b> uchun hali ma'lumot kiritilmagan.`,
        botKb
      );
      return;
    }
    await tgSend(botToken, chatId, buildReportHtml(found, getUzbekTimeStr()), botKb);
    return;
  }

  // Kassa yopish 7-step flow
  if (text === '🔒 Kassa Yopish (Hisobot)') {
    botSessions.set(chatId, { step: 'close_naqd', draft: {} });
    await tgSend(
      botToken,
      chatId,
      `🔒 <b>${activeKassa} — Kunlik Hisobot Yopish</b>\n\n` +
        `1️⃣ Kassadan sanab chiqilgan <b>Naqd pul</b> jami qancha? (faqat raqam yozing):`,
      cancelKeyboard()
    );
    return;
  }

  if (session.step.startsWith('close_')) {
    const val = parseBotAmount(text);
    if (val === null) {
      await tgSend(botToken, chatId, `⚠️ Iltimos, faqat raqam kiriting (masalan: <code>1500000</code> yoki <code>0</code>):`);
      return;
    }
    const draft = { ...(session.draft || {}) };

    if (session.step === 'close_naqd') {
      draft.naqdPul = val;
      botSessions.set(chatId, { step: 'close_terminal', draft });
      await tgSend(botToken, chatId, `2️⃣ <b>Terminal</b> (Humo / Uzcard) jami qancha bo'ldi?`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_terminal') {
      draft.terminalSumma = val;
      botSessions.set(chatId, { step: 'close_click', draft });
      await tgSend(botToken, chatId, `3️⃣ <b>Click / Payme</b> jami qancha bo'ldi?`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_click') {
      draft.clickSumma = val;
      botSessions.set(chatId, { step: 'close_qarz', draft });
      await tgSend(botToken, chatId, `4️⃣ <b>Qarzga berilgan pullar</b> jami qancha? (bo'lmasa <code>0</code>)`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_qarz') {
      draft.qarzSumma = val;
      botSessions.set(chatId, { step: 'close_firma', draft });
      await tgSend(botToken, chatId, `5️⃣ <b>Firmaga berilgan pullar</b> jami qancha? (bo'lmasa <code>0</code>)`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_firma') {
      draft.firmaSumma = val;
      botSessions.set(chatId, { step: 'close_rasxod', draft });
      await tgSend(botToken, chatId, `6️⃣ <b>Boshqa rasxodlar</b> (abed, paket...) jami qancha? (bo'lmasa <code>0</code>)`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_rasxod') {
      draft.rasxodSumma = val;
      botSessions.set(chatId, { step: 'close_chek', draft });
      await tgSend(botToken, chatId, `7️⃣ <b>Chekdagi umumiy summa</b> (Kassa apparat / kompyuter) qancha?`, cancelKeyboard());
      return;
    }
    if (session.step === 'close_chek') {
      const vaqt = getUzbekTimeStr();
      const records = readRecordsFromDisk();
      const idx = records.findIndex((r: any) => r.id === recordId);
      const prev = idx >= 0 ? records[idx] : {};

      const updated = {
        id: recordId,
        date: today,
        kassaNomi: activeKassa,
        kassirIsmi: cashier.ism,
        kassirId: cashier.id,
        isOchiq: false,
        ochilganVaqt: prev.ochilganVaqt,
        yopilganVaqt: vaqt,
        naqdPul: draft.naqdPul || 0,
        ertalabkiSdacha: Number(prev.ertalabkiSdacha) || 0,
        terminalSumma: draft.terminalSumma || 0,
        terminalList: [],
        clickSumma: draft.clickSumma || 0,
        clickList: [],
        qarzList: draft.qarzSumma ? [{ id: `qarz-bot-${Date.now()}`, nomi: 'Telegramdan kiritildi', summa: draft.qarzSumma, vaqt }] : [],
        firmaList: draft.firmaSumma ? [{ id: `firma-bot-${Date.now()}`, nomi: 'Firmalar (Telegramdan)', summa: draft.firmaSumma, vaqt }] : [],
        rasxodList: draft.rasxodSumma ? [{ id: `rasxod-bot-${Date.now()}`, nomi: 'Rasxodlar (Telegramdan)', summa: draft.rasxodSumma, vaqt }] : [],
        chekdagiSumma: val,
        izoh: prev.izoh || 'Telegram bot orqali yopildi',
        updatedAt: new Date().toISOString(),
      };

      if (idx >= 0) records[idx] = updated;
      else records.unshift(updated);
      writeRecordsToDisk(records);
      botSessions.set(chatId, { step: 'idle' });

      const reportHtml = buildReportHtml(updated, vaqt);
      await tgSend(botToken, chatId, `✅ <b>Hisobot saqlandi va adminga yuborildi!</b>\n\n${reportHtml}`, botKb);
      if (adminChatId && adminChatId !== chatId) {
        await tgSend(botToken, adminChatId, reportHtml);
      }
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

async function pollTelegramStartCommands() {
  if (pollInFlight || Date.now() < pollPauseUntil) return;
  const cfg = readTgConfigFromDisk();
  const botToken = cfg?.botToken ? String(cfg.botToken).trim() : '';

  if (!botToken) return;

  pollInFlight = true;
  try {
    if (webhookClearedForToken !== botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`).catch(() => {});
      const effectiveUrl = getEffectiveMiniAppUrl(cfg);
      if (effectiveUrl) {
        await syncMiniAppMenuButtons(botToken, effectiveUrl, '📱 Kassa');
        if (!cfg?.miniAppUrl && !cfg?.miniAppDisabled) {
          writeTgConfigToDisk({ ...cfg, miniAppUrl: effectiveUrl });
        }
      }
      await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Mini App va Kassa menyusi' },
            { command: 'kassa', description: 'Bugungi kassa hisoboti' },
          ],
        }),
      }).catch(() => {});
      webhookClearedForToken = botToken;
    }

    const offsetParam = lastPolledUpdateId > 0 ? `?offset=${lastPolledUpdateId + 1}&limit=20` : '?limit=20';
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates${offsetParam}`);
    if (res.status === 409) {
      pollPauseUntil = Date.now() + 20_000;
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok || !Array.isArray(data.result)) return;

    for (const upd of data.result) {
      if (typeof upd.update_id === 'number' && upd.update_id > lastPolledUpdateId) {
        lastPolledUpdateId = upd.update_id;
      }
      const msg = upd.message;
      if (!msg || !msg.chat) continue;

      const senderChatId = msg.chat.id;
      const senderName = msg.from?.first_name || msg.chat.title || 'Kassir';
      const senderUsername = msg.from?.username;
      recentDetectedChat = { chatId: senderChatId, senderName, senderUsername };

      await handleIncomingBotMessage(botToken, cfg, msg);
    }
  } catch {
    // ignore transient network errors
  } finally {
    pollInFlight = false;
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '5mb' }));

  // Auto-upgrade Mini App URL when accessed on a real public HTTPS deployment (e.g. Cloud Run)
  let autoUpgradedOrigin = '';
  app.use((req, _res, next) => {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim();
    if (
      rawHost &&
      (proto === 'https' || process.env.NODE_ENV === 'production') &&
      !rawHost.includes('localhost') &&
      !rawHost.includes('127.0.0.1') &&
      !rawHost.includes('0.0.0.0') &&
      !rawHost.includes('ais-dev-') &&
      !rawHost.includes('ais-pre-')
    ) {
      const publicOrigin = `https://${rawHost}`;
      if (autoUpgradedOrigin !== publicOrigin) {
        autoUpgradedOrigin = publicOrigin;
        const cfg = readTgConfigFromDisk();
        if (
          cfg?.botToken &&
          !cfg?.miniAppDisabled &&
          (!cfg.miniAppUrl || cfg.miniAppUrl.includes('ais-dev-') || cfg.miniAppUrl.includes('ais-pre-'))
        ) {
          writeTgConfigToDisk({ ...cfg, miniAppUrl: publicOrigin, miniAppDisabled: false });
          syncMiniAppMenuButtons(String(cfg.botToken).trim(), publicOrigin, '📱 Kassa').catch(() => {});
        }
      }
    }
    next();
  });

  // ==========================================
  // KASSA MA'LUMOTLARI BAZASI (SAQLASH VA TOPISH)
  // ==========================================

  // Barcha saqlangan kunlar va kassalarni olish
  app.get('/api/records', (_req, res) => {
    try {
      const records = readRecordsFromDisk();
      return res.json({ ok: true, records });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Bitta kunlik kassa yozuvini saqlash yoki yangilash
  app.post('/api/records', (req, res) => {
    try {
      const incoming = req.body;
      if (!incoming || !incoming.id || !incoming.date) {
        return res.status(400).json({ ok: false, error: "Sana va Kassa ID bo'lishi shart" });
      }
      const records = readRecordsFromDisk();
      const idx = records.findIndex((r: any) => r.id === incoming.id);
      const updatedRecord = {
        ...incoming,
        updatedAt: new Date().toISOString()
      };
      if (idx >= 0) {
        records[idx] = updatedRecord;
      } else {
        records.unshift(updatedRecord);
      }
      writeRecordsToDisk(records);
      return res.json({ ok: true, record: updatedRecord });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Hammasini birdan import/tiklash
  app.post('/api/records/bulk', (req, res) => {
    try {
      const { records } = req.body;
      if (!Array.isArray(records)) {
        return res.status(400).json({ ok: false, error: "Noto'g'ri format" });
      }
      writeRecordsToDisk(records);
      return res.json({ ok: true, count: records.length });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Bitta kun yozuvini o'chirish
  app.delete('/api/records/:id', (req, res) => {
    try {
      const targetId = decodeURIComponent(req.params.id);
      const records = readRecordsFromDisk();
      const filtered = records.filter((r: any) => r.id !== targetId);
      writeRecordsToDisk(filtered);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Telegram sozlamalarini serverda saqlash/olish
  app.get('/api/telegram-config', (_req, res) => {
    const config = readTgConfigFromDisk();
    return res.json({
      ok: true,
      config,
      appUrl: String(process.env.APP_URL || '').trim(),
    });
  });

  app.post('/api/telegram-config', (req, res) => {
    try {
      const existing = readTgConfigFromDisk() || {};
      writeTgConfigToDisk({ ...existing, ...req.body });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ==========================================
  // KASSIRLAR RO'YXATDAN O'TISH BAZASI
  // ==========================================
  app.get('/api/cashiers', (_req, res) => {
    try {
      const cashiers = readCashiersFromDisk();
      return res.json({ ok: true, cashiers });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cashiers/register', (req, res) => {
    try {
      const { ism, telefon, telegramId, telegramUsername, asosiyKassa } = req.body || {};
      const cleanName = typeof ism === 'string' ? ism.trim() : '';
      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ ok: false, error: "Kassir ismi kamida 2 ta harf bo'lishi kerak!" });
      }

      const cashiers = readCashiersFromDisk();
      const now = new Date().toISOString();

      // Match by telegramId first if present, or case-insensitive exact name
      const idx = cashiers.findIndex(
        (c: any) =>
          (telegramId && c.telegramId && String(c.telegramId) === String(telegramId)) ||
          String(c.ism || '').trim().toLowerCase() === cleanName.toLowerCase()
      );

      if (idx >= 0) {
        const existing = cashiers[idx];
        const updated = {
          ...existing,
          ism: cleanName,
          telefon: telefon !== undefined ? String(telefon).trim() : existing.telefon,
          telegramId: telegramId ? String(telegramId) : existing.telegramId,
          telegramUsername: telegramUsername || existing.telegramUsername,
          asosiyKassa: asosiyKassa || existing.asosiyKassa,
          lastActiveAt: now,
        };
        cashiers[idx] = updated;
        writeCashiersToDisk(cashiers);
        return res.json({ ok: true, cashier: updated, cashiers, isNew: false });
      }

      const created = {
        id: `kassir-${Date.now()}`,
        ism: cleanName,
        telefon: telefon ? String(telefon).trim() : '',
        telegramId: telegramId ? String(telegramId) : undefined,
        telegramUsername: telegramUsername || undefined,
        asosiyKassa: asosiyKassa || '1-Kassa',
        createdAt: now,
        lastActiveAt: now,
      };
      cashiers.unshift(created);
      writeCashiersToDisk(cashiers);
      return res.json({ ok: true, cashier: created, cashiers, isNew: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/cashiers/:id', (req, res) => {
    try {
      const targetId = decodeURIComponent(req.params.id);
      const cashiers = readCashiersFromDisk();
      const filtered = cashiers.filter((c: any) => c.id !== targetId);
      writeCashiersToDisk(filtered);
      return res.json({ ok: true, cashiers: filtered });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ==========================================
  // TELEGRAM BOT PROXY ENDPOINTS
  // ==========================================

  app.post('/api/telegram-check-bot', async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken || typeof botToken !== 'string') {
        return res.status(400).json({ ok: false, description: "Bot Token kiritilmagan!" });
      }

      const cleanToken = botToken.trim();
      const tgUrl = `https://api.telegram.org/bot${cleanToken}/getMe`;
      const response = await fetch(tgUrl);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        return res.status(response.status || 400).json({
          ok: false,
          description: data.description || "Bot token noto'g'ri!",
          errorCode: data.error_code
        });
      }

      return res.json({
        ok: true,
        botUser: data.result
      });
    } catch (err: any) {
      console.error('Bot tekshirishda xatolik:', err);
      return res.status(500).json({ ok: false, description: `Tarmoq xatosi: ${err.message}` });
    }
  });

  app.post('/api/telegram-send', async (req, res) => {
    try {
      const { botToken, chatId, text } = req.body;
      if (!botToken || !chatId || !text) {
        return res.status(400).json({ 
          ok: false, 
          description: "Bot Token, Chat ID va xabar matni to'liq bo'lishi kerak!" 
        });
      }

      const cleanToken = String(botToken).trim();
      const cleanChatId = String(chatId).trim();

      const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
      const response = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cleanChatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        return res.status(response.status || 400).json({
          ok: false,
          description: data.description || `Telegram xatosi: ${response.status}`,
          errorCode: data.error_code
        });
      }

      return res.json({ ok: true, result: data.result });
    } catch (err: any) {
      console.error('Telegram xabar yuborish xatosi:', err);
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  app.post('/api/telegram-get-updates', async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken) {
        return res.status(400).json({ ok: false, description: "Bot Token kiritilmagan!" });
      }

      const cleanToken = String(botToken).trim();
      const tgUrl = `https://api.telegram.org/bot${cleanToken}/getUpdates?offset=-10`;
      const response = await fetch(tgUrl);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        return res.status(response.status || 400).json({
          ok: false,
          description: data.description || "Updates olishda xatolik"
        });
      }

      const updates = data.result || [];
      const messages = updates.map((u: any) => u.message || u.channel_post).filter(Boolean);
      const lastMsg = messages[messages.length - 1];

      if (!lastMsg || !lastMsg.chat) {
        if (recentDetectedChat) {
          return res.json({
            ok: true,
            found: true,
            chatId: recentDetectedChat.chatId,
            senderName: recentDetectedChat.senderName,
            senderUsername: recentDetectedChat.senderUsername,
          });
        }
        return res.json({
          ok: true,
          found: false,
          description: "Botingizga hali START xabari yetib kelmadi. Iltimos, Telegramda botingizga kirib 'START' ni bosing, so'ngra qayta tekshiring!"
        });
      }

      const senderChatId = lastMsg.chat.id;
      const senderName = lastMsg.from?.first_name || lastMsg.chat.title || 'Foydalanuvchi';
      const senderUsername = lastMsg.from?.username;

      try {
        const welcomeText = `👋 <b>Assalomu alaykum, ${senderName}!</b>\n` +
          `Siz <b>Navo Market Kassa</b> botiga muvaffaqiyatli ulandingiz.\n` +
          `Sizning Chat ID: <code>${senderChatId}</code>\n\n` +
          `✅ Endi har safar kassa ochilganda va yopilganda (Naqd, Terminal, Click, Qarzga, Firmaga va Chekdagi farq) hisobotlari shu yerga boradi!`;

        await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: senderChatId,
            text: welcomeText,
            parse_mode: 'HTML'
          })
        });
      } catch (welcomeErr) {
        console.warn("Salom xabari jo'natishda xatolik:", welcomeErr);
      }

      return res.json({
        ok: true,
        found: true,
        chatId: senderChatId,
        senderName,
        senderUsername
      });
    } catch (err: any) {
      console.error('getUpdates xatosi:', err);
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  // Mini App havolasini Telegram telefondan ochishga yaroqliligini tekshirish (403 / Login / 404 aniqlash)
  app.post('/api/telegram-check-miniapp-url', async (req, res) => {
    try {
      const { url } = req.body || {};
      const cleanUrl = String(url || '').trim();
      if (!cleanUrl.startsWith('https://')) {
        return res.json({
          ok: true,
          reachable: false,
          reason: 'invalid_https',
          message: "Havola https:// bilan boshlanishi shart."
        });
      }

      if (
        cleanUrl.includes('ai.studio/') ||
        cleanUrl.includes('aistudio.google.com/') ||
        cleanUrl.includes('ais-dev-') ||
        cleanUrl.includes('ais-pre-')
      ) {
        const isEditorLink = cleanUrl.includes('ai.studio/') || cleanUrl.includes('aistudio.google.com/');
        return res.json({
          ok: true,
          reachable: false,
          status: 403,
          reason: 'auth_required',
          message: isEditorLink
            ? "🔴 Bu Google AI Studio muharrir havolasi (ai.studio/apps/...)! Bu havola Telegram Mini App ichida ochilmaydi (Google login / frame cheklovi bor). Yuqori o'ngdagi 🚀 Deploy (Cloud Run) tugmasidan ommaviy *.run.app havolasini oling."
            : "🔴 Telegramda 403 / Google login xatosini beradi! AI Studio'dagi «Share» (ais-pre) va «Dev» (ais-dev) havolalari Google tomonidan himoyalangan. Telefonda ochilishi uchun «Deploy to Cloud Run» (Public) orqali haqiqiy *.run.app havolasini olish shart."
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const probe = await fetch(cleanUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });
        clearTimeout(timer);

        const location = probe.headers.get('location') || '';
        const csp = probe.headers.get('content-security-policy') || '';

        if (
          probe.status === 401 ||
          probe.status === 403 ||
          location.includes('accounts.google.com') ||
          location.includes('__cookie_check')
        ) {
          return res.json({
            ok: true,
            reachable: false,
            status: probe.status,
            reason: 'auth_required',
            message:
              "🔴 Bu havola himoyalangan (Google login / 403) — Telegram Mini App'da ochilmaydi! Ilovani Public (hamma uchun ochiq) qilib Deploy qiling."
          });
        }

        if (probe.status === 404) {
          return res.json({
            ok: true,
            reachable: false,
            status: 404,
            reason: 'not_found',
            message: "🔴 404 Topilmadi! Bu havola hali ommaviy Deploy qilinmagan."
          });
        }

        if (csp.includes('frame-ancestors') && !csp.includes('telegram.org') && !csp.includes('*')) {
          return res.json({
            ok: true,
            reachable: false,
            status: probe.status,
            reason: 'csp_blocked',
            message: "🔴 Sayt Telegram ichida ochilishni (frame-ancestors) bloklagan."
          });
        }

        if (probe.status >= 200 && probe.status < 400) {
          return res.json({
            ok: true,
            reachable: true,
            status: probe.status,
            message: "🟢 Ajoyib! Bu havola hamma uchun ochiq (200 OK) — telefonda 403 va Email'siz 100% ishlaydi!"
          });
        }

        return res.json({
          ok: true,
          reachable: false,
          status: probe.status,
          reason: 'http_error',
          message: `🔴 Havola javobi: HTTP ${probe.status}. Tekshirib ko'ring.`
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        return res.json({
          ok: true,
          reachable: false,
          reason: 'network_error',
          message: `⚠️ Havolani tekshirib bo'lmadi: ${fetchErr?.message || 'Tarmoq xatosi'}`
        });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Mini App Menu Button va /start komandalarini botga ulash
  app.post('/api/telegram-setup-miniapp', async (req, res) => {
    try {
      const { botToken, webAppUrl, buttonText } = req.body || {};
      if (!botToken || !webAppUrl) {
        return res.status(400).json({ ok: false, description: "Bot Token va Mini App HTTPS havolasi kerak!" });
      }

      const cleanToken = String(botToken).trim();
      const cleanUrl = String(webAppUrl).trim();
      if (!cleanUrl.startsWith('https://')) {
        return res.status(400).json({
          ok: false,
          description: "Telegram Mini App faqat HTTPS havolada ishlaydi! (Masalan: https://...)"
        });
      }

      const btnLabel = (buttonText && String(buttonText).trim()) || '📱 Kassa';
      const menuData = await syncMiniAppMenuButtons(cleanToken, cleanUrl, btnLabel);

      if (!menuData.ok) {
        return res.status(400).json({
          ok: false,
          description: menuData.description || "Menu tugmasini ulashda xatolik!"
        });
      }

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Mini App va Kassa menyusi' },
            { command: 'kassa', description: 'Asosiy kassa menyusi' },
          ],
        }),
      }).catch(() => {});

      const existing = readTgConfigFromDisk() || {};
      writeTgConfigToDisk({
        ...existing,
        botToken: cleanToken,
        miniAppUrl: cleanUrl,
        miniAppDisabled: false,
      });

      const isPreviewUrl =
        cleanUrl.includes('ais-dev-') ||
        cleanUrl.includes('ais-pre-') ||
        cleanUrl.includes('ai.studio/') ||
        cleanUrl.includes('aistudio.google.com/');
      return res.json({ ok: true, isPreviewUrl, miniAppUrl: cleanUrl });
    } catch (err: any) {
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  // Mini App web_app tugmasini o'chirib, faqat bot tugmalarida ishlashga o'tkazish
  app.post('/api/telegram-reset-menu', async (req, res) => {
    try {
      const { botToken } = req.body || {};
      if (!botToken) {
        return res.status(400).json({ ok: false, description: "Bot Token kiritilmagan!" });
      }
      const cleanToken = String(botToken).trim();

      await syncMiniAppMenuButtons(cleanToken, '');

      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: "Ro'yxatdan o'tish va Kassa menyusi" },
            { command: 'kassa', description: 'Bugungi kassa hisoboti' },
          ],
        }),
      });

      const existing = readTgConfigFromDisk() || {};
      writeTgConfigToDisk({
        ...existing,
        botToken: cleanToken,
        miniAppUrl: '',
        miniAppDisabled: true,
      });

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  // Bot chatiga "Mini App ni Ochish" tugmasini yuborish
  app.post('/api/telegram-send-miniapp-invite', async (req, res) => {
    try {
      const { botToken, chatId, webAppUrl } = req.body || {};
      if (!botToken || !chatId || !webAppUrl) {
        return res.status(400).json({ ok: false, description: "Token, Chat ID va Havola to'liq bo'lishi kerak!" });
      }
      const cleanToken = String(botToken).trim();
      const cleanChatId = String(chatId).trim();
      const cleanUrl = String(webAppUrl).trim();

      if (!cleanUrl.startsWith('https://')) {
        return res.status(400).json({ ok: false, description: "Havola https:// bilan boshlanishi shart!" });
      }

      const tgRes = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cleanChatId,
          text:
            `🏪 <b>NAVO MARKET KASSA — MINI APP</b>\n\n` +
            `Kassirlar ro'yxatdan o'tishi va kunlik kassa hisobotini yuritishi uchun pastdagi tugmani bosing 👇`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '📱 Kassaga Kirish (Mini App)',
                  web_app: { url: cleanUrl },
                },
              ],
            ],
          },
        }),
      });
      const data = await tgRes.json();
      if (!tgRes.ok || !data.ok) {
        return res.status(400).json({ ok: false, description: data.description || "Yuborishda xatolik" });
      }
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server muvaffaqiyatli ishga tushdi: http://0.0.0.0:${PORT}`);
    setInterval(() => {
      pollTelegramStartCommands();
    }, 3500);
  });
}

startServer();
