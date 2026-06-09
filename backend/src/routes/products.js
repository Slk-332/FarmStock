const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
} = require('../controllers/productsController')

router.get('/',     verifyToken, getProducts)
router.get('/:id',  verifyToken, getProductById)
router.post('/',    verifyToken, adminOnly, createProduct)
router.put('/:id',  verifyToken, adminOnly, updateProduct)

module.exports = router