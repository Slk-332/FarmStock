const { loadUnits, convertOrThrow } = require('../lib/units')
const {
  resolveStockLines, consumeFromStock, round2, round4,
} = require('./consumptionService')

/**
 * ตรรกะเฉพาะของการผสม — ขยายสูตรตามปริมาณที่สั่งผลิต
 *
 * ส่วนที่เป็นการหักของจากสต๊อกอยู่ใน consumptionService เพราะการดูแลแปลงปลูก (Phase 4)
 * ใช้กติกาเดียวกันทุกอย่าง ต่างกันแค่บันทึกประวัติลงคนละตาราง
 */

/**
 * ขยายสูตรตามปริมาณที่สั่งผลิต แล้วบอกว่าต้องใช้วัตถุดิบอะไรเท่าไร และมีพอไหม
 */
async function calculateRequirement(client, { formula, targetQty, targetUnit }) {
  const units = await loadUnits(client)

  // ตัวคูณของสูตร: สั่ง 50 กก. จากสูตรที่ให้ผล 10 กก. ต่อชุด = ผสม 5 ชุด
  const targetInOutputUnit = convertOrThrow(
    units, targetQty, targetUnit, formula.output_unit, 'ปริมาณที่สั่งผลิต'
  )
  const scale = targetInOutputUnit / Number(formula.output_qty)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error('ปริมาณที่สั่งผลิตไม่ถูกต้อง')
  }

  const { rows: formulaLines } = await client.query(
    `SELECT fl.* FROM formula_line fl
     WHERE fl.formula_id = $1
     ORDER BY fl.seq ASC, fl.id ASC`,
    [formula.id]
  )

  if (formulaLines.length === 0) {
    throw new Error('สูตรนี้ยังไม่มีรายการวัตถุดิบ')
  }

  const lines = await resolveStockLines(client, formulaLines.map((fl) => ({
    formula_line_id: fl.id,
    product_id:      fl.product_id,
    qty:             round4(Number(fl.qty) * scale),
    unit_code:       fl.unit_code,
    formula_qty:     Number(fl.qty),
    formula_unit:    fl.unit_code,
  })))

  return { scale: round4(scale), lines }
}

/** หักวัตถุดิบตามที่คำนวณไว้ แล้วบันทึกลง mixing_consumption */
async function consumeMaterials(client, { mixingOrderId, requirement }) {
  return consumeFromStock(client, {
    lines: requirement.lines,
    onConsume: async (row) => {
      const result = await client.query(
        `INSERT INTO mixing_consumption
           (mixing_order_id, product_id, item_id, qty, unit_code, cost)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [mixingOrderId, row.product_id, row.item_id, row.qty, row.unit_code, row.cost]
      )
      return result.rows[0]
    },
  })
}

module.exports = { calculateRequirement, consumeMaterials, round2, round4 }
