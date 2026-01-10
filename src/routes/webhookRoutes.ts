import { Router } from 'express';
import * as webhookController from '../controllers/webhookController.js';

const router = Router();

// Webhook verification (GET) - no auth required, org specific
router.get('/:orgId', webhookController.verifyWebhook);

// Webhook handler (POST) - no auth required (verified by signature), org specific
router.post('/:orgId', webhookController.handleWebhook);

// Legacy/Fallback
router.get('/', webhookController.verifyWebhook);
router.post('/', webhookController.handleWebhook);

// Get webhook status (for debugging)
router.get('/status', webhookController.getWebhookStatus);

export default router;
