const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getLots,
  getLotsByProduct,
  createLot,
  updateLot,
  deleteLot,
} = require('../controllers/lotsController')

router.get('/',                   verifyToken, getLots)
router.get('/product/:productId', verifyToken, getLotsByProduct)
router.post('/',                  verifyToken, createLot)
router.put('/:id',                verifyToken, adminOnly, updateLot)
router.delete('/:id',             verifyToken, adminOnly, deleteLot)

module.exports = router