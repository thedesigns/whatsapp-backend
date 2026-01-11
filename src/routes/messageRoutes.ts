import { Router } from 'express';
import * as messageController from '../controllers/messageController.js';
import { authMiddleware, authorize } from '../middleware/authMiddleware.js';
import multer from 'multer';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// All routes require authentication
router.use(authMiddleware);

// Search messages
router.get('/search', messageController.searchMessages);

// Get media file (Proxy)
router.get('/media/:mediaId', messageController.proxyMedia);

// Upload media to Meta (returns media ID for templates)
router.post('/upload-media', upload.single('file'), messageController.uploadMedia);

// Get messages for a conversation
router.get('/:conversationId', messageController.getMessages);

// Send a message
router.post('/:conversationId', messageController.sendMessage);

// Send media message
router.post('/:conversationId/media', upload.single('file'), messageController.sendMediaMessage);

// Send template message
router.post('/:conversationId/template', messageController.sendTemplate);

// Mark messages as read
router.post('/:conversationId/read', messageController.markAsRead);

// Delete message (Admin only)
router.delete('/:id', authorize('ADMIN'), messageController.deleteMessage);

export default router;
