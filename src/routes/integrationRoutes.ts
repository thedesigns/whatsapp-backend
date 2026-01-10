import { Router } from 'express';
import * as shopifyController from '../controllers/shopifyController.js';
import * as woocommerceController from '../controllers/woocommerceController.js';
import * as zohoController from '../controllers/zohoController.js';
import * as tallyController from '../controllers/tallyController.js';
import * as configController from '../controllers/organizationIntegrationController.js';
import * as externalController from '../controllers/externalController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Shopify Webhooks (No Auth, uses HMAC)
router.post('/shopify/webhook/:orgId', shopifyController.handleShopifyWebhook);

// WooCommerce Webhooks (No Auth, uses HMAC)
router.post('/woocommerce/webhook/:orgId', woocommerceController.handleWooCommerceWebhook);

// Zoho Webhooks (No Auth)
router.post('/zoho/webhook/:orgId', zohoController.handleZohoWebhook);

// Tally Sync
router.post('/tally/sync/:orgId', tallyController.handleTallySync);

// External API (Public-facing with API Key/JWT)
router.post('/send', authMiddleware, externalController.sendMessage);
router.post('/send-template', authMiddleware, externalController.sendTemplate);

// Configuration API (Protected by authMiddleware)
router.get('/:orgId', authMiddleware, configController.getIntegrations);
router.get('/:orgId/activity', authMiddleware, configController.getIntegrationActivity);
router.get('/:orgId/stats', authMiddleware, configController.getIntegrationStats);
router.post('/:orgId', authMiddleware, configController.saveIntegration);
router.delete('/:id', authMiddleware, configController.deleteIntegration);

// External API Settings
router.get('/:orgId/settings', authMiddleware, externalController.getApiKey);
router.post('/:orgId/settings', authMiddleware, externalController.updateSettings);
router.post('/:orgId/generate-api-key', authMiddleware, externalController.generateApiKey);

export default router;
