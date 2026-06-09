const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getItems,
  getItemByItemId,
  updatePrintStatus,
  deleteItem,
} = require('../controllers/itemsController')

router.get('/',              verifyToken, getItems)
router.get('/:itemId',       verifyToken, getItemByItemId)
router.patch('/print',       verifyToken, updatePrintStatus)
router.delete('/:id',        verifyToken, adminOnly, deleteItem)

module.exports = router