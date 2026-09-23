const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getSales,
  getSaleById,
  getNextSaleNo,
  getSalesSummary,
  createSale,
  updateSale,
  confirmSale,
  cancelSale,
  deleteSale,
} = require('../controllers/salesController')

// /summary และ /next-no ต้องมาก่อน /:id ไม่งั้น express จะจับเป็น id
router.get('/summary',       verifyToken, getSalesSummary)
router.get('/next-no',       verifyToken, getNextSaleNo)
router.get('/',              verifyToken, getSales)
router.get('/:id',           verifyToken, getSaleById)
router.post('/',             verifyToken, createSale)
router.put('/:id',           verifyToken, updateSale)
router.post('/:id/confirm',  verifyToken, confirmSale)
router.patch('/:id/cancel',  verifyToken, cancelSale)
router.delete('/:id',        verifyToken, adminOnly, deleteSale)

module.exports = router
