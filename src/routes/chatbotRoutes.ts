import { Router } from 'express';
import * as chatbotController from '../controllers/chatbotController.js';
import * as flowVariableController from '../controllers/flowVariableController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

// Flow routes
router.get('/flows', chatbotController.getFlows);
router.post('/test', chatbotController.testFlow);
router.get('/flows/:id', chatbotController.getFlow);
router.post('/flows/:id', chatbotController.saveFlow);
router.delete('/flows/:id', chatbotController.deleteFlow);
router.patch('/flows/:id/status', chatbotController.toggleFlowStatus);

// Flow Variable routes (global variables)
router.get('/variables', flowVariableController.getFlowVariables);
router.post('/variables', flowVariableController.createFlowVariable);
router.put('/variables/:id', flowVariableController.updateFlowVariable);
router.delete('/variables/:id', flowVariableController.deleteFlowVariable);

export default router;

