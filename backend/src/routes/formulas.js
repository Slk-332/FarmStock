const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getFormulas,
  getFormulaById,
  getNextStdCode,
  createFormula,
  updateFormula,
  deleteFormula,
} = require('../controllers/formulasController')

router.get('/',          verifyToken, getFormulas)
router.get('/next-code', verifyToken, getNextStdCode)
router.get('/:id',       verifyToken, getFormulaById)
router.post('/',         verifyToken, createFormula)
router.put('/:id',       verifyToken, updateFormula)
router.delete('/:id',    verifyToken, adminOnly, deleteFormula)

module.exports = router
