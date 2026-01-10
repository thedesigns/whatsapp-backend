import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string | null;
  };
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] as string;
    let token = '';

    // Handle API Key Authentication
    if (apiKey) {
      const org = await (prisma as any).organization.findUnique({
        where: { apiKey },
        select: { id: true, name: true }
      });

      if (!org) {
        res.status(401).json({ error: 'Invalid API Key' });
        return;
      }

      req.user = {
        id: `system-${org.id}`,
        email: `system@${org.id}`,
        name: `${org.name} System`,
        role: 'ADMIN',
        organizationId: org.id,
      };
      
      return next();
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token as string;
    }
    
    if (!token) {
      res.status(401).json({ error: 'No authentication token provided' });
      return;
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'default_secret'
    ) as { userId: string };

    const user = await (prisma as any).user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        organizationId: true,
      },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    // Check organization subscription status (Super Admins bypass)
    if (user.organizationId && user.role !== 'SUPER_ADMIN') {
      const org = await (prisma as any).organization.findUnique({
        where: { id: user.organizationId },
        select: { subscriptionStatus: true, subscriptionExpiry: true },
      });

      if (org?.subscriptionStatus === 'CLOSED') {
        res.status(403).json({ error: 'Your organization subscription is closed. Please contact support.' });
        return;
      }

      // Auto-close expired subscriptions
      if (org?.subscriptionExpiry && new Date(org.subscriptionExpiry) < new Date()) {
        await (prisma as any).organization.update({
          where: { id: user.organizationId },
          data: { subscriptionStatus: 'CLOSED' },
        });
        res.status(403).json({ error: 'Your subscription has expired. Please renew to continue.' });
        return;
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Role-based authorization middleware
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
};
