import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { broadcastService } from '../services/broadcastService.js';

/**
 * Get all broadcasts for the organization
 */
export const getBroadcasts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization ID is required' });
      return;
    }

    const broadcasts = await (prisma as any).broadcast.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    // Map fields for frontend expectations
    const mappedBroadcasts = (broadcasts || []).map((b: any) => ({
      ...b,
      successCount: b.deliveredCount || 0,
    }));

    res.json(mappedBroadcasts);
  } catch (error) {
    console.error('Get broadcasts error:', error);
    res.status(500).json({ error: 'Failed to get broadcasts' });
  }
};

/**
 * Get a single broadcast with report data
 */
export const getBroadcastReport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    const broadcast = await (prisma as any).broadcast.findFirst({
      where: { id, organizationId },
      include: {
        recipients: {
          orderBy: { contactName: 'asc' }
        }
      },
    });

    if (!broadcast) {
      res.status(404).json({ error: 'Broadcast not found' });
      return;
    }

    res.json(broadcast);
  } catch (error) {
    console.error('Get broadcast report error:', error);
    res.status(500).json({ error: 'Failed to get broadcast report' });
  }
};

/**
 * Create and start a new broadcast
 */
export const createBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const { name, templateName, templateLanguage, recipients, mediaId, mediaType, scheduledAt } = req.body;
    
    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: 'Recipients list is required' });
      return;
    }

    // Determine initial status based on scheduling
    const now = new Date();
    const scheduleDate = scheduledAt ? new Date(scheduledAt) : null;
    
    console.log(`🕒 Scheduling Debug:`);
    console.log(`- Current Server Time (now): ${now.toISOString()}`);
    console.log(`- Raw scheduledAt from Req: ${scheduledAt}`);
    console.log(`- Parsed scheduleDate: ${scheduleDate ? scheduleDate.toISOString() : 'none'}`);

    // Use a 30-second grace period to handle small clock drifts/latency
    const isScheduledForFuture = scheduleDate && (scheduleDate.getTime() > now.getTime() + 30000);
    const initialStatus = isScheduledForFuture ? 'SCHEDULED' : 'PENDING';
    
    console.log(`- isScheduledForFuture: ${isScheduledForFuture}`);
    console.log(`- initialStatus: ${initialStatus}`);

    // 1. Create Broadcast record
    const broadcast = await (prisma as any).broadcast.create({
      data: {
        name,
        templateName,
        templateLanguage: templateLanguage || 'en',
        totalRecipients: recipients.length,
        organizationId,
        status: initialStatus,
        scheduledAt: scheduleDate,
        mediaId,
        mediaType,
        enableChatbot: req.body.enableChatbot !== undefined ? req.body.enableChatbot : true,
      },
    });

    // 2. Create Recipient records
    await (prisma as any).broadcastRecipient.createMany({
      data: recipients.map((r: any) => ({
        broadcastId: broadcast.id,
        phoneNumber: r.phoneNumber,
        contactName: r.name || null,
        variables: r.variables ? JSON.stringify(r.variables) : null,
        status: 'PENDING',
      })),
    });

    // 3. Trigger sending in background only if NOT scheduled for future
    if (!isScheduledForFuture) {
      console.log(`🚀 Triggering immediate broadcast for ${broadcast.id}`);
      broadcastService.startBroadcast(broadcast.id).catch(err => {
        console.error(`🔥 Background broadcast failure for ${broadcast.id}:`, err);
      });
    } else {
      console.log(`⏰ Broadcast ${broadcast.id} will be handled by scheduler at ${scheduleDate}`);
    }

    res.status(201).json({
      message: isScheduledForFuture 
        ? `Broadcast scheduled for ${scheduleDate?.toLocaleString()}` 
        : 'Broadcast started successfully',
      broadcastId: broadcast.id,
      status: initialStatus,
      totalRecipients: recipients.length
    });

  } catch (error) {
    console.error('Create broadcast error:', error);
    res.status(500).json({ error: 'Failed to create broadcast' });
  }
};

/**
 * Delete a broadcast and its recipients
 */
export const deleteBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Delete broadcast request for ID: ${id}`);
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    // Verify broadcast belongs to this organization
    const broadcast = await (prisma as any).broadcast.findFirst({
      where: { id, organizationId }
    });

    if (!broadcast) {
      res.status(404).json({ error: 'Broadcast not found' });
      return;
    }

    // Delete recipients first (cascade)
    await (prisma as any).broadcastRecipient.deleteMany({
      where: { broadcastId: id }
    });

    // Delete the broadcast
    await (prisma as any).broadcast.delete({
      where: { id }
    });

    res.json({ message: 'Broadcast deleted successfully' });
  } catch (error) {
    console.error('Delete broadcast error:', error);
    res.status(500).json({ error: 'Failed to delete broadcast' });
  }
};
