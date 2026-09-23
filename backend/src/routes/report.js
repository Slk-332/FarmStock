const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getDashboard,
  getSummary,
  getDispenseReport,
  getStockInReport,
  getLowStockReport,
  getExpireReport,
  getWeeklyDispense,
} = require('../controllers/reportController')

router.get('/dashboard',  verifyToken, adminOnly, getDashboard)
router.get('/summary',    verifyToken, adminOnly, getSummary)
router.get('/dispense',   verifyToken, adminOnly, getDispenseReport)
router.get('/stock-in',   verifyToken, adminOnly, getStockInReport)
router.get('/low-stock',  verifyToken, adminOnly, getLowStockReport)
router.get('/expiring',   verifyToken, adminOnly, getExpireReport)
router.get('/weekly-dispense', verifyToken, adminOnly, getWeeklyDispense)

module.exports = router