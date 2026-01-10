import express from 'express';
import * as planController from '../controllers/planController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Plan routes - only SUPER_ADMIN should access these, but currently authMiddleware is sufficient for general admin access
// We should probably add a role check middleware here
router.get('/', authMiddleware, planController.getPlans);
router.post('/', authMiddleware, planController.createPlan);
router.put('/:id', authMiddleware, planController.updatePlan);
router.delete('/:id', authMiddleware, planController.deletePlan);

export default router;
