import { Router } from 'express';
import * as broadcastController from '../controllers/broadcastController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get list of broadcasts
router.get('/', broadcastController.getBroadcasts);

// Get detailed report for a specific broadcast
router.get('/:id/report', broadcastController.getBroadcastReport);

// Create and start a new broadcast
router.post('/', broadcastController.createBroadcast);

// Delete a broadcast
router.delete('/:id', broadcastController.deleteBroadcast);

export default router;
