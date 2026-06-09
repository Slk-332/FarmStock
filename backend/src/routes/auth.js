const express = require('express')
const router  = express.Router()
const { login, getMe } = require('../controllers/authController')
const { verifyToken } = require('../middleware/auth')

router.post('/login', login)
router.get('/me', verifyToken, getMe)

module.exports = router