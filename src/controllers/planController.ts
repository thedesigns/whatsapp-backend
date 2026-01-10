import { Request, Response } from 'express';
import { prisma } from '../config/database.js';

export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const plans = await (prisma as any).plan.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(plans);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  const { name, price, yearlyPrice, limits, isActive } = req.body;
  try {
    const plan = await (prisma as any).plan.create({
      data: {
        name,
        price: parseFloat(price),
        yearlyPrice: parseFloat(yearlyPrice || 0),
        limits: typeof limits === 'string' ? limits : JSON.stringify(limits),
        isActive: isActive !== undefined ? isActive : true
      }
    });
    res.json(plan);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updatePlan = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, price, yearlyPrice, limits, isActive } = req.body;
  try {
    const plan = await (prisma as any).plan.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(yearlyPrice !== undefined && { yearlyPrice: parseFloat(yearlyPrice) }),
        ...(limits && { limits: typeof limits === 'string' ? limits : JSON.stringify(limits) }),
        ...(isActive !== undefined && { isActive })
      }
    });
    res.json(plan);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deletePlan = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  try {
    // Check if any organization is using this plan
    const orgCount = await (prisma as any).organization.count({
      where: { subscriptionPlanId: id }
    });

    if (orgCount > 0) {
      res.status(400).json({ error: 'Cannot delete plan that is in use by organizations' });
      return;
    }

    await (prisma as any).plan.delete({
      where: { id }
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
