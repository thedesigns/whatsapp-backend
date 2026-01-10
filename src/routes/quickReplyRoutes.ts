import { Router } from 'express';
import * as quickReplyController from '../controllers/quickReplyController.js';
import { authMiddleware, authorize } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all quick replies
router.get('/', quickReplyController.getQuickReplies);

// Search quick replies
router.get('/search', quickReplyController.searchQuickReplies);

// Get by shortcut (for quick use)
router.get('/shortcut/:shortcut', quickReplyController.getQuickReplyByShortcut);

// Create quick reply (Admin only)
router.post('/', authorize('ADMIN', 'SUPERVISOR'), quickReplyController.createQuickReply);

// Update quick reply
router.put('/:id', authorize('ADMIN', 'SUPERVISOR'), quickReplyController.updateQuickReply);

// Delete quick reply
router.delete('/:id', authorize('ADMIN', 'SUPERVISOR'), quickReplyController.deleteQuickReply);

export default router;
