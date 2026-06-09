const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const { getGroups, createGroup, deleteGroup } = require('../controllers/groupsController')

router.get('/',     verifyToken, getGroups)
router.post('/',    verifyToken, adminOnly, createGroup)
router.delete('/:id', verifyToken, adminOnly, deleteGroup)

module.exports = router