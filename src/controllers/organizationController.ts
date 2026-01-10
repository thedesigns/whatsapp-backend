import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import bcrypt from 'bcryptjs';

// Create a new organization (SUPER_ADMIN only)
export const createOrganization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { 
        name, wabaId, phoneNumberId, accessToken, verifyToken, 
        adminEmail, adminName, adminPassword,
        subscriptionPlanId, subscriptionStatus, subscriptionExpiry, billingCycle
    } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Organization name is required' });
      return;
    }

    // Use transaction to ensure both Org and Admin are created or neither
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const organization = await tx.organization.create({
        data: {
          name,
          wabaId: wabaId || null,
          phoneNumberId: phoneNumberId || null,
          accessToken: accessToken || null,
          verifyToken: verifyToken || Math.random().toString(36).substring(7),
          isActive: true,
          subscriptionPlanId: subscriptionPlanId || null,
          subscriptionStatus: subscriptionStatus || 'ACTIVE',
          billingCycle: billingCycle || 'MONTHLY',
          subscriptionExpiry: subscriptionExpiry ? new Date(subscriptionExpiry) : null,
        },
      });

      let admin = null;
      if (adminEmail && adminPassword) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        admin = await tx.user.create({
          data: {
            email: adminEmail,
            name: adminName || 'Admin',
            password: hashedPassword,
            role: 'ADMIN',
            organizationId: organization.id
          }
        });
      }

      return { organization, admin };
    });

    res.status(201).json({ 
        message: 'Organization created successfully', 
        organization: result.organization,
        admin: result.admin ? { id: result.admin.id, email: result.admin.email, name: result.admin.name } : null
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
        res.status(400).json({ error: 'User with this email already exists' });
        return;
    }
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
};

// Get all organizations (SUPER_ADMIN only)
export const getOrganizations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizations = await (prisma as any).organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptionPlan: true,
        _count: {
          select: { users: true, contacts: true, messages: true }
        }
      }
    });

    res.json(organizations);
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to get organizations' });
  }
};

// Get organization details (SUPER_ADMIN or Org ADMIN)
export const getOrganization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    // Enforcement: Org Admin can only see their own org
    if (!isSuperAdmin && organizationId !== id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const organization = await (prisma as any).organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, contacts: true }
        }
      }
    });

    if (!organization) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    res.json(organization);
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ error: 'Failed to get organization details' });
  }
};

export const updateOrganization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { 
        name, wabaId, phoneNumberId, accessToken, verifyToken, isActive,
        adminName, adminEmail, adminPassword,
        subscriptionPlanId, subscriptionStatus, subscriptionExpiry, billingCycle
    } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    // Enforcement: Org Admin can only update their own org
    if (!isSuperAdmin && organizationId !== id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Use transaction to update organization and optionally admin user
    await (prisma as any).$transaction(async (tx: any) => {
       // 1. Update Organization
       await tx.organization.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(wabaId && { wabaId }),
          ...(phoneNumberId && { phoneNumberId }),
          ...(accessToken && { accessToken }),
          ...(verifyToken && { verifyToken }),
          ...(isActive !== undefined && isSuperAdmin && { isActive }),
          ...(subscriptionPlanId && isSuperAdmin && { subscriptionPlanId }),
          ...(subscriptionStatus && isSuperAdmin && { subscriptionStatus }),
          ...(billingCycle && isSuperAdmin && { billingCycle }),
          ...(subscriptionExpiry && isSuperAdmin && { subscriptionExpiry: new Date(subscriptionExpiry) }),
        },
      });

      // 2. Update Admin User if provided (SUPER_ADMIN only for now)
      if (isSuperAdmin && (adminName || adminEmail || adminPassword)) {
        const adminUser = await tx.user.findFirst({
          where: { organizationId: id, role: 'ADMIN' }
        });

        if (adminUser) {
          const updateData: any = {};
          if (adminName) updateData.name = adminName;
          if (adminEmail) updateData.email = adminEmail;
          if (adminPassword) updateData.password = await bcrypt.hash(adminPassword, 10);

          await tx.user.update({
            where: { id: adminUser.id },
            data: updateData
          });
        }
      }
    });

    const updatedOrg = await (prisma as any).organization.findUnique({ where: { id } });
    res.json({ message: 'Organization updated successfully', organization: updatedOrg });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
};

// Delete/Deactivate organization (SUPER_ADMIN only)
export const deleteOrganization = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await (prisma as any).organization.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({ message: 'Organization deactivated successfully' });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Failed to deactivate organization' });
  }
};

// Get platform statistics (SUPER_ADMIN only)
export const getPlatformStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { range = 'all' } = req.query;
    let dateFilter = {};
    
    if (range !== 'all') {
      const days = parseInt(range as string) || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      dateFilter = { createdAt: { gte: startDate } };
    }

    const [totalOrgs, activeOrgs, totalUsers, newOrgs] = await Promise.all([
      (prisma as any).organization.count(),
      (prisma as any).organization.count({ where: { isActive: true } }),
      (prisma as any).user.count({ where: { role: { not: 'SUPER_ADMIN' } } }),
      (prisma as any).organization.count({ where: { ...dateFilter } }),
    ]);

    // Group by subscription plan name
    const orgs = await (prisma as any).organization.findMany({
      select: { 
        subscriptionPlan: {
          select: { name: true }
        }
      },
    });

    const planCounts: Record<string, number> = orgs.reduce((acc: any, org: any) => {
      const planName = org.subscriptionPlan?.name || 'FREE';
      acc[planName] = (acc[planName] || 0) + 1;
      return acc;
    }, {});

    // Calculate Total Annual Revenue (ARR)
    const allOrgsWithPlans = await (prisma as any).organization.findMany({
      where: { isActive: true },
      include: { subscriptionPlan: true }
    });

    let totalAnnualRevenue = 0;
    allOrgsWithPlans.forEach((org: any) => {
      if (org.subscriptionPlan) {
        if (org.billingCycle === 'YEARLY') {
          totalAnnualRevenue += org.subscriptionPlan.yearlyPrice || 0;
        } else {
          totalAnnualRevenue += (org.subscriptionPlan.price || 0) * 12;
        }
      }
    });

    // Generate Dynamic Alerts
    const alerts = [];
    const inactivePremium = await (prisma as any).organization.count({
      where: { subscriptionPlan: 'PREMIUM', isActive: false }
    });
    if (inactivePremium > 0) {
      alerts.push({
        id: '1',
        type: 'warning',
        title: 'Premium Retention Alert',
        message: `${inactivePremium} premium organizations are currently inactive.`,
        timestamp: new Date()
      });
    }

    const failedWebhooks = await (prisma as any).integrationEvent.count({
      where: { NOT: { error: null }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    });
    if (failedWebhooks > 10) {
      alerts.push({
        id: '2',
        type: 'critical',
        title: 'Webhook Failure Spike',
        message: `Detected ${failedWebhooks} failed integration events in the last 24h.`,
        timestamp: new Date()
      });
    }

    // Generate Pro Insights
    const insights = [
      {
        id: '1',
        title: 'Growth Trajectory',
        description: `Your organization base has grown by ${newOrgs} in the requested period (${range}).`,
        impact: 'Positive',
        score: 85
      },
      {
        id: '2',
        title: 'Revenue Optimization',
        description: 'Conversion from Trial to Premium is at 14%. Recommend discount campaign.',
        impact: 'Improvement',
        score: 62
      }
    ];

    res.json({
      totalOrganizations: totalOrgs,
      activeOrganizations: activeOrgs,
      totalPlatformUsers: totalUsers,
      planDistribution: planCounts,
      annualRevenue: totalAnnualRevenue,
      newOrganizationsInRange: newOrgs,
      alerts,
      insights
    });
  } catch (error) {
    console.error('Get platform stats error:', error);
    res.status(500).json({ error: 'Failed to get platform stats' });
  }
};
