import { Router } from 'express';
import * as chatbotController from '../controllers/chatbotController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/flows', chatbotController.getFlows);
router.post('/test', chatbotController.testFlow);
router.get('/flows/:id', chatbotController.getFlow);
router.post('/flows/:id', chatbotController.saveFlow);
router.delete('/flows/:id', chatbotController.deleteFlow);
router.patch('/flows/:id/status', chatbotController.toggleFlowStatus);

export default router;

