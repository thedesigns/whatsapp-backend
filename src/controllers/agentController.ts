import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { getOnlineUsers } from '../services/socketService.js';

// Get all agents in the current organization (Admin/Supervisor only)
export const getAgents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, role } = req.query;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }
    if (status) where.status = status;
    if (role) where.role = role;

    const agents = await (prisma as any).user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        status: true,
        isActive: true,
        lastSeen: true,
        createdAt: true,
        _count: {
          select: {
            conversations: {
              where: { status: { in: ['OPEN', 'PENDING'] } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Add online status from socket
    const onlineUserIds = getOnlineUsers();
    const agentsWithOnlineStatus = agents.map((agent: any) => ({
      ...agent,
      isOnline: onlineUserIds.includes(agent.id),
      activeConversations: agent._count?.conversations || 0,
    }));

    res.json(agentsWithOnlineStatus);
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({ error: 'Failed to get agents' });
  }
};

// Get single agent in organization
export const getAgent = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const agent = await (prisma as any).user.findFirst({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        status: true,
        isActive: true,
        lastSeen: true,
        createdAt: true,
        _count: {
          select: {
            conversations: true,
            messages: true,
          },
        },
      },
    });

    if (!agent) {
      res.status(404).json({ error: 'Agent not found or access denied' });
      return;
    }

    res.json(agent);
  } catch (error) {
    console.error('Get agent error:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
};

// Create new agent in organization (Admin only)
export const createAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, name, role = 'AGENT' } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Check if user exists (emails should be unique globally)
    const existingUser = await (prisma as any).user.findUnique({
      where: { email },
    });

    if (existingUser) {
      res.status(400).json({ error: 'Email already in use' });
      return;
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const agent = await (prisma as any).user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        organizationId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json({ message: 'Agent created', agent });
  } catch (error) {
    console.error('Create agent error:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
};

// Update agent in organization
export const updateAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, role, isActive, avatar } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify ownership
    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).user.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Agent not found or access denied' });
        return;
    }

    const updateData: any = {
      ...(name && { name }),
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(avatar && { avatar }),
    };

    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(req.body.password, salt);
    }

    const agent = await (prisma as any).user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        status: true,
        isActive: true,
      },
    });

    res.json({ message: 'Agent updated', agent });
  } catch (error) {
    console.error('Update agent error:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
};

// Delete/deactivate agent in organization
export const deleteAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify ownership
    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).user.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Agent not found or access denied' });
        return;
    }

    // Soft delete - just deactivate
    await (prisma as any).user.update({
      where: { id },
      data: { isActive: false },
    });

    // Unassign all conversations belonging to this org that were assigned to this agent
    const unassignWhere: any = { assignedAgentId: id };
    if (organizationId) {
      unassignWhere.organizationId = organizationId;
    }

    await (prisma as any).conversation.updateMany({
      where: unassignWhere,
      data: { assignedAgentId: null },
    });

    res.json({ message: 'Agent deactivated' });
  } catch (error) {
    console.error('Delete agent error:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
};

// Reset agent password in organization (Admin only)
export const resetAgentPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify ownership
    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).user.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Agent not found or access denied' });
        return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await (prisma as any).user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

// Get agent statistics in organization
export const getAgentStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify ownership
    const where: any = { id };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const existing = await (prisma as any).user.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Agent not found or access denied' });
        return;
    }

    const dateFilter: any = {};
    if (startDate) dateFilter.gte = new Date(startDate as string);
    if (endDate) dateFilter.lte = new Date(endDate as string);

    const [
      totalConversations,
      resolvedConversations,
      totalMessages,
      avgResponseTime,
    ] = await Promise.all([
      (prisma as any).conversation.count({
        where: {
          assignedAgentId: id,
          ...(organizationId && { organizationId }),
          ...(startDate && { createdAt: dateFilter }),
        },
      }),
      (prisma as any).conversation.count({
        where: {
          assignedAgentId: id,
          ...(organizationId && { organizationId }),
          isResolved: true,
          ...(startDate && { resolvedAt: dateFilter }),
        },
      }),
      (prisma as any).message.count({
        where: {
          senderId: id,
          ...(organizationId && { organizationId }),
          direction: 'OUTGOING',
          ...(startDate && { createdAt: dateFilter }),
        },
      }),
      // Average response time calculation would be more complex
      Promise.resolve(0),
    ]);

    res.json({
      totalConversations,
      resolvedConversations,
      totalMessages,
      resolutionRate: totalConversations > 0 
        ? ((resolvedConversations / totalConversations) * 100).toFixed(1) 
        : 0,
    });
  } catch (error) {
    console.error('Get agent stats error:', error);
    res.status(500).json({ error: 'Failed to get agent stats' });
  }
};

// Update push token for the current user
export const updatePushToken = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pushToken } = req.body;
    const userId = req.user?.id;

    console.log(`📱 Received push token update request for user: ${userId}, token: ${pushToken?.substring(0, 10)}...`);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    await (prisma as any).user.update({
      where: { id: userId },
      data: { pushToken },
    });

    console.log(`✅ Push token updated for user: ${userId}`);
    res.json({ message: 'Push token updated' });
  } catch (error) {
    console.error('❌ Update push token error:', error);
    res.status(500).json({ error: 'Failed to update push token' });
  }
};

// Test push notification for the current user
export const testPushNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { pushToken: true }
    });

    if (!user?.pushToken) {
      res.status(400).json({ error: 'User does not have a push token registered' });
      return;
    }

    const { sendPushNotification } = await import('../services/notificationService.js');
    
    console.log(`🧪 Sending test push notification to user: ${userId}, token: ${user.pushToken}`);
    
    await sendPushNotification(
      user.pushToken,
      'Test Notification',
      'If you see this, push notifications are working! ✅',
      { test: true }
    );

    res.json({ message: 'Test notification sent' });
  } catch (error) {
    console.error('❌ Test push notification error:', error);
    res.status(500).json({ error: 'Failed to send test push notification' });
  }
};
