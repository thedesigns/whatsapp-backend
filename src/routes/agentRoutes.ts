import { Router } from 'express';
import * as agentController from '../controllers/agentController.js';
import { authMiddleware, authorize } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all agents (available to all authenticated users for assignment)
router.get('/', agentController.getAgents);

// Get single agent
router.get('/:id', authorize('ADMIN', 'SUPERVISOR'), agentController.getAgent);

// Get agent statistics
router.get('/:id/stats', authorize('ADMIN', 'SUPERVISOR'), agentController.getAgentStats);

// Create agent (Admin only)
router.post('/', authorize('ADMIN'), agentController.createAgent);

// Update agent
router.put('/:id', authorize('ADMIN'), agentController.updateAgent);

// Delete/deactivate agent
router.delete('/:id', authorize('ADMIN'), agentController.deleteAgent);

// Reset password (Admin only)
router.post('/:id/reset-password', authorize('ADMIN'), agentController.resetAgentPassword);

// Update push token for the current user
router.post('/push-token', agentController.updatePushToken);

export default router;
