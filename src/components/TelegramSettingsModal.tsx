import React, { useState, useEffect } from 'react';
import { 
  Send, 
  Check, 
  X, 
  AlertCircle, 
  Store, 
  User, 
  ExternalLink,
  Bot,
  Sparkles,
  Info,
  Smartphone,
  Link2,
  CheckCircle2
} from 'lucide-react';
import { 
  TelegramConfig, 
  sendTelegramMessage, 
  checkTelegramBot,
  autoDetectChatId,
  setupTelegramMiniApp,
  sendTelegramMiniAppInvite,
  resetTelegramBotMenu,
  fetchServerAppUrl,
  checkMiniAppUrlReachability
} from '../utils/telegram';

interface TelegramSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: TelegramConfig;
  onSave: (config: TelegramConfig) => void;
}

export const TelegramSettingsModal: React.FC<TelegramSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave
}) => {
  const [botToken, setBotToken] = useState(config.botToken);
  const [chatId, setChatId] = useState(config.chatId);
  const [kassaNomi, setKassaNomi] = useState(config.kassaNomi || '1-Kassa (Asosiy)');
  const [kassirIsmi, setKassirIsmi] = useState(config.kassirIsmi || 'Doniyor');
  const [autoSendOnOpen, setAutoSendOnOpen] = useState(config.autoSendOnOpen);
  const [autoSendOnClose, setAutoSendOnClose] = useState(config.autoSendOnClose);
  const [autoSendOnTransaction, setAutoSendOnTransaction] = useState(config.autoSendOnTransaction);

  const [botUsername, setBotUsername] = useState<string | undefined>(config.botUsername);
  const [isCheckingBot, setIsCheckingBot] = useState(false);
  const [botCheckResult, setBotCheckResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isAutoDetecting, setIsAutoDetecting] = useState(false);

  const [miniAppUrl, setMiniAppUrl] = useState(config.miniAppUrl || '');
  const [isSettingUpMiniApp, setIsSettingUpMiniApp] = useState(false);
  const [urlProbe, setUrlProbe] = useState<{
    checking: boolean;
    reachable?: boolean;
    message?: string;
  }>({ checking: false });

  const [testStatus, setTestStatus] = useState<{ loading: boolean; success?: boolean; message?: string }>({
    loading: false
  });

  const runUrlProbe = async (targetUrl: string) => {
    const clean = targetUrl.trim();
    if (!clean.startsWith('https://')) {
      setUrlProbe({ checking: false, reachable: false, message: "Havola https:// bilan boshlanishi shart." });
      return;
    }
    setUrlProbe({ checking: true });
    const res = await checkMiniAppUrlReachability(clean);
    setUrlProbe({ checking: false, reachable: res.reachable, message: res.message });
  };

  useEffect(() => {
    if (isOpen) {
      setBotToken(config.botToken || '');
      setChatId(config.chatId || '');
      setKassaNomi(config.kassaNomi || '1-Kassa');
      setKassirIsmi(config.kassirIsmi || '');
      setAutoSendOnOpen(config.autoSendOnOpen);
      setAutoSendOnClose(config.autoSendOnClose);
      setAutoSendOnTransaction(config.autoSendOnTransaction);
      setBotUsername(config.botUsername);
      const fallbackOrigin =
        typeof window !== 'undefined' && window.location.origin.startsWith('https://')
          ? window.location.origin
          : '';
      const initialUrl = config.miniAppUrl || fallbackOrigin;
      setMiniAppUrl(initialUrl);
      if (initialUrl) {
        runUrlProbe(initialUrl);
      } else {
        fetchServerAppUrl().then(url => {
          if (url && url.startsWith('https://')) {
            setMiniAppUrl(prev => prev || url);
            runUrlProbe(url);
          }
        });
      }
      setTestStatus({ loading: false });
      setBotCheckResult(null);
    }
  }, [isOpen, config]);

  if (!isOpen) return null;

  // 1. Bot tokenini tekshirish
  const handleCheckBot = async () => {
    if (!botToken.trim()) {
      setBotCheckResult({ success: false, message: "Iltimos, avval Bot Tokenni kiriting!" });
      return;
    }

    setIsCheckingBot(true);
    setBotCheckResult(null);

    const res = await checkTelegramBot(botToken.trim());
    setIsCheckingBot(false);

    if (res.ok && res.username) {
      setBotUsername(res.username);
      setBotCheckResult({
        success: true,
        message: `🤖 Bot topildi: @${res.username} (${res.firstName || 'Navo Market'})`
      });
    } else {
      setBotCheckResult({
        success: false,
        message: res.description || "Bot tokeni xato! @BotFather bergan tokenni qayta tekshiring."
      });
    }
  };

  // 2. Chat ID ni avtomatik aniqlash (Foydalanuvchi START bosgan bo'lsa)
  const handleAutoDetect = async () => {
    if (!botToken.trim()) {
      setTestStatus({
        loading: false,
        success: false,
        message: "Iltimos, avval 1-katakdagi Bot Tokenni kiriting!"
      });
      return;
    }

    setIsAutoDetecting(true);
    setTestStatus({ loading: true, message: undefined });

    const res = await autoDetectChatId(botToken.trim());
    setIsAutoDetecting(false);

    if (res.ok && res.found && res.chatId) {
      setChatId(String(res.chatId));
      if (res.senderName) {
        setKassirIsmi(res.senderName);
      }
      setTestStatus({
        loading: false,
        success: true,
        message: `🎉 Ajoyib! Sizning Chat ID topildi: ${res.chatId} (${res.senderName}).\nBotingiz hozirgina Telegramda sizga muvaffaqiyatli salom xabari yubordi! Telefoningizni tekshiring.`
      });
    } else {
      setTestStatus({
        loading: false,
        success: false,
        message: res.description || "Botingizga hali hech kim START bosmagan. Iltimos botingizga kirib START tugmasini bosing va qayta tekshiring!"
      });
    }
  };

  // 3. Test xabar jo'natish
  const handleTestSend = async () => {
    if (!botToken.trim()) {
      setTestStatus({
        loading: false,
        success: false,
        message: "Bot Token kiritilmagan!"
      });
      return;
    }

    if (!chatId.trim()) {
      setTestStatus({
        loading: false,
        success: false,
        message: "Admin Chat ID kiritilmagan! Pastdagi 'Chat ID ni Avtomatik Aniqlash' tugmasini bosing yoki @userinfobot dan ID oling."
      });
      return;
    }

    setTestStatus({ loading: true, message: undefined });

    const now = new Date();
    const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    const testHtml = `🚀 <b>[NAVO MARKET — TEST ALOQA XABARI]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏪 <b>Kassa:</b> ${kassaNomi}\n` +
      `👤 <b>Kassir:</b> ${kassirIsmi}\n` +
      `⏰ <b>Vaqt:</b> ${timeStr}\n\n` +
      `✅ <b>Tabriklaymiz!</b> Telegram bot muvaffaqiyatli ulandi.\n` +
      `Endi kassa ochilganda va yopilganda ushbu chatga avtomatik barcha hisobotlar boradi!`;

    const res = await sendTelegramMessage(botToken, chatId, testHtml, botUsername);
    if (res.ok) {
      setTestStatus({
        loading: false,
        success: true,
        message: "Xabar Telegramga muvaffaqiyatli bordi! ✅ Telefoningizni tekshiring."
      });
    } else {
      setTestStatus({
        loading: false,
        success: false,
        message: res.description || "Ulanishda xatolik yuz berdi"
      });
    }
  };

  // 4. Mini App'ni vaqtincha o'chirib, faqat bot tugmalarini qoldirish
  const handleEnableNativeBot = async () => {
    if (!botToken.trim()) {
      setTestStatus({ loading: false, success: false, message: "Avval Bot Tokenni kiriting!" });
      return;
    }
    setIsSettingUpMiniApp(true);
    const res = await resetTelegramBotMenu(botToken.trim());
    setIsSettingUpMiniApp(false);
    if (res.ok) {
      setMiniAppUrl('');
      setTestStatus({
        loading: false,
        success: true,
        message:
          "✅ Mini App tugmasi o'chirildi. Endi bot faqat ichki tugmalar orqali ishlaydi (kassirlar /start bosib botning o'zida hisobot yuborishi mumkin)."
      });
    } else {
      setTestStatus({
        loading: false,
        success: false,
        message: res.description || "Sozlashda xatolik."
      });
    }
  };

  // 5. Mini App ni botga ulash (Menu tugmasi + /start Mini App tugmasi)
  const handleSetupMiniApp = async () => {
    if (!botToken.trim()) {
      setTestStatus({ loading: false, success: false, message: "Avval Bot Tokenni kiriting!" });
      return;
    }
    if (!miniAppUrl.trim().startsWith('https://')) {
      setTestStatus({
        loading: false,
        success: false,
        message: "Mini App havolasi https:// bilan boshlanishi shart!"
      });
      return;
    }

    setIsSettingUpMiniApp(true);
    setTestStatus({ loading: true, message: undefined });
    const res = await setupTelegramMiniApp({
      botToken: botToken.trim(),
      webAppUrl: miniAppUrl.trim(),
      buttonText: '📱 Kassa'
    });
    setIsSettingUpMiniApp(false);

    if (res.ok) {
      setTestStatus({
        loading: false,
        success: true,
        message: res.isPreviewUrl
          ? "🎉 Mini App botga ulandi! Telegramda «📱 Kassa» menyusi va /start tugmasi yoqildi.\n⚠️ Eslatma: Hozirgi havola AI Studio test havolasi (ais-dev) bo'lgani uchun boshqa kassirlar telefonida Google Email so'rashi mumkin. Hammada Email'siz ochilishi uchun ilovani Deploy (Public) qilib, o'sha havolani qo'ying."
          : "🎉 Mini App botga muvaffaqiyatli ulandi! Endi Telegram botingizda «📱 Kassa» menyusi va /start tugmasi to'liq ishlaydi."
      });
    } else {
      setTestStatus({
        loading: false,
        success: false,
        message: res.description || "Mini App ulashda xatolik yuz berdi."
      });
    }
  };

  // 6. Chatga "Kassaga kirish (Mini App)" tugmasini yuborish
  const handleSendMiniAppInvite = async () => {
    if (!botToken.trim() || !chatId.trim()) {
      setTestStatus({
        loading: false,
        success: false,
        message: "Avval Bot Token va Chat ID ni kiriting!"
      });
      return;
    }
    setIsSettingUpMiniApp(true);
    const res = await sendTelegramMiniAppInvite({
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      webAppUrl: miniAppUrl.trim()
    });
    setIsSettingUpMiniApp(false);

    if (res.ok) {
      setTestStatus({
        loading: false,
        success: true,
        message: "📩 Telegramga Mini App tugmasi yuborildi!"
      });
    } else {
      setTestStatus({
        loading: false,
        success: false,
        message: res.description || "Mini App tugmasini yuborishda xatolik."
      });
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const isConfigured = Boolean(botToken.trim() && chatId.trim());
    onSave({
      botToken: botToken.trim(),
      chatId: chatId.trim(),
      kassaNomi: kassaNomi.trim() || '1-Kassa',
      kassirIsmi: kassirIsmi.trim() || 'Kassir',
      autoSendOnOpen,
      autoSendOnClose,
      autoSendOnTransaction,
      enabled: isConfigured,
      botUsername,
      miniAppUrl: miniAppUrl.trim()
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Send className="w-5 h-5 -rotate-12" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Telegram Bot & Admin Sozlamalari</h2>
              <p className="text-xs text-slate-500">Do'kon egasiga kassa hisobotlarini yuborish</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Tushuntirish banneri */}
          <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl text-xs text-blue-900 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <Info className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Nima uchun Telegramda START bosganda bot javob bermadi?</span>
            </div>
            <p className="text-[11px] text-blue-800 leading-relaxed">
              Bu <strong>mutlaqo tabiiy!</strong> Yangi ochilgan bo'sh botlar o'z-o'zidan gapirmaydi. Siz START bosishingiz bilan Telegram botga sizga xabar yozish ruxsatini berdi.
              Endi pastdagi <b>"Chat ID ni Avtomatik Aniqlash"</b> tugmasini bossangiz, botimiz sizga Telegramda darhol javob qaytaradi!
            </p>
          </div>

          {/* Kassa va Kassir ma'lumoti */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Kassa Nomi *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={kassaNomi}
                  onChange={(e) => setKassaNomi(e.target.value)}
                  placeholder="1-Kassa, Bosh Kassa"
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
                <Store className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                Kassir Ismi *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={kassirIsmi}
                  onChange={(e) => setKassirIsmi(e.target.value)}
                  placeholder="Doniyor"
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
                />
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>
          </div>

          {/* 1. Bot Token */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-700 uppercase">
                1. Telegram Bot Token *
              </label>
              <button
                type="button"
                onClick={handleCheckBot}
                disabled={isCheckingBot || !botToken.trim()}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Bot className="w-3.5 h-3.5" />
                <span>{isCheckingBot ? "Tekshirilmoqda..." : "Botni tekshirish"}</span>
              </button>
            </div>
            <input
              type="text"
              value={botToken}
              onChange={(e) => {
                setBotToken(e.target.value);
                setBotCheckResult(null);
              }}
              placeholder="Masalan: 748392019:AAHdK938j..."
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
            />

            {/* Bot tekshirish natijasi */}
            {botCheckResult && (
              <div className={`mt-1.5 p-2 rounded-lg text-xs flex items-center justify-between ${
                botCheckResult.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}>
                <span>{botCheckResult.message}</span>
                {botUsername && (
                  <a
                    href={`https://t.me/${botUsername}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold inline-flex items-center gap-0.5 ml-2"
                  >
                    START bosish <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}
          </div>

          {/* 2. Admin Chat ID va Avtomatik aniqlash tugmasi */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-700 uppercase">
                2. Admin (Do'kon Egasi) Chat ID *
              </label>
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={isAutoDetecting || !botToken.trim()}
                className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold flex items-center gap-1 cursor-pointer bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 disabled:opacity-50"
                title="Botga START bosgan bo'lsangiz, ID avtomatik topiladi"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>{isAutoDetecting ? "Aniqlanmoqda..." : "START bosdim, ID'ni topish ⚡"}</span>
              </button>
            </div>
            <input
              type="text"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Masalan: 123456789 yoki -100123456789"
              className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-hidden"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Botingizga START bosgan bo'lsangiz, tepada <strong>"START bosdim, ID'ni topish ⚡"</strong> tugmasini bosing — o'zi avtomatik to'ldirib, botingizdan salom xabari jo'natadi!
            </p>
          </div>

          {/* Avtomatik xabarlar sozlamasi */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <span className="text-xs font-bold text-slate-800 uppercase block mb-1">
              Avtomatik Jo'natish Sozlamalari:
            </span>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={autoSendOnOpen}
                onChange={(e) => setAutoSendOnOpen(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <span>🟢 <strong>Kassa ochilganda</strong> (Ertalabki boshlang'ich sdacha bilan xabar borishi)</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={autoSendOnClose}
                onChange={(e) => setAutoSendOnClose(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <span>🔒 <strong>Kassa yopilganda</strong> (Z-Hisobot: Savdo, chiqim, kutilgan, faktik, raznitsa)</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={autoSendOnTransaction}
                onChange={(e) => setAutoSendOnTransaction(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
              />
              <span>⚡ <strong>Har bir amaliyotda</strong> (Firmaga to'lov yoki rasxod kiritilganda bildirishnoma)</span>
            </label>
          </div>

          {/* 3. Telegram Mini App & Kassirlar Kirishi */}
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="text-xs font-extrabold text-emerald-950 uppercase">
                  3. Telegram Mini App (Bot ichidagi ilova)
                </span>
              </div>
              {urlProbe.checking ? (
                <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  Tekshirilmoqda...
                </span>
              ) : urlProbe.reachable ? (
                <span className="text-[10px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                  Ommaviy ✓
                </span>
              ) : miniAppUrl.trim().startsWith('https://') ? (
                <span className="text-[10px] font-bold bg-rose-600 text-white px-2 py-0.5 rounded-full">
                  403 / Yopiq
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-emerald-900">
                  Mini App HTTPS havolasi:
                </span>
                <button
                  type="button"
                  disabled={urlProbe.checking || !miniAppUrl.trim()}
                  onClick={() => runUrlProbe(miniAppUrl)}
                  className="text-[11px] font-bold text-blue-700 hover:text-blue-900 underline cursor-pointer disabled:opacity-50"
                >
                  Havolani tekshirish
                </button>
              </div>
              <div className="relative">
                <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="url"
                  value={miniAppUrl}
                  onChange={e => {
                    setMiniAppUrl(e.target.value);
                    setUrlProbe({ checking: false });
                  }}
                  placeholder="https://sizning-saytingiz.run.app"
                  className="w-full pl-8 pr-3 py-2 text-xs font-mono bg-white border border-emerald-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {urlProbe.message && (
                <div
                  className={`p-2.5 rounded-xl text-[11px] leading-relaxed border ${
                    urlProbe.reachable
                      ? 'bg-emerald-100/70 border-emerald-300 text-emerald-950 font-semibold'
                      : 'bg-rose-50 border-rose-200 text-rose-900'
                  }`}
                >
                  <p>{urlProbe.message}</p>
                  {!urlProbe.reachable && (
                    <div className="mt-2 pt-2 border-t border-rose-200 text-slate-800 space-y-1">
                      <p className="font-bold text-rose-950">Telefonda 403 chiqmasligi uchun 4 ta qadam:</p>
                      <p>1. <strong>Share</strong> emas, yuqori o&apos;ngdagi <strong>🚀 Deploy (Cloud Run)</strong> tugmasini bosing (<strong>Allow unauthenticated / Public</strong> qilib).</p>
                      <p>2. Deploy tugagach chiqadigan <code>https://...run.app</code> (<code>ais-dev</code> va <code>ais-pre</code> bo&apos;lmagan) havolasini nusxalang.</p>
                      <p>3. Shu katakka qo&apos;yib <strong>«Mini App&apos;ni Botga Ulash ⚡»</strong> tugmasini bosing.</p>
                      <p>4. Agar avval <code>@BotFather</code> da <strong>Configure Mini App</strong> qo&apos;ygan bo&apos;lsangiz, o&apos;sha yerdagi havolani ham yangi <code>https://...run.app</code> ga almashtiring.</p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSettingUpMiniApp || !botToken.trim() || !miniAppUrl.trim()}
                  onClick={handleSetupMiniApp}
                  className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-50 shadow-xs"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isSettingUpMiniApp ? "Ulanmoqda..." : "Mini App'ni Botga Ulash ⚡"}</span>
                </button>
                <button
                  type="button"
                  disabled={isSettingUpMiniApp || !botToken.trim() || !chatId.trim() || !miniAppUrl.trim()}
                  onClick={handleSendMiniAppInvite}
                  className="py-2.5 px-3 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold cursor-pointer transition disabled:opacity-50"
                >
                  Botga Tugma Yuborish 📩
                </button>
              </div>
            </div>

            <div className="pt-1 border-t border-emerald-200/70 flex items-center justify-between gap-2 text-[11px] text-slate-600">
              <span>Ungacha botning ichki tugmalari (🟢/🔒) 403&apos;siz ishlayveradi.</span>
              <button
                type="button"
                disabled={isSettingUpMiniApp || !botToken.trim()}
                onClick={handleEnableNativeBot}
                className="text-slate-500 hover:text-rose-600 underline font-semibold shrink-0 cursor-pointer disabled:opacity-50"
              >
                Mini App&apos;ni o&apos;chirish
              </button>
            </div>
          </div>

          {/* Test yuborish natijasi */}
          {testStatus.message && (
            <div className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 border whitespace-pre-line ${
              testStatus.success 
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold' 
                : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {testStatus.success ? <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />}
              <div className="flex-1">
                <span className="block font-bold">{testStatus.success ? "Muvaffaqiyatli!" : "Xatolik:"}</span>
                <span className="mt-0.5 block">{testStatus.message}</span>
              </div>
            </div>
          )}

          {/* Test va Saqlash tugmalari */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={testStatus.loading}
              onClick={handleTestSend}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{testStatus.loading ? "Yuborilmoqda..." : "Test Xabar Yuborish 🚀"}</span>
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 cursor-pointer"
              >
                Bekor
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-xs transition cursor-pointer"
              >
                Saqlash
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
