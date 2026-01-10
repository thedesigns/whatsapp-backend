import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/dashboard', analyticsController.getDashboardStats);

export default router;
