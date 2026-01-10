import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { ConversationStatus } from '@prisma/client';
import { emitToAll, emitToUser } from '../services/socketService.js';

// Create a new conversation
export const createConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contactId, assignToMe } = req.body;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!contactId) {
      res.status(400).json({ error: 'Contact ID is required' });
      return;
    }

    // Check if contact exists and belongs to organization
    const contact = await (prisma as any).contact.findFirst({
      where: { id: contactId, organizationId },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found or access denied' });
      return;
    }

    // Check if there's an existing open conversation
    let conversation = await (prisma as any).conversation.findFirst({
      where: {
        contactId,
        organizationId,
        status: { in: ['OPEN', 'PENDING'] },
      },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (conversation) {
      // Return existing conversation
      res.json({ conversation, existing: true });
      return;
    }

    // Create new conversation
    conversation = await (prisma as any).conversation.create({
      data: {
        contactId,
        organizationId,
        status: 'OPEN',
        assignedAgentId: assignToMe ? userId : undefined,
      },
      include: {
        contact: true,
        assignedAgent: { select: { id: true, name: true, avatar: true } },
      },
    });

    res.status(201).json({ conversation, existing: false });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

// Get all conversations for the current agent/organization
export const getConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, assigned, page = 1, limit = 20, broadcastId } = req.query;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPERVISOR' || isSuperAdmin;

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by broadcast (badge-wise filter)
    if (broadcastId) {
      where.broadcastId = broadcastId as string;
    }

    // Filter by assignment within organization
    if (isAdmin) {
      if (assigned === 'me') {
        // For Admins/Supervisors, "My Chats" shows all conversations assigned to ANY agent in their org
        where.assignedAgentId = { not: null };
      } else if (assigned === 'unassigned') {
        where.assignedAgentId = null;
      }
    } else {
      // NON-ADMINS (Agents) strictly see ONLY their assigned conversations in their org
      where.assignedAgentId = userId;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [conversations, total] = await Promise.all([
      (prisma as any).conversation.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              profileName: true,
              phoneNumber: true,
              avatar: true,
            },
          },
          assignedAgent: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
          broadcast: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      (prisma as any).conversation.count({ where }),
    ]);

    res.json({
      conversations,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
};

// Get single conversation
export const getConversation = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const conversation = await (prisma as any).conversation.findFirst({
      where,
      include: {
        contact: true,
        assignedAgent: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            status: true,
          },
        },
        notes: {
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    res.json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

// Assign conversation to agent
export const assignConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { agentId } = req.body;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify conversation exists
    const convWhere: any = { id };
    if (organizationId) {
      convWhere.organizationId = organizationId;
    }

    const existing = await (prisma as any).conversation.findFirst({
      where: convWhere
    });

    if (!existing) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    // If no agentId provided, assign to current user
    const assignToId = agentId || userId;

    const conversation = await (prisma as any).conversation.update({
      where: { id },
      data: {
        assignedAgentId: assignToId,
        status: ConversationStatus.OPEN,
      },
      include: {
        contact: true,
        assignedAgent: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Emit real-time event
    emitToAll('conversation_assigned', {
      conversationId: id,
      agentId: assignToId,
      agentName: conversation.assignedAgent?.name,
    });

    emitToUser(assignToId, 'new_assignment', { conversation });

    res.json({ message: 'Conversation assigned', conversation });
  } catch (error) {
    console.error('Assign conversation error:', error);
    res.status(500).json({ error: 'Failed to assign conversation' });
  }
};

// Transfer conversation to another agent
export const transferConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { toAgentId, note } = req.body;
    const fromUserId = req.user!.id;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Verify conversation and target agent exist in same org
    const conversationCheck = await (prisma as any).conversation.findFirst({
      where: { id, organizationId }
    });

    if (!conversationCheck) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    const targetAgent = await (prisma as any).user.findFirst({
      where: { id: toAgentId, organizationId, isActive: true },
      select: { id: true, name: true, isActive: true },
    });

    if (!targetAgent) {
      res.status(400).json({ error: 'Target agent not found in your organization or inactive' });
      return;
    }

    // Update conversation
    const conversation = await (prisma as any).conversation.update({
      where: { id },
      data: { assignedAgentId: toAgentId },
      include: {
        contact: true,
        assignedAgent: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Add transfer note if provided
    if (note) {
      await (prisma as any).conversationNote.create({
        data: {
          conversationId: id,
          userId: fromUserId,
          content: `Transferred to ${targetAgent.name}: ${note}`,
        },
      });
    }

    // Emit real-time events
    emitToUser(fromUserId, 'conversation_transferred_out', { conversationId: id });
    emitToUser(toAgentId, 'conversation_transferred_in', { conversation });
    emitToAll('conversation_transferred', {
      conversationId: id,
      fromAgentId: fromUserId,
      toAgentId,
    });

    res.json({ message: 'Conversation transferred', conversation });
  } catch (error) {
    console.error('Transfer conversation error:', error);
    res.status(500).json({ error: 'Failed to transfer conversation' });
  }
};

// Update conversation status
export const updateConversationStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const validStatuses = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    // Verify it belongs to organization
    const check = await (prisma as any).conversation.findFirst({
      where: { id, organizationId }
    });

    if (!check) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    const updateData: any = { status };
    if (status === 'RESOLVED') {
      updateData.isResolved = true;
      updateData.resolvedAt = new Date();
    }

    const conversation = await (prisma as any).conversation.update({
      where: { id },
      data: updateData,
      include: {
        contact: true,
        assignedAgent: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    emitToAll('conversation_status_changed', {
      conversationId: id,
      status,
    });

    res.json({ message: 'Status updated', conversation });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

// Add note to conversation
export const addNote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'User not associated with an organization' });
        return;
    }

    // Verify conversation in org
    const check = await (prisma as any).conversation.findFirst({
        where: { id, organizationId }
    });

    if (!check) {
        res.status(404).json({ error: 'Conversation not found or access denied' });
        return;
    }

    const note = await (prisma as any).conversationNote.create({
      data: {
        conversationId: id,
        userId,
        content,
      },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });

    res.status(201).json(note);
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
};

// Add/remove tags
export const updateTags = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { tags } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'User not associated with an organization' });
        return;
    }

    const conversation = await (prisma as any).conversation.update({
      where: { id, organizationId },
      data: { tags },
    });

    res.json({ message: 'Tags updated', conversation });
  } catch (error) {
    console.error('Update tags error:', error);
    res.status(500).json({ error: 'Failed to update tags' });
  }
};

