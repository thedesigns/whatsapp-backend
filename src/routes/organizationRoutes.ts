import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { isSuperAdmin, isAdmin } from '../middleware/roleMiddleware.js';
import {
  createOrganization,
  getOrganizations,
  getOrganization,
  updateOrganization,
  deleteOrganization,
  getPlatformStats,
} from '../controllers/organizationController.js';

const router = Router();

// Routes for SUPER_ADMIN - Managing many organizations
router.post('/', authMiddleware, isSuperAdmin, createOrganization);
router.get('/', authMiddleware, isSuperAdmin, getOrganizations);
router.get('/stats/platform', authMiddleware, isSuperAdmin, getPlatformStats);
router.delete('/:id', authMiddleware, isSuperAdmin, deleteOrganization);

// Routes for Org ADMIN or SUPER_ADMIN - Managing specific organization
router.get('/:id', authMiddleware, isAdmin, getOrganization);
router.put('/:id', authMiddleware, isAdmin, updateOrganization);

export default router;
