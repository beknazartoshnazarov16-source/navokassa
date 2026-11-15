export interface SimpleEntry {
  id: string;
  nomi: string; // Masalan: "Coca-Cola", "Dilshod aka", "Abed", "Click 1"
  summa: number;
  izoh?: string;
  vaqt: string; // HH:mm
}

export interface CashierProfile {
  id: string;
  ism: string;
  telefon?: string;
  telegramId?: string;
  telegramUsername?: string;
  asosiyKassa?: string;
  createdAt: string;
  lastActiveAt?: string;
}

export interface KassaDayRecord {
  id: string; // `${date}__${kassaNomi}`
  date: string; // YYYY-MM-DD
  kassaNomi: string; // "1-Kassa", "2-Kassa", ...
  kassirIsmi: string;
  kassirId?: string;
  isOchiq: boolean;
  ochilganVaqt?: string;
  yopilganVaqt?: string;

  // 1. Naqd pul
  naqdPul: number; // Sanab kiritilgan naqd pul
  ertalabkiSdacha: number; // Ixtiyoriy: ertalab kassada qoldirilgan mayda pul (ayriladi)

  // 2. Terminal (Humo / Uzcard)
  terminalSumma: number;
  terminalList: SimpleEntry[]; // Agar bir nechta terminal cheklari bo'lsa

  // 3. Click / Payme
  clickSumma: number;
  clickList: SimpleEntry[]; // Agar kliklarni bitta-bitta kiritmoqchi bo'lsa

  // 4. Qarzga berilgan pullar
  qarzList: SimpleEntry[];

  // 5. Firmaga berilgan pullar
  firmaList: SimpleEntry[];

  // 6. Do'kon rasxodlari (abed, paket, yo'lkira...)
  rasxodList: SimpleEntry[];

  // 7. Chekdagi umumiy savdo summasi (Kassa apparat / Kompyuter Z-otcheti)
  chekdagiSumma: number;

  izoh?: string;
  updatedAt?: string;
}
