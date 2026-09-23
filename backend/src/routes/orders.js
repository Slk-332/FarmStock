const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getOrders,
  getOrderById,
  getNextOrderCode,
  createOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
} = require('../controllers/ordersController')

router.get('/',             verifyToken, getOrders)
router.get('/next-code',    verifyToken, getNextOrderCode)
router.get('/:id',          verifyToken, getOrderById)
router.post('/',            verifyToken, createOrder)
router.put('/:id',          verifyToken, updateOrder)
router.patch('/:id/status', verifyToken, updateOrderStatus)
router.delete('/:id',       verifyToken, adminOnly, deleteOrder)

module.exports = router
