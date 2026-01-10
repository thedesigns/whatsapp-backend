import { Request, Response } from 'express';
import { prisma } from '../config/database.js';

export const getIntegrations = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  try {
    const integrations = await (prisma as any).integration.findMany({
      where: { organizationId: orgId }
    });
    res.json(integrations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const saveIntegration = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const { type, name, config, isActive } = req.body;

  try {
    const existing = await (prisma as any).integration.findFirst({
      where: { organizationId: orgId, type: type.toUpperCase() }
    });

    if (existing) {
      const updated = await (prisma as any).integration.update({
        where: { id: existing.id },
        data: {
          config: typeof config === 'string' ? config : JSON.stringify(config),
          isActive: isActive !== undefined ? isActive : existing.isActive,
          name: name || existing.name
        }
      });
      res.json(updated);
    } else {
      const created = await (prisma as any).integration.create({
        data: {
          organizationId: orgId,
          type: type.toUpperCase(),
          name: name || type,
          config: typeof config === 'string' ? config : JSON.stringify(config),
          isActive: isActive !== undefined ? isActive : true
        }
      });
      res.json(created);
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getIntegrationActivity = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const { limit = 50 } = req.query;

  try {
    const events = await (prisma as any).integrationEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: Number(limit)
    });
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getIntegrationStats = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  try {
    const [todayCount, totalSynced, failedCount] = await Promise.all([
      (prisma as any).integrationEvent.count({
        where: { 
          organizationId: orgId,
          createdAt: { gte: startOfDay }
        }
      }),
      (prisma as any).integrationEvent.count({
        where: { 
          organizationId: orgId,
          processed: true
        }
      }),
      (prisma as any).integrationEvent.count({
        where: { 
          organizationId: orgId,
          NOT: { error: null }
        }
      })
    ]);

    res.json({
      eventsToday: todayCount,
      totalSynced: totalSynced,
      failedSyncs: failedCount
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteIntegration = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    await (prisma as any).integration.delete({
      where: { id }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
