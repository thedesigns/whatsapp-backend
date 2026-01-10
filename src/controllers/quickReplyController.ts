import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

// Get all quick replies for an organization
export const getQuickReplies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { isActive: true };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const quickReplies = await (prisma as any).quickReply.findMany({
      where,
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });

    res.json(quickReplies);
  } catch (error) {
    console.error('Get quick replies error:', error);
    res.status(500).json({ error: 'Failed to get quick replies' });
  }
};

// Get quick reply by shortcut in organization
export const getQuickReplyByShortcut = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { shortcut } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { shortcut, isActive: true };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const quickReply = await (prisma as any).quickReply.findFirst({
      where,
    });

    if (!quickReply) {
      res.status(404).json({ error: 'Quick reply not found or access denied' });
      return;
    }

    // Increment usage count
    await (prisma as any).quickReply.update({
      where: { id: quickReply.id },
      data: { usageCount: { increment: 1 } },
    });

    res.json(quickReply);
  } catch (error) {
    console.error('Get quick reply error:', error);
    res.status(500).json({ error: 'Failed to get quick reply' });
  }
};

// Create quick reply in organization
export const createQuickReply = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, shortcut, content, category, targetOrganizationId } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    const effectiveOrgId = organizationId || targetOrganizationId;

    if (!effectiveOrgId) {
      res.status(403).json({ error: 'Organization context is required for quick reply creation' });
      return;
    }

    // Ensure shortcut starts with /
    const formattedShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;

    const quickReply = await (prisma as any).quickReply.create({
      data: {
        title,
        shortcut: formattedShortcut,
        content,
        category,
        organizationId: effectiveOrgId,
      },
    });

    res.status(201).json({ message: 'Quick reply created', quickReply });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Shortcut already exists in your organization' });
      return;
    }
    console.error('Create quick reply error:', error);
    res.status(500).json({ error: 'Failed to create quick reply' });
  }
};

// Update quick reply in organization
export const updateQuickReply = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, shortcut, content, category, isActive } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).quickReply.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Quick reply not found or access denied' });
        return;
    }

    const quickReply = await (prisma as any).quickReply.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(shortcut && { shortcut: shortcut.startsWith('/') ? shortcut : `/${shortcut}` }),
        ...(content && { content }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ message: 'Quick reply updated', quickReply });
  } catch (error) {
    console.error('Update quick reply error:', error);
    res.status(500).json({ error: 'Failed to update quick reply' });
  }
};

// Delete quick reply in organization
export const deleteQuickReply = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).quickReply.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Quick reply not found or access denied' });
        return;
    }

    await (prisma as any).quickReply.delete({
      where: { id },
    });

    res.json({ message: 'Quick reply deleted' });
  } catch (error) {
    console.error('Delete quick reply error:', error);
    res.status(500).json({ error: 'Failed to delete quick reply' });
  }
};

// Search quick replies in organization
export const searchQuickReplies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { q } = req.query;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!q) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const where: any = {
      isActive: true,
      OR: [
        { title: { contains: q as string } },
        { shortcut: { contains: q as string } },
        { content: { contains: q as string } },
      ],
    };

    if (organizationId) {
        where.organizationId = organizationId;
    }

    const quickReplies = await (prisma as any).quickReply.findMany({
      where,
    });

    res.json(quickReplies);
  } catch (error) {
    console.error('Search quick replies error:', error);
    res.status(500).json({ error: 'Failed to search quick replies' });
  }
};
