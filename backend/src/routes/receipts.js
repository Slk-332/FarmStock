const express = require('express')
const router  = express.Router()
const { verifyToken } = require('../middleware/auth')
const {
  getReceipts,
  getReceiptById,
  getNextReceiptNo,
  createReceipt,
} = require('../controllers/receiptsController')

router.get('/',          verifyToken, getReceipts)
router.get('/next-no',   verifyToken, getNextReceiptNo)
router.get('/:id',       verifyToken, getReceiptById)
router.post('/',         verifyToken, createReceipt)

module.exports = router
