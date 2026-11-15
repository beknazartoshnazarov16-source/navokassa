import { KassaDayRecord } from '../types/kassa';
import { calculateTotals } from './storage';

export function formatMoney(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return "0 so'm";
  }
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${absStr} so'm`;
}

export function formatNumber(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '0';
  }
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const absStr = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${absStr}`;
}

export function formatUzbekDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  const monthsUz = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
  ];

  const daysUz = [
    'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'
  ];

  return `${day}-${monthsUz[date.getMonth()]}, ${year} (${daysUz[date.getDay()]})`;
}

export function getCurrentTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function generatePlainReportText(record: KassaDayRecord): string {
  const t = calculateTotals(record);
  const f = (n: number) => formatMoney(n);

  let text = `🏪 NAVO MARKET — KUNLIK KASSA HISOBOTI\n`;
  text += `📌 Kassa: ${record.kassaNomi} | Kassir: ${record.kassirIsmi || '-'}\n`;
  text += `📅 Sana: ${formatUzbekDate(record.date)}\n\n`;

  text += `💵 Naqd pul: ${f(t.sofNaqd)}`;
  if (t.ertalabkiSdacha > 0) {
    text += ` (${f(t.naqdSanalgan)} sanalgan - ${f(t.ertalabkiSdacha)} sdacha)`;
  }
  text += `\n`;
  text += `💳 Terminal: ${f(t.terminalJami)}\n`;
  text += `📱 Click / Payme: ${f(t.clickJami)}\n`;
  text += `📝 Qarzga berildi (${record.qarzList.length} ta): ${f(t.qarzJami)}\n`;
  if (record.qarzList.length > 0) {
    record.qarzList.forEach((q, idx) => {
      text += `   ${idx + 1}. ${q.nomi}: ${f(q.summa)}\n`;
    });
  }

  text += `🚚 Firmaga berildi (${record.firmaList.length} ta): ${f(t.firmaJami)}\n`;
  if (record.firmaList.length > 0) {
    record.firmaList.forEach((fp, idx) => {
      text += `   ${idx + 1}. ${fp.nomi}: ${f(fp.summa)}\n`;
    });
  }

  if (t.rasxodJami > 0 || record.rasxodList.length > 0) {
    text += `📦 Rasxodlar (${record.rasxodList.length} ta): ${f(t.rasxodJami)}\n`;
    record.rasxodList.forEach((r, idx) => {
      text += `   ${idx + 1}. ${r.nomi}: ${f(r.summa)}\n`;
    });
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `🧮 JAMI HISOBLANGAN: ${f(t.jamiHisoblangan)}\n`;
  text += `🧾 CHEKDAGI SUMMA: ${f(t.chekdagiSumma)}\n`;

  if (t.farq === 0) {
    text += `✅ NATIJA: TO'G'RI CHIQDI (Farq: 0 so'm)\n`;
  } else if (t.farq < 0) {
    text += `⚠️ NATIJA: ${f(Math.abs(t.farq))} KAM CHIQDI!\n`;
  } else {
    text += `ℹ️ NATIJA: +${f(t.farq)} ORTIQCHA CHIQDI\n`;
  }

  if (record.izoh) {
    text += `\n📌 Izoh: ${record.izoh}\n`;
  }

  return text;
}
