import { KassaDayRecord } from '../types/kassa';
import { calculateTotals } from './storage';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  kassaNomi: string;
  kassirIsmi: string;
  autoSendOnOpen: boolean;
  autoSendOnClose: boolean;
  autoSendOnTransaction: boolean;
  enabled: boolean;
  botUsername?: string;
  miniAppUrl?: string;
}

const STORAGE_KEY_TG = 'navo_market_telegram_config';

export const DEFAULT_TG_CONFIG: TelegramConfig = {
  botToken: '',
  chatId: '',
  kassaNomi: '1-Kassa',
  kassirIsmi: 'Doniyor',
  autoSendOnOpen: true,
  autoSendOnClose: true,
  autoSendOnTransaction: false,
  enabled: false
};

export function loadTelegramConfig(): TelegramConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TG);
    if (raw) {
      return { ...DEFAULT_TG_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Telegram sozlamasini yuklashda xatolik:', e);
  }
  return DEFAULT_TG_CONFIG;
}

export function saveTelegramConfig(config: TelegramConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_TG, JSON.stringify(config));
    // Also persist on server silently
    fetch('/api/telegram-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }).catch(() => {});
  } catch (e) {
    console.error('Telegram sozlamasini saqlashda xatolik:', e);
  }
}

export async function fetchTelegramConfigFromServer(): Promise<TelegramConfig | null> {
  try {
    const res = await fetch('/api/telegram-config');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.config) {
      return {
        ...DEFAULT_TG_CONFIG,
        ...data.config,
        miniAppUrl: data.config.miniAppUrl || (!data.config.miniAppDisabled ? data.appUrl || '' : ''),
      };
    }
  } catch {}
  return null;
}

export async function fetchServerAppUrl(): Promise<string> {
  try {
    const res = await fetch('/api/telegram-config');
    if (!res.ok) return '';
    const data = await res.json();
    return String(data.appUrl || '').trim();
  } catch {
    return '';
  }
}

export async function checkTelegramBot(token: string): Promise<{
  ok: boolean;
  username?: string;
  firstName?: string;
  description?: string;
}> {
  if (!token || !token.trim()) {
    return { ok: false, description: "Bot Token kiritilmagan!" };
  }

  const cleanToken = token.trim();

  try {
    const response = await fetch('/api/telegram-check-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: cleanToken })
    });
    const data = await response.json();
    if (response.ok && data.ok && data.botUser) {
      return {
        ok: true,
        username: data.botUser.username,
        firstName: data.botUser.first_name
      };
    }
  } catch {}

  try {
    const res = await fetch(`https://api.telegram.org/bot${cleanToken}/getMe`);
    const data = await res.json();
    if (res.ok && data.ok) {
      return {
        ok: true,
        username: data.result.username,
        firstName: data.result.first_name
      };
    }
    return {
      ok: false,
      description: formatTelegramError(data.description || "Token noto'g'ri")
    };
  } catch {
    return {
      ok: false,
      description: "Tarmoq xatosi! Internet aloqasini tekshiring."
    };
  }
}

export async function autoDetectChatId(botToken: string): Promise<{
  ok: boolean;
  found: boolean;
  chatId?: string | number;
  senderName?: string;
  senderUsername?: string;
  description?: string;
}> {
  if (!botToken || !botToken.trim()) {
    return { ok: false, found: false, description: "Bot Token kiritilmagan!" };
  }

  try {
    const res = await fetch('/api/telegram-get-updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken: botToken.trim() })
    });
    const data = await res.json();
    return data;
  } catch {
    return {
      ok: false,
      found: false,
      description: "Server bilan aloqa uzildi. Iltimos qayta urining."
    };
  }
}

