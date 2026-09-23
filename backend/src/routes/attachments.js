const express = require('express')
const router  = express.Router()
const { verifyToken } = require('../middleware/auth')
const {
  getAttachments,
  createAttachment,
  deleteAttachment,
} = require('../controllers/attachmentsController')

router.get('/',       verifyToken, getAttachments)
router.post('/',      verifyToken, createAttachment)
router.delete('/:id', verifyToken, deleteAttachment)

module.exports = router