// Get conversation statistics
export const getStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const userId = req.user!.id;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const isAdmin = req.user!.role === 'ADMIN' || req.user!.role === 'SUPERVISOR' || isSuperAdmin;

    if (!organizationId && !isSuperAdmin) {
        res.status(403).json({ error: 'User not associated with an organization' });
        return;
    }

    const baseWhere: any = {};
    if (organizationId) {
        baseWhere.organizationId = organizationId;
    }

    if (!isAdmin) {
        baseWhere.assignedAgentId = userId;
    }

    const [total, open, pending, resolved, unassigned] = await Promise.all([
      (prisma as any).conversation.count({ where: baseWhere }),
      (prisma as any).conversation.count({ where: { ...baseWhere, status: 'OPEN' } }),
      (prisma as any).conversation.count({ where: { ...baseWhere, status: 'PENDING' } }),
      (prisma as any).conversation.count({ where: { ...baseWhere, status: 'RESOLVED' } }),
      (prisma as any).conversation.count({ where: { ...baseWhere, assignedAgentId: null, status: { in: ['OPEN', 'PENDING'] } } }),
    ]);

    res.json({
      total,
      open,
      pending,
      resolved,
      unassigned: isAdmin ? unassigned : undefined,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
};

// Get unique broadcast labels for filter dropdown
export const getBroadcastLabels = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Get all broadcasts that have conversations linked to them
    const broadcasts = await (prisma as any).broadcast.findMany({
      where: {
        organizationId,
        conversations: { some: {} }
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: { conversations: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Format for dropdown with count
    const labels = broadcasts.map((b: any) => ({
      id: b.id,
      name: b.name,
      conversationCount: b._count.conversations
    }));

    res.json(labels);
  } catch (error) {
    console.error('Get broadcast labels error:', error);
    res.status(500).json({ error: 'Failed to get broadcast labels' });
  }
};

// Export inbox conversations to CSV
export const exportInboxCSV = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { broadcastId } = req.query;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { organizationId };
    if (broadcastId) {
      where.broadcastId = broadcastId as string;
    }

    const conversations = await (prisma as any).conversation.findMany({
      where,
      include: {
        contact: {
          select: {
            name: true,
            phoneNumber: true,
            profileName: true,
          },
        },
        broadcast: {
          select: {
            name: true,
          },
        },
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    // Generate CSV content
    const headers = [
      'Contact Name',
      'Phone Number',
      'Broadcast Name',
      'Is Reply',
      'Unread Count',
      'Message Count',
      'Last Message',
      'Status',
      'Last Updated'
    ].join(',');

    const rows = conversations.map((conv: any) => [
      `"${(conv.contact?.name || conv.contact?.profileName || 'Unknown').replace(/"/g, '""')}"`,
      `"${conv.contact?.phoneNumber || ''}"`,
      `"${conv.broadcast?.name || 'N/A'}"`,
      conv.isReply ? 'Yes' : 'No',
      conv.unreadCount || 0,
      conv._count?.messages || 0,
      `"${(conv.lastMessagePreview || '').replace(/"/g, '""').substring(0, 100)}"`,
      conv.status,
      conv.lastMessageAt ? new Date(conv.lastMessageAt).toISOString() : ''
    ].join(','));

    const csvContent = [headers, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inbox-export-${Date.now()}.csv"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Export inbox CSV error:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
};