export function formatTelegramError(rawError: string, botUsername?: string): string {
  const err = (rawError || '').toLowerCase();

  if (err.includes('chat not found')) {
    const botLink = botUsername ? `@${botUsername}` : 'botingiz';
    return `⚠️ DIQQAT! Botingizga hali START bosilmagan!\n👉 Telegramda ${botLink} ga kiring va pastdagi START (Boshlash) tugmasini bosing! So'ngra qayta sinab ko'ring.`;
  }
  if (err.includes('unauthorized')) {
    return "⚠️ Bot Token noto'g'ri! @BotFather bergan tokenni to'liq nusxalang.";
  }
  if (err.includes('chat_id is empty') || err.includes('bad request: chat_id')) {
    return "⚠️ Chat ID noto'g'ri yoki bo'sh!";
  }
  if (err.includes('bot was blocked by the user')) {
    return "⚠️ Siz botni bloklab qo'ygansiz! Telegramda bot profiliga kirib Unblock qiling.";
  }

  return `⚠️ Telegram xatosi: ${rawError}`;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  htmlText: string,
  botUsername?: string
): Promise<{ ok: boolean; description?: string }> {
  if (!token || !chatId) {
    return { ok: false, description: "Bot Token yoki Chat ID kiritilmagan!" };
  }

  const cleanToken = token.trim();
  const cleanChatId = chatId.trim();

  try {
    const res = await fetch('/api/telegram-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botToken: cleanToken,
        chatId: cleanChatId,
        text: htmlText
      })
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      return { ok: true };
    }
    if (data.description) {
      return {
        ok: false,
        description: formatTelegramError(data.description, botUsername)
      };
    }
  } catch {}

  try {
    const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: htmlText,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const data = await response.json();
    if (response.ok && data.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      description: formatTelegramError(data.description || `Xatolik status: ${response.status}`, botUsername)
    };
  } catch (err: any) {
    return {
      ok: false,
      description: formatTelegramError(err.message || "Tarmoq xatosi", botUsername)
    };
  }
}

export function formatKassaOchishMessage(params: {
  kassaNomi: string;
  kassirIsmi: string;
  sana: string;
  vaqt: string;
  ertalabkiSdacha: number;
}): string {
  const sdachaFmt = Number(params.ertalabkiSdacha).toLocaleString('uz-UZ');
  return `🟢 <b>[NAVO MARKET — KASSA OCHILDI]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>Kassa:</b> ${params.kassaNomi}\n` +
    `👤 <b>Kassir:</b> ${params.kassirIsmi || '-'}\n` +
    `📅 <b>Sana:</b> ${params.sana}\n` +
    `⏰ <b>Ochilgan vaqt:</b> ${params.vaqt}\n` +
    (params.ertalabkiSdacha > 0 ? `\n💵 <b>Ertalabki Sdacha:</b> <code>${sdachaFmt} so'm</code>\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Smena boshlandi!`;
}

export async function setupTelegramMiniApp(params: {
  botToken: string;
  webAppUrl: string;
  buttonText?: string;
}): Promise<{ ok: boolean; description?: string; isPreviewUrl?: boolean; miniAppUrl?: string }> {
  try {
    const res = await fetch('/api/telegram-setup-miniapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch {
    return { ok: false, description: "Server bilan aloqa uzildi." };
  }
}

export async function checkMiniAppUrlReachability(url: string): Promise<{
  ok: boolean;
  reachable: boolean;
  status?: number;
  reason?: string;
  message: string;
}> {
  try {
    const res = await fetch('/api/telegram-check-miniapp-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    return await res.json();
  } catch {
    return { ok: false, reachable: false, message: "Havolani tekshirib bo'lmadi." };
  }
}

export async function sendTelegramMiniAppInvite(params: {
  botToken: string;
  chatId: string;
  webAppUrl: string;
}): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch('/api/telegram-send-miniapp-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch {
    return { ok: false, description: "Server bilan aloqa uzildi." };
  }
}

export async function resetTelegramBotMenu(botToken: string): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch('/api/telegram-reset-menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken }),
    });
    return await res.json();
  } catch {
    return { ok: false, description: "Server bilan aloqa uzildi." };
  }
}

