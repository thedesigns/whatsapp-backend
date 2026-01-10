import { Router } from 'express';
import * as conversationController from '../controllers/conversationController.js';
import { authMiddleware, authorize } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/conversations - Create a new conversation
router.post('/', conversationController.createConversation);

// Get conversations
router.get('/', conversationController.getConversations);

// Get conversation statistics
router.get('/stats', conversationController.getStats);

// Get broadcast labels for filter dropdown
router.get('/broadcast-labels', conversationController.getBroadcastLabels);

// Export inbox to CSV
router.get('/export-csv', conversationController.exportInboxCSV);

// Get single conversation
router.get('/:id', conversationController.getConversation);

// Assign conversation
router.post('/:id/assign', conversationController.assignConversation);

// Transfer conversation
router.post('/:id/transfer', authorize('ADMIN', 'SUPERVISOR', 'AGENT'), conversationController.transferConversation);

// Update status
router.patch('/:id/status', conversationController.updateConversationStatus);

// Notes
router.post('/:id/notes', conversationController.addNote);

// Tags
router.patch('/:id/tags', conversationController.updateTags);

export default router;
