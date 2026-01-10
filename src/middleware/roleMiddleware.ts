import { Response, NextFunction } from 'express';
import { AuthRequest } from './authMiddleware.js';

export const roleMiddleware = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied: insufficient permissions' });
      return;
    }

    next();
  };
};

export const isSuperAdmin = roleMiddleware(['SUPER_ADMIN']);
export const isAdmin = roleMiddleware(['SUPER_ADMIN', 'ADMIN']);
export const isSupervisor = roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR']);
export const isAgent = roleMiddleware(['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'AGENT']);
