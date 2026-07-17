import express from 'express'
import verifyWebhook  from '../middleware/verifyWebhook.js'
import webhookController from '../controllers/webhook.controller.js'

const router = express.Router()

router.post('/change',
verifyWebhook,
webhookController.receiveChange
)
router.get('/list',webhookController.getLetestNotifications)

export default router;