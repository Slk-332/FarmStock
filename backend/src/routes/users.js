const express    = require('express')
const router     = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getUsers,
  createUser,
  updateUser,
  toggleUser,
} = require('../controllers/usersController')

router.get('/',         verifyToken, adminOnly, getUsers)
router.post('/',        verifyToken, adminOnly, createUser)
router.put('/:id',      verifyToken, adminOnly, updateUser)
router.patch('/:id/toggle', verifyToken, adminOnly, toggleUser)

module.exports = router