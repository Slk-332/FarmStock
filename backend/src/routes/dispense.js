const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getDispenses,
  createDispense,
  updateDispense,
} = require('../controllers/dispenseController')

router.get('/',     verifyToken, getDispenses)
router.post('/',    verifyToken, createDispense)
router.put('/:id',  verifyToken, adminOnly, updateDispense)

module.exports = router