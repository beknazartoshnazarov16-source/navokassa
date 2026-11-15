import React, { useState, useEffect } from 'react';
import { X, Calculator, Check, RotateCcw } from 'lucide-react';
import { formatMoney, formatNumber } from '../utils/format';

interface BillCounterModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentActualCash: number;
  onApplyTotal: (total: number) => void;
}

const BILL_DENOMINATIONS = [
  { value: 200000, label: "200 000 so'm", color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  { value: 100000, label: "100 000 so'm", color: 'bg-blue-50 text-blue-800 border-blue-200' },
  { value: 50000, label: "50 000 so'm", color: 'bg-purple-50 text-purple-800 border-purple-200' },
  { value: 20000, label: "20 000 so'm", color: 'bg-amber-50 text-amber-800 border-amber-200' },
  { value: 10000, label: "10 000 so'm", color: 'bg-teal-50 text-teal-800 border-teal-200' },
  { value: 5000, label: "5 000 so'm", color: 'bg-rose-50 text-rose-800 border-rose-200' },
  { value: 2000, label: "2 000 so'm", color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  { value: 1000, label: "1 000 so'm", color: 'bg-slate-100 text-slate-800 border-slate-300' },
];

export const BillCounterModal: React.FC<BillCounterModalProps> = ({
  isOpen,
  onClose,
  currentActualCash,
  onApplyTotal
}) => {
  const [counts, setCounts] = useState<{ [denom: number]: number }>(() => {
    return BILL_DENOMINATIONS.reduce((acc, curr) => {
      acc[curr.value] = 0;
      return acc;
    }, {} as { [denom: number]: number });
  });

  const [extraCoins, setExtraCoins] = useState<number>(0);

  if (!isOpen) return null;

  const totalCalculated = BILL_DENOMINATIONS.reduce((acc, curr) => {
    const qty = counts[curr.value] || 0;
    return acc + (curr.value * qty);
  }, 0) + (extraCoins || 0);

  const totalBillsCount = BILL_DENOMINATIONS.reduce((acc, curr) => {
    return acc + (counts[curr.value] || 0);
  }, 0);

  const handleQtyChange = (denom: number, valStr: string) => {
    const val = parseInt(valStr.replace(/\D/g, ''), 10) || 0;
    setCounts(prev => ({ ...prev, [denom]: val }));
  };

  const handleIncrement = (denom: number, delta: number) => {
    setCounts(prev => ({
      ...prev,
      [denom]: Math.max(0, (prev[denom] || 0) + delta)
    }));
  };

  const handleReset = () => {
    setCounts(BILL_DENOMINATIONS.reduce((acc, curr) => {
      acc[curr.value] = 0;
      return acc;
    }, {} as { [denom: number]: number }));
    setExtraCoins(0);
  };

  const handleConfirm = () => {
    onApplyTotal(totalCalculated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-emerald-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">Kassadagi Naqd Pulni Kupuralar Bo'yicha Sanash</h2>
              <p className="text-xs text-slate-500">Har bir qog'oz pul (kupura) sonini kiriting, dastur avtomatik jamlaydi</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Total Banner */}
        <div className="px-6 py-3 bg-emerald-600 text-white flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-emerald-100 uppercase tracking-wider block">Sanalgan Jami Naqd Pul:</span>
            <span className="text-2xl font-bold font-mono-nums tracking-tight">
              {formatMoney(totalCalculated)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-emerald-100 block">Jami kupuralar soni:</span>
            <span className="text-base font-semibold font-mono-nums">{totalBillsCount} ta dona</span>
          </div>
        </div>

        {/* Denominations List */}
        <div className="p-6 overflow-y-auto space-y-3 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {BILL_DENOMINATIONS.map(item => {
              const qty = counts[item.value] || 0;
              const subtotal = item.value * qty;

              return (
                <div 
                  key={item.value} 
                  className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${item.color}`}
                >
                  <div className="min-w-[100px]">
                    <div className="text-sm font-bold">{item.label}</div>
                    <div className="text-xs font-mono-nums text-slate-600">
                      = {formatNumber(subtotal)} so'm
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleIncrement(item.value, -1)}
                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-700 font-bold hover:bg-slate-50 active:scale-95"
                    >
                      -
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={qty === 0 ? '' : qty}
                      placeholder="0"
                      onChange={(e) => handleQtyChange(item.value, e.target.value)}
                      className="w-16 h-8 text-center text-sm font-bold font-mono-nums bg-white border border-slate-300 rounded focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => handleIncrement(item.value, 1)}
                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-300 rounded text-slate-700 font-bold hover:bg-slate-50 active:scale-95"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => handleIncrement(item.value, 10)}
                      className="px-1.5 h-7 text-xs font-medium bg-white/80 border border-slate-300 rounded hover:bg-white text-slate-600"
                    >
                      +10
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Extra coins or loose change */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-xs font-medium text-slate-700 block">Mayda tangalar va qoldiqlar (so'mda):</span>
              <span className="text-xs text-slate-500">Kupuraga kirmagan mayda pullar</span>
            </div>
            <div className="w-48">
              <input
                type="number"
                value={extraCoins || ''}
                placeholder="0"
                onChange={(e) => setExtraCoins(parseInt(e.target.value, 10) || 0)}
                className="w-full px-3 py-1.5 text-right font-mono-nums text-sm font-semibold border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 px-3 py-2 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Tozalash (0 qilish)
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Bekor qilish
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors"
            >
              <Check className="w-4 h-4" />
              Kassaga Qo'llash ({formatNumber(totalCalculated)} so'm)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
