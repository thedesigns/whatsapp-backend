import { Router } from 'express';
import * as templateController from '../controllers/templateController.js';
import { authMiddleware, authorize } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all templates
router.get('/', templateController.getTemplates);

// Sync templates from Meta (Admin only)
router.post('/sync', authorize('ADMIN'), templateController.syncTemplates);

// Get single template
router.get('/:id', templateController.getTemplate);

// Create template (Admin only)
router.post('/', authorize('ADMIN'), templateController.createTemplate);

// Update template
router.put('/:id', authorize('ADMIN'), templateController.updateTemplate);

// Delete template
router.delete('/:id', authorize('ADMIN'), templateController.deleteTemplate);

export default router;
