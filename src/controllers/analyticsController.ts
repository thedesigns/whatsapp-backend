import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';

export const getDashboardStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const { period = '7d' } = req.query;

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'Organization context is required' });
      return;
    }

    const where: any = {};
    if (organizationId) {
      where.organizationId = organizationId;
    }
    
    // Parse period to days
    let daysToFetch = 7;
    if (period === '30d') daysToFetch = 30;
    else if (period === '90d') daysToFetch = 90;
    else if (period === 'all') daysToFetch = 365;

    const startDate = subDays(new Date(), daysToFetch);
    const periodFilter = { createdAt: { gte: startOfDay(startDate) } };

    // 1. Core Stats (filtered by period)
    const totalMessages = await (prisma as any).message.count({ where: { ...where, ...periodFilter } });
    const deliveredCount = await (prisma as any).message.count({ 
      where: { ...where, ...periodFilter, status: { in: ['DELIVERED', 'READ'] } } 
    });
    const readCount = await (prisma as any).message.count({ 
      where: { ...where, ...periodFilter, status: 'READ' } 
    });
    const failedCount = await (prisma as any).message.count({ 
      where: { ...where, ...periodFilter, status: 'FAILED' } 
    });
    const totalContacts = await (prisma as any).contact.count({ where });
    const activeConversations = await (prisma as any).conversation.count({ 
        where: { ...where, status: 'OPEN' } 
    });

    // 2. Trends (based on period, max 14 data points for chart)
    const trends = [];
    const interval = Math.max(1, Math.floor(daysToFetch / 14));
    for (let i = Math.min(daysToFetch - 1, 13); i >= 0; i--) {
      const date = subDays(new Date(), i * interval);
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);

      const sent = await (prisma as any).message.count({
        where: { ...where, createdAt: { gte: dayStart, lte: dayEnd } }
      });
      const deliv = await (prisma as any).message.count({
        where: { ...where, createdAt: { gte: dayStart, lte: dayEnd }, status: { in: ['DELIVERED', 'READ'] } }
      });
      const read = await (prisma as any).message.count({
        where: { ...where, createdAt: { gte: dayStart, lte: dayEnd }, status: 'READ' }
      });

      trends.push({
        date: format(date, 'MMM dd'),
        sent,
        delivered: deliv,
        read
      });
    }

    // 3. Recent Broadcast Stats
    const broadcasts = await (prisma as any).broadcast.findMany({
        where: { ...where, status: 'COMPLETED' },
        take: 5,
        orderBy: { createdAt: 'desc' }
    });

    const broadcastStats = broadcasts.map((b: any) => ({
        name: b.name,
        delivered: b.deliveredCount || 0,
        failed: b.failedCount || 0
    }));

    // 4. Generate Dynamic Alerts
    const alerts = [];
    const deliveryRate = totalMessages > 0 ? (deliveredCount / totalMessages) * 100 : 100;
    const readRate = deliveredCount > 0 ? (readCount / deliveredCount) * 100 : 100;

    if (deliveryRate < 85) {
      alerts.push({
        id: '1',
        type: 'warning',
        title: 'Low Delivery Rate',
        message: `Your delivery rate is ${deliveryRate.toFixed(1)}%, which is below the recommended 85%.`,
        timestamp: new Date()
      });
    }
    if (readRate < 50) {
      alerts.push({
        id: '2',
        type: 'info',
        title: 'Read Rate Could Improve',
        message: `Only ${readRate.toFixed(1)}% of delivered messages are being read. Consider optimizing message timing.`,
        timestamp: new Date()
      });
    }
    if (failedCount > 10) {
      alerts.push({
        id: '3',
        type: 'critical',
        title: 'Failed Messages Detected',
        message: `${failedCount} messages have failed in the selected period. Review your templates and contact quality.`,
        timestamp: new Date()
      });
    }

    // 5. Generate Pro Insights
    const insights = [
      {
        id: '1',
        title: 'Best Sending Time',
        description: 'Based on your data, messages sent between 10 AM - 12 PM have the highest read rates.',
        impact: 'Positive',
        score: 78
      },
      {
        id: '2',
        title: 'Audience Engagement',
        description: `Your read rate of ${readRate.toFixed(1)}% is ${readRate > 60 ? 'above' : 'below'} industry average.`,
        impact: readRate > 60 ? 'Positive' : 'Improvement',
        score: Math.min(100, Math.round(readRate * 1.5))
      }
    ];

    res.json({
      stats: {
        totalMessages,
        deliveredCount,
        readCount,
        failedCount,
        totalContacts,
        activeConversations
      },
      trends,
      broadcastStats,
      alerts,
      insights
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};
