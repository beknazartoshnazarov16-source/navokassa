import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  readRecordsFromDisk,
  writeRecordsToDisk,
  readTgConfigFromDisk,
  writeTgConfigToDisk,
  readCashiersFromDisk,
  writeCashiersToDisk,
} from './server/storage.ts';
import {
  escapeHtml,
  tgSend,
  syncMiniAppMenuButtons,
  syncBotCommands,
  startTelegramBotPoller,
  getRecentDetectedChat,
  resetWebhookCacheForConfigUpdate,
  isPublicMiniAppUrl,
} from './server/telegramBot.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  app.get('/api/records', (_req, res) => {
    try {
      const records = readRecordsFromDisk();
      return res.json({ ok: true, records });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

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
        updatedAt: new Date().toISOString(),
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
    const rawCfg = readTgConfigFromDisk();
    const envAppUrl = String(process.env.APP_URL || '').trim();
    const cleanMiniAppUrl = rawCfg?.miniAppUrl && isPublicMiniAppUrl(rawCfg.miniAppUrl) ? rawCfg.miniAppUrl : '';
    const config = rawCfg ? { ...rawCfg, miniAppUrl: cleanMiniAppUrl } : null;
    return res.json({
      ok: true,
      config,
      appUrl: isPublicMiniAppUrl(envAppUrl) ? envAppUrl : '',
    });
  });

  app.post('/api/telegram-config', (req, res) => {
    try {
      const existing = readTgConfigFromDisk() || {};
      const incoming = { ...req.body };
      if (typeof incoming.miniAppUrl === 'string' && incoming.miniAppUrl.trim() && !isPublicMiniAppUrl(incoming.miniAppUrl)) {
        incoming.miniAppUrl = '';
      }
      const nextCfg = { ...existing, ...incoming };
      writeTgConfigToDisk(nextCfg);
      if (existing.botToken !== nextCfg.botToken || existing.miniAppUrl !== nextCfg.miniAppUrl) {
        resetWebhookCacheForConfigUpdate();
      }
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
          errorCode: data.error_code,
        });
      }

      return res.json({
        ok: true,
        botUser: data.result,
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
          description: "Bot Token, Chat ID va xabar matni to'liq bo'lishi kerak!",
        });
      }

      const cleanToken = String(botToken).trim();
      const cleanChatId = String(chatId).trim();
      const result = await tgSend(cleanToken, cleanChatId, String(text));

      if (!result.ok) {
        return res.status(400).json({
          ok: false,
          description: result.description || 'Telegramga yuborishda xatolik',
        });
      }

      return res.json({ ok: true, result: result.result });
    } catch (err: any) {
      console.error('Telegram xabar yuborish xatosi:', err);
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  // Conflict-free Chat ID auto-detection
  app.post('/api/telegram-get-updates', async (req, res) => {
    try {
      const { botToken } = req.body;
      if (!botToken) {
        return res.status(400).json({ ok: false, description: "Bot Token kiritilmagan!" });
      }

      const cleanToken = String(botToken).trim();
      const { recentDetectedChat, lastPollHandledAt, activePolledToken } = getRecentDetectedChat();

      // If background long-poller is already running on this exact token, use its live captured chat ID (zero 409 Conflict!)
      if (cleanToken === activePolledToken) {
        if (recentDetectedChat && Date.now() - lastPollHandledAt < 300_000) {
          return res.json({
            ok: true,
            found: true,
            chatId: recentDetectedChat.chatId,
            senderName: recentDetectedChat.senderName,
            senderUsername: recentDetectedChat.senderUsername,
          });
        }

        // Wait up to 2s in case user just tapped /start a moment ago
        await new Promise((r) => setTimeout(r, 1500));
        const refreshed = getRecentDetectedChat();
        if (refreshed.recentDetectedChat) {
          return res.json({
            ok: true,
            found: true,
            chatId: refreshed.recentDetectedChat.chatId,
            senderName: refreshed.recentDetectedChat.senderName,
            senderUsername: refreshed.recentDetectedChat.senderUsername,
          });
        }

        const cfg = readTgConfigFromDisk();
        if (cfg?.chatId) {
          return res.json({
            ok: true,
            found: true,
            chatId: cfg.chatId,
            senderName: cfg.kassirIsmi || 'Admin',
          });
        }

        return res.json({
          ok: true,
          found: false,
          description:
            "Botingizga hali START xabari yetib kelmadi. Telegramda botingizga kirib 'START' ni bosing, so'ngra qayta tekshiring!",
        });
      }

      // Different token tested prior to saving: safe direct check
      const tgUrl = `https://api.telegram.org/bot${cleanToken}/getUpdates?offset=-10`;
      const response = await fetch(tgUrl);
      const data = await response.json();

      if (!response.ok || !data.ok) {
        return res.status(response.status || 400).json({
          ok: false,
          description: data.description || 'Updates olishda xatolik',
        });
      }

      const updates = data.result || [];
      const messages = updates.map((u: any) => u.message || u.channel_post).filter(Boolean);
      const lastMsg = messages[messages.length - 1];

      if (!lastMsg || !lastMsg.chat) {
        return res.json({
          ok: true,
          found: false,
          description:
            "Botingizga hali START xabari yetib kelmadi. Iltimos, Telegramda botingizga kirib 'START' ni bosing, so'ngra qayta tekshiring!",
        });
      }

      const senderChatId = lastMsg.chat.id;
      const senderName = lastMsg.from?.first_name || lastMsg.chat.title || 'Foydalanuvchi';
      const senderUsername = lastMsg.from?.username;

      await tgSend(
        cleanToken,
        senderChatId,
        `👋 <b>Assalomu alaykum, ${escapeHtml(senderName)}!</b>\n` +
          `Siz <b>Navo Market Kassa</b> botiga muvaffaqiyatli ulandingiz.\n` +
          `Sizning Chat ID: <code>${escapeHtml(senderChatId)}</code>\n\n` +
          `✅ Endi kassa ochilganda va yopilganda barcha hisobotlar shu yerga boradi!`
      );

      return res.json({
        ok: true,
        found: true,
        chatId: senderChatId,
        senderName,
        senderUsername,
      });
    } catch (err: any) {
      console.error('getUpdates xatosi:', err);
      return res.status(500).json({ ok: false, description: `Server xatosi: ${err.message}` });
    }
  });

  // Mini App havolasini Telegram telefondan ochishga yaroqliligini tekshirish
  app.post('/api/telegram-check-miniapp-url', async (req, res) => {
    try {
      const { url } = req.body || {};
      const cleanUrl = String(url || '').trim();
      if (!cleanUrl.startsWith('https://')) {
        return res.json({
          ok: true,
          reachable: false,
          reason: 'invalid_https',
          message: "Havola https:// bilan boshlanishi shart.",
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
            : "🔴 Telegramda 403 / Google login xatosini beradi! AI Studio'dagi «Share» (ais-pre) va «Dev» (ais-dev) havolalari Google tomonidan himoyalangan. Telefonda ochilishi uchun «Deploy to Cloud Run» (Public) orqali haqiqiy *.run.app havolasini olish shart.",
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
              "🔴 Bu havola himoyalangan (Google login / 403) — Telegram Mini App'da ochilmaydi! Ilovani Public (hamma uchun ochiq) qilib Deploy qiling.",
          });
        }

        if (probe.status === 404) {
          return res.json({
            ok: true,
            reachable: false,
            status: 404,
            reason: 'not_found',
            message: "🔴 404 Topilmadi! Bu havola hali ommaviy Deploy qilinmagan.",
          });
        }

        if (csp.includes('frame-ancestors') && !csp.includes('telegram.org') && !csp.includes('*')) {
          return res.json({
            ok: true,
            reachable: false,
            status: probe.status,
            reason: 'csp_blocked',
            message: "🔴 Sayt Telegram ichida ochilishni (frame-ancestors) bloklagan.",
          });
        }

        if (probe.status >= 200 && probe.status < 400) {
          return res.json({
            ok: true,
            reachable: true,
            status: probe.status,
            message: "🟢 Ajoyib! Bu havola hamma uchun ochiq (200 OK) — telefonda 403 va Email'siz 100% ishlaydi!",
          });
        }

        return res.json({
          ok: true,
          reachable: false,
          status: probe.status,
          reason: 'http_error',
          message: `🔴 Havola javobi: HTTP ${probe.status}. Tekshirib ko'ring.`,
        });
      } catch (fetchErr: any) {
        clearTimeout(timer);
        return res.json({
          ok: true,
          reachable: false,
          reason: 'network_error',
          message: `⚠️ Havolani tekshirib bo'lmadi: ${fetchErr?.message || 'Tarmoq xatosi'}`,
        });
      }
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Mini App Menu Button va komandalarni botga ulash
  app.post('/api/telegram-setup-miniapp', async (req, res) => {
    try {
      const { botToken, webAppUrl, buttonText } = req.body || {};
      if (!botToken || !webAppUrl) {
        return res.status(400).json({ ok: false, description: "Bot Token va Mini App HTTPS havolasi kerak!" });
      }

      const cleanToken = String(botToken).trim();
      const cleanUrl = String(webAppUrl).trim();
      if (!isPublicMiniAppUrl(cleanUrl)) {
        return res.status(400).json({
          ok: false,
          description:
            "Bu test/yopiq havola (ais-dev, ais-pre yoki ai.studio) Telegram telefonda 403 / Google Email xatosini beradi! Shu sababli o'rnatilmadi. Yuqoridagi 🚀 Deploy (Cloud Run — Public) tugmasi orqali ommaviy https://...run.app havolasini oling.",
        });
      }

      const btnLabel = (buttonText && String(buttonText).trim()) || '📱 Kassa';
      const menuData = await syncMiniAppMenuButtons(cleanToken, cleanUrl, btnLabel);

      if (!menuData.ok) {
        return res.status(400).json({
          ok: false,
          description: menuData.description || "Menu tugmasini ulashda xatolik!",
        });
      }

      await syncBotCommands(cleanToken);

      const existing = readTgConfigFromDisk() || {};
      writeTgConfigToDisk({
        ...existing,
        botToken: cleanToken,
        miniAppUrl: cleanUrl,
        miniAppDisabled: false,
      });
      resetWebhookCacheForConfigUpdate();

      return res.json({ ok: true, isPreviewUrl: false, miniAppUrl: cleanUrl });
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
      await syncBotCommands(cleanToken);

      const existing = readTgConfigFromDisk() || {};
      writeTgConfigToDisk({
        ...existing,
        botToken: cleanToken,
        miniAppUrl: '',
        miniAppDisabled: true,
      });
      resetWebhookCacheForConfigUpdate();

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

      if (!isPublicMiniAppUrl(cleanUrl)) {
        return res.status(400).json({
          ok: false,
          description: "Yopiq/test havola (ais-dev, ais-pre, ai.studio) yuborilmadi — telefonda 403 beradi. Avval ommaviy Cloud Run (Deploy) havolasini kiriting!",
        });
      }

      const sendRes = await tgSend(
        cleanToken,
        cleanChatId,
        `🏪 <b>NAVO MARKET KASSA — MINI APP</b>\n\n` +
          `Kassirlar ro'yxatdan o'tishi va kunlik kassa hisobotini yuritishi uchun pastdagi tugmani bosing 👇`,
        {
          inline_keyboard: [
            [
              {
                text: '📱 Kassaga Kirish (Mini App)',
                web_app: { url: cleanUrl },
              },
            ],
          ],
        }
      );

      if (!sendRes.ok) {
        return res.status(400).json({ ok: false, description: sendRes.description || "Yuborishda xatolik" });
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
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server muvaffaqiyatli ishga tushdi: http://0.0.0.0:${PORT}`);
    startTelegramBotPoller();
  });
}

startServer();
