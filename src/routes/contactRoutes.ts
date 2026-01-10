import { Router } from 'express';
import { createContact, getContacts, getContactById, updateContact, deleteContact, bulkImport, getGroups, createGroup, updateGroup, deleteGroup } from '../controllers/contactController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// POST /api/contacts - Create a new contact
router.post('/', createContact);

// POST /api/contacts/bulk - Bulk import contacts
router.post('/bulk', bulkImport);

// Group Routes (MUST be before /:id to avoid matching 'groups' as an ID)
router.get('/groups', getGroups);
router.post('/groups', createGroup);
router.patch('/groups/:id', updateGroup);
router.delete('/groups/:id', deleteGroup);

// GET /api/contacts - Get all contacts
router.get('/', getContacts);

// GET /api/contacts/:id - Get contact by ID
router.get('/:id', getContactById);

// PATCH /api/contacts/:id - Update contact
router.patch('/:id', updateContact);

// DELETE /api/contacts/:id - Delete contact
router.delete('/:id', deleteContact);

export default router;
