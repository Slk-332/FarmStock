export default function SummaryCards({ summary }) {
  if (!summary) return null

  const totalAll   = Number(summary.total_dispense?.total_all    || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
  const totalMonth = Number(summary.total_dispense?.total_month  || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
  const totalToday = Number(summary.total_dispense?.total_today  || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })
  const stockValue = Number(summary.stock_value?.total_stock_value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })

  return (
    <div className="flex flex-col gap-3">
      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
          <div className="text-xs text-gray-400">มูลค่าเบิกจ่ายทั้งหมด</div>
          <div className="text-base font-semibold text-gray-800">{totalAll}</div>
          <div className="text-xs text-gray-400">บาท</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
          <div className="text-xs text-gray-400">เบิกจ่ายเดือนนี้</div>
          <div className="text-base font-semibold text-blue-600">{totalMonth}</div>
          <div className="text-xs text-gray-400">บาท</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
          <div className="text-xs text-gray-400">เบิกจ่ายวันนี้</div>
          <div className="text-base font-semibold text-green-600">{totalToday}</div>
          <div className="text-xs text-gray-400">บาท</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
          <div className="text-xs text-gray-400">มูลค่า Stock คงเหลือ</div>
          <div className="text-base font-semibold text-purple-600">{stockValue}</div>
          <div className="text-xs text-gray-400">บาท</div>
        </div>
      </div>

      {/* ยอดรวมรายสินค้า */}
      {summary.total_by_product?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <div className="text-sm font-medium text-gray-700 pb-2 border-b border-gray-100">
            💰 ยอดเบิกจ่ายรวมรายสินค้า
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 text-left text-gray-400 font-medium">MatUID</th>
                  <th className="pb-2 text-left text-gray-400 font-medium">ชื่อสินค้า</th>
                  <th className="pb-2 text-right text-gray-400 font-medium">จำนวนเบิก</th>
                  <th className="pb-2 text-right text-gray-400 font-medium">มูลค่ารวม (บาท)</th>
                  <th className="pb-2 text-right text-gray-400 font-medium">% ของทั้งหมด</th>
                </tr>
              </thead>
              <tbody>
                {summary.total_by_product.map((p, i) => {
                  const pct = Number(summary.total_dispense?.total_all) > 0
                    ? ((Number(p.total_cost) / Number(summary.total_dispense?.total_all)) * 100).toFixed(1)
                    : 0
                  return (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 text-gray-500 whitespace-nowrap">{p.mat_uid}</td>
                      <td className="py-2 text-gray-700 font-medium whitespace-nowrap">{p.product_name}</td>
                      <td className="py-2 text-gray-500 text-right whitespace-nowrap">{p.total_qty} ชิ้น</td>
                      <td className="py-2 text-gray-700 font-semibold text-right whitespace-nowrap">
                        {Number(p.total_cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-500 w-8 text-right">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td colSpan={2} className="pt-2 text-gray-500 font-medium">รวมทั้งหมด</td>
                  <td className="pt-2 text-right text-gray-500 font-medium">
                    {summary.total_by_product.reduce((s,p) => s + p.total_qty, 0)} ชิ้น
                  </td>
                  <td className="pt-2 text-right text-gray-800 font-bold">
                    {Number(summary.total_dispense?.total_all || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}