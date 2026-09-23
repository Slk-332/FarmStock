/**
 * เทสต์ว่าทุก endpoint ถูกต่อไว้จริง
 *
 * โปรเจกต์นี้มี route อยู่ 13 ไฟล์แล้ว การพิมพ์ชื่อฟังก์ชันผิดใน controller
 * จะทำให้ `router.get('/', verifyToken, undefined)` ระเบิดตอน import
 * ซึ่งถ้าไม่มีเทสต์จะไปเจอเอาตอน deploy ขึ้น Render แล้วเซิร์ฟเวอร์ไม่ขึ้น
 *
 * เทสต์นี้ไม่ต้องใช้ฐานข้อมูล — แค่ import แล้วอ่านตารางเส้นทางของ express
 *
 * รัน: npm test  (ในโฟลเดอร์ backend)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('dotenv').config({ quiet: true })

/** อ่านเส้นทางทั้งหมดของ router ออกมาเป็น "METHOD /path" */
function routesOf(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const method = Object.keys(layer.route.methods)[0].toUpperCase()
      return `${method} ${layer.route.path}`
    })
}

/** ทุก route ต้องมี middleware ตรวจ token อย่างน้อย 1 ตัว ยกเว้นที่ระบุไว้ */
const PUBLIC_ROUTES = new Set(['POST /login'])

const EXPECTED = {
  units: ['GET /', 'POST /', 'PUT /:id', 'DELETE /:id'],
  orders: [
    'GET /', 'GET /next-code', 'GET /:id',
    'POST /', 'PUT /:id', 'PATCH /:id/status', 'DELETE /:id',
  ],
  receipts: ['GET /', 'GET /next-no', 'GET /:id', 'POST /'],
  attachments: ['GET /', 'POST /', 'DELETE /:id'],
  formulas: ['GET /', 'GET /next-code', 'GET /:id', 'POST /', 'PUT /:id', 'DELETE /:id'],
  mixing: [
    'GET /', 'GET /next-no', 'GET /:id', 'GET /:id/requirement',
    'POST /', 'POST /:id/produce', 'PATCH /:id/cancel',
  ],
  planting: [
    'GET /areas', 'POST /areas', 'PUT /areas/:id', 'DELETE /areas/:id',
    'GET /plots', 'GET /plots/token/:token', 'GET /plots/:id',
    'POST /plots', 'PUT /plots/:id', 'DELETE /plots/:id',
    'POST /plots/:plot_id/activities', 'DELETE /activities/:activity_id',
    'POST /plots/:plot_id/harvests', 'POST /plots/:plot_id/readings',
  ],
  sales: [
    'GET /summary', 'GET /next-no', 'GET /', 'GET /:id',
    'POST /', 'PUT /:id', 'POST /:id/confirm', 'PATCH /:id/cancel', 'DELETE /:id',
  ],
  lots: ['GET /', 'GET /product/:productId', 'GET /next-no', 'POST /', 'PUT /:id', 'DELETE /:id'],
}

for (const [name, expected] of Object.entries(EXPECTED)) {
  test(`/api/${name} ต่อ endpoint ครบตามที่ตั้งใจ`, () => {
    const router = require(`../src/routes/${name}.js`)
    assert.deepEqual(routesOf(router), expected)
  })
}

test('ทุก route ที่ไม่ใช่ public มี middleware ตรวจ token', () => {
  const names = [...Object.keys(EXPECTED), 'auth', 'users', 'groups', 'products', 'items', 'dispense', 'report']
  const unprotected = []

  for (const name of names) {
    const router = require(`../src/routes/${name}.js`)
    for (const layer of router.stack) {
      if (!layer.route) continue
      const method = Object.keys(layer.route.methods)[0].toUpperCase()
      const label = `${method} ${layer.route.path}`
      if (PUBLIC_ROUTES.has(label)) continue

      // express เก็บ handler ไว้ใน route.stack — verifyToken ต้องเป็นตัวใดตัวหนึ่ง
      const hasGuard = layer.route.stack.some((h) => h.name === 'verifyToken')
      if (!hasGuard) unprotected.push(`${name}: ${label}`)
    }
  }

  assert.deepEqual(unprotected, [], `endpoint ที่ลืมใส่ verifyToken:\n${unprotected.join('\n')}`)
})

test('เส้นทางที่ชนกันถูกวางลำดับถูก — ตัวเจาะจงมาก่อนตัวจับทุกอย่าง', () => {
  // GET /:id จะกลืน GET /summary ถ้าวางผิดลำดับ แล้ว "summary" จะถูกส่งไปเป็น id
  const checks = [
    ['sales',    'GET /summary',           'GET /:id'],
    ['sales',    'GET /next-no',           'GET /:id'],
    ['orders',   'GET /next-code',         'GET /:id'],
    ['receipts', 'GET /next-no',           'GET /:id'],
    ['formulas', 'GET /next-code',         'GET /:id'],
    ['mixing',   'GET /next-no',           'GET /:id'],
    ['planting', 'GET /plots/token/:token','GET /plots/:id'],
  ]

  for (const [name, specific, generic] of checks) {
    const routes = routesOf(require(`../src/routes/${name}.js`))
    const specificAt = routes.indexOf(specific)
    const genericAt  = routes.indexOf(generic)
    assert.ok(specificAt !== -1, `${name}: ไม่พบ ${specific}`)
    assert.ok(genericAt !== -1,  `${name}: ไม่พบ ${generic}`)
    assert.ok(
      specificAt < genericAt,
      `${name}: ${specific} ต้องมาก่อน ${generic} ไม่งั้นจะถูกกลืน`
    )
  }
})
