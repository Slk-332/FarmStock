const express = require('express')
const router  = express.Router()
const { verifyToken, adminOnly } = require('../middleware/auth')
const {
  getAreas, createArea, updateArea, deleteArea,
  getPlots, getPlotById, getPlotByToken, createPlot, updatePlot, deletePlot,
  createActivity, deleteActivity, createHarvest, createReading,
} = require('../controllers/plantingController')

// โซน
router.get('/areas',        verifyToken, getAreas)
router.post('/areas',       verifyToken, createArea)
router.put('/areas/:id',    verifyToken, updateArea)
router.delete('/areas/:id', verifyToken, adminOnly, deleteArea)

// แปลง — /token/:token มาก่อน /:id เพราะไม่งั้น express จะจับ "token" เป็น id
router.get('/plots',              verifyToken, getPlots)
router.get('/plots/token/:token', verifyToken, getPlotByToken)
router.get('/plots/:id',          verifyToken, getPlotById)
router.post('/plots',             verifyToken, createPlot)
router.put('/plots/:id',          verifyToken, updatePlot)
router.delete('/plots/:id',       verifyToken, adminOnly, deletePlot)

// กิจกรรม / เก็บเกี่ยว / เซ็นเซอร์
router.post('/plots/:plot_id/activities',            verifyToken, createActivity)
router.delete('/activities/:activity_id',            verifyToken, deleteActivity)
router.post('/plots/:plot_id/harvests',              verifyToken, createHarvest)
router.post('/plots/:plot_id/readings',              verifyToken, createReading)

module.exports = router
