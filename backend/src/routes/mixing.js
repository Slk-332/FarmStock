const express = require('express')
const router  = express.Router()
const { verifyToken } = require('../middleware/auth')
const {
  getMixingOrders,
  getMixingOrderById,
  getNextMixNo,
  getRequirement,
  createMixingOrder,
  produceMixingOrder,
  cancelMixingOrder,
} = require('../controllers/mixingController')

router.get('/',                 verifyToken, getMixingOrders)
router.get('/next-no',          verifyToken, getNextMixNo)
router.get('/:id',              verifyToken, getMixingOrderById)
router.get('/:id/requirement',  verifyToken, getRequirement)
router.post('/',                verifyToken, createMixingOrder)
router.post('/:id/produce',     verifyToken, produceMixingOrder)
router.patch('/:id/cancel',     verifyToken, cancelMixingOrder)

module.exports = router