export function formatNewCashierHtml(params: {
  ism: string;
  telefon?: string;
  asosiyKassa?: string;
  telegramUsername?: string;
  vaqt: string;
}): string {
  return `👤 <b>[YANGI KASSIR RO'YXATDAN O'TDI]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏷 <b>Ismi:</b> ${params.ism}\n` +
    (params.asosiyKassa ? `🏪 <b>Kassa:</b> ${params.asosiyKassa}\n` : '') +
    (params.telefon ? `📞 <b>Telefon:</b> ${params.telefon}\n` : '') +
    (params.telegramUsername ? `📱 <b>Telegram:</b> @${params.telegramUsername}\n` : '') +
    `⏰ <b>Vaqt:</b> ${params.vaqt}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ Kassir tizimga kirdi.`;
}

export function formatKassaYopishHtml(
  record: KassaDayRecord,
  formattedDate: string,
  vaqt: string
): string {
  const t = calculateTotals(record);
  const f = (n: number) => Number(Math.round(n)).toLocaleString('uz-UZ');

  let farqMatn = '';
  if (t.farq === 0) {
    farqMatn = `✅ <b>TO'G'RI CHIQDI! (Farq: 0 so'm)</b>`;
  } else if (t.farq < 0) {
    farqMatn = `⚠️ <b>KAM CHIQDI:</b> <code>${f(Math.abs(t.farq))} so'm</code> kam chiqdi!`;
  } else {
    farqMatn = `ℹ️ <b>ORTIQCHA CHIQDI:</b> <code>+${f(t.farq)} so'm</code> ko'p chiqdi`;
  }

  let qarzDetails = '';
  if (record.qarzList.length > 0) {
    qarzDetails = record.qarzList
      .map((q, idx) => `   ${idx + 1}. ${q.nomi}: <code>${f(q.summa)} so'm</code>`)
      .join('\n') + '\n';
  }

  let firmaDetails = '';
  if (record.firmaList.length > 0) {
    firmaDetails = record.firmaList
      .map((fp, idx) => `   ${idx + 1}. ${fp.nomi}: <code>${f(fp.summa)} so'm</code>`)
      .join('\n') + '\n';
  }

  let rasxodDetails = '';
  if (record.rasxodList.length > 0) {
    rasxodDetails = record.rasxodList
      .map((r, idx) => `   ${idx + 1}. ${r.nomi}: <code>${f(r.summa)} so'm</code>`)
      .join('\n') + '\n';
  }

  return `🔒 <b>[NAVO MARKET — KASSA HISOBOTI]</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🏪 <b>Kassa:</b> ${record.kassaNomi}\n` +
    `👤 <b>Kassir:</b> ${record.kassirIsmi || '-'}\n` +
    `📅 <b>Sana:</b> ${formattedDate}\n` +
    `⏰ <b>Vaqt:</b> ${vaqt}\n\n` +
    `💵 <b>Naqd pul:</b> <code>${f(t.sofNaqd)} so'm</code>` +
    (t.ertalabkiSdacha > 0 ? ` <i>(${f(t.naqdSanalgan)} - ${f(t.ertalabkiSdacha)} sdacha)</i>` : '') + `\n` +
    `💳 <b>Terminal:</b> <code>${f(t.terminalJami)} so'm</code>\n` +
    `📱 <b>Click / Payme:</b> <code>${f(t.clickJami)} so'm</code>\n\n` +
    `📝 <b>Qarzga berilgan (${record.qarzList.length} ta):</b> <code>${f(t.qarzJami)} so'm</code>\n` +
    qarzDetails +
    `🚚 <b>Firmaga berilgan (${record.firmaList.length} ta):</b> <code>${f(t.firmaJami)} so'm</code>\n` +
    firmaDetails +
    (t.rasxodJami > 0 ? `📦 <b>Rasxodlar (${record.rasxodList.length} ta):</b> <code>${f(t.rasxodJami)} so'm</code>\n${rasxodDetails}` : '') +
    `\n━━━━━━━━━━━━━━━━━━━━\n` +
    `🧮 <b>JAMI HISOBLANGAN:</b> <code>${f(t.jamiHisoblangan)} so'm</code>\n` +
    `🧾 <b>CHEKDAGI SUMMA:</b> <code>${f(t.chekdagiSumma)} so'm</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `${farqMatn}\n` +
    (record.izoh ? `\n📌 <i>Izoh: ${record.izoh}</i>` : '');
}
