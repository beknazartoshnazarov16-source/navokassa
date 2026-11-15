import { useState } from 'react';
import { Download, Smartphone, Share, PlusSquare, Monitor, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const { canNativeInstall, isInstalled, isIOS, isInIframe, promptInstall } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  // If already running as installed standalone app, hide install button
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (canNativeInstall) {
      const accepted = await promptInstall();
      if (accepted) return;
    }
    // For iOS Safari, preview iframe, or browsers where native prompt isn't ready yet:
    // show clear step-by-step installation guide in Uzbek
    setShowGuideModal(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="px-3 py-2 rounded-xl text-xs font-bold border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        title="Telefon yoki kompyuterga ilova qilib o'rnatish"
      >
        <Download className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Ilovani O&apos;rnatish</span>
        <span className="sm:hidden">Ilova</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-4 border-b border-slate-100 bg-emerald-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-900 text-sm">
                    Ilova Qilib O&apos;rnatish (24/7)
                  </h3>
                  <p className="text-[11px] text-emerald-800">
                    Telefon va kompyuter ekraniga chiqarish
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-700">
              {isInIframe && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 leading-relaxed">
                  <strong>Eslatma:</strong> Hozir dasturni AI Studio ichki oynasida ko&apos;ryapsiz.
                  Ilova qilib o&apos;rnatish uchun dasturning alohida havolasini (<strong>Shared URL</strong>)
                  brauzerning yangi oynasida ochib o&apos;rnating.
                </div>
              )}

              {isIOS ? (
                <div className="space-y-3">
                  <div className="font-bold text-slate-900 text-sm">
                    iPhone / iPad (Safari) orqali o&apos;rnatish:
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <Share className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>1-qadam:</strong> Safari pastidagi <strong>Ulashish (Share)</strong> tugmasini bosing.
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <PlusSquare className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong>2-qadam:</strong> Ro&apos;yxatdan <strong>&laquo;Bosh ekranga qo&apos;shish&raquo; (Add to Home Screen)</strong> ni tanlang va <strong>Add</strong> bosing.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <Smartphone className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-900 block mb-0.5">Android telefonda (Chrome):</strong>
                      Brauzerning o&apos;ng yuqori burchagidagi <strong>⋮ (3 nuqta)</strong> menyusini bosing &rarr;{' '}
                      <strong>&laquo;Ilovani o&apos;rnatish&raquo;</strong> yoki <strong>&laquo;Bosh ekranga qo&apos;shish&raquo;</strong> ni tanlang.
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <Monitor className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-slate-900 block mb-0.5">Do&apos;kon kompyuterida (Windows / Mac):</strong>
                      Chrome yoki Edge manzil qatorining o&apos;ng chekkasidagi{' '}
                      <strong>O&apos;rnatish (Install)</strong> belgisini bosing — ish stolida alohida kassa dasturi belgisi paydo bo&apos;ladi.
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-emerald-900">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Oflayn ham ishlaydi:</strong> Do&apos;konda internet uzilib qolsa ham, ilova ochiladi va
                  barcha yozuvlarni xotirada saqlab turadi. Internet ulanganda avtomatik serverga yuklaydi.
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="px-5 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Tushunarli
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
