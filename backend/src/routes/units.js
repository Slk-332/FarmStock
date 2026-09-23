const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getUnits,
  createUnit,
  updateUnit,
  deleteUnit,
} = require('../controllers/unitsController')

router.get('/',       verifyToken, getUnits)
router.post('/',      verifyToken, adminOnly, createUnit)
router.put('/:id',    verifyToken, adminOnly, updateUnit)
router.delete('/:id', verifyToken, adminOnly, deleteUnit)

module.exports = router
