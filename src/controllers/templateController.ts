import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { getMetaTemplates, createMetaTemplate, deleteMetaTemplate } from '../services/whatsappService.js';
import { TemplateCategory, TemplateStatus } from '@prisma/client';

// Get all templates for an organization
export const getTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
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

    const templates = await (prisma as any).template.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Parse components string back to object for frontend
    const parsedTemplates = templates.map((t: any) => ({
      ...t,
      components: typeof t.components === 'string' ? JSON.parse(t.components) : t.components
    }));

    res.json(parsedTemplates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to get templates' });
  }
};

// Get single template in organization
export const getTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const template = await (prisma as any).template.findFirst({
      where,
    });

    if (!template) {
      res.status(404).json({ error: 'Template not found or access denied' });
      return;
    }

    // Parse components string
    const parsedTemplate = {
      ...template,
      components: typeof template.components === 'string' ? JSON.parse(template.components) : template.components
    };

    res.json(parsedTemplate);
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
};

// Create template in organization
export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    const { name, category, language, components, example, targetOrganizationId, allow_category_change } = req.body;

    console.log('📥 Template creation request received:');
    console.log('   Name:', name);
    console.log('   Category:', category);
    console.log('   Language:', language);

    // A Super Admin can specify an organizationId if they aren't tied to one
    const effectiveOrgId = organizationId || targetOrganizationId;

    if (!effectiveOrgId) {
      res.status(403).json({ error: 'Organization context is required for template creation' });
      return;
    }

    // Send to Meta
    const metaResult = await createMetaTemplate(effectiveOrgId, {
      name,
      category,
      language: language || 'en_US',
      components: typeof components === 'string' ? JSON.parse(components) : components,
      allow_category_change: allow_category_change === true
    });

    if (!metaResult.success) {
      const errorDetails = metaResult.error || 'Unknown Meta API error';
      console.error('Meta Template Creation Failed:', errorDetails);
      res.status(400).json({ 
        error: `Meta API Error: ${errorDetails}`,
        fullError: metaResult.details
      });
      return;
    }

    const template = await (prisma as any).template.create({
      data: {
        name,
        category: category.toUpperCase(), // Prisma enum expects uppercase
        language: language || 'en_US',
        components: typeof components === 'string' ? components : JSON.stringify(components),
        example: req.body.headerUrl || example, // Store the local public URL for UI display
        organizationId: effectiveOrgId,
        status: 'PENDING', // Templates need WhatsApp approval
      },
    });

    res.status(201).json({ message: 'Template created', template });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
};

// Update template in organization
export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const existing = await (prisma as any).template.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Template not found or access denied' });
        return;
    }

    const { name, category, language, components, example, isActive } = req.body;

    const template = await (prisma as any).template.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(category && { category }),
        ...(language && { language }),
        ...(components && { components }),
        ...(example && { example }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    res.json({ message: 'Template updated', template });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
};

// Delete template in organization
export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const existing = await (prisma as any).template.findFirst({
        where
    });

    if (!existing) {
        res.status(404).json({ error: 'Template not found or access denied' });
        return;
    }

    // Delete from Meta FIRST - fail if Meta delete fails
    const metaResult = await deleteMetaTemplate(existing.organizationId, existing.name);

    if (!metaResult.success) {
        console.error(`❌ Failed to delete template from Meta: ${metaResult.error}`);
        res.status(400).json({ 
          error: `Failed to delete from Meta: ${metaResult.error}`,
          hint: 'The template may already be deleted on Meta or there may be a permission issue.'
        });
        return;
    }

    console.log(`✅ Template deleted from Meta: ${existing.name}`);

    // Only delete from local DB if Meta delete succeeded
    await (prisma as any).template.delete({
      where: { id },
    });

    res.json({ message: 'Template deleted from Meta and local database' });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
};

// Sync templates from Meta Cloud API for current organization
export const syncTemplates = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';
    const { targetOrganizationId } = req.query;

    const effectiveOrgId = (organizationId || targetOrganizationId) as string;

    if (!effectiveOrgId) {
      res.status(403).json({ error: 'Organization context is required for synchronization' });
      return;
    }

    const result = await getMetaTemplates(effectiveOrgId);

    if (!result.success) {
      res.status(500).json({ error: result.error });
      return;
    }

    const metaTemplates = result.templates || [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const meta of metaTemplates) {
      // Map Meta category to Prisma enum
      let category: TemplateCategory = 'UTILITY';
      if (meta.category === 'MARKETING') category = 'MARKETING';
      else if (meta.category === 'AUTHENTICATION') category = 'AUTHENTICATION';

      // Map Meta status to Prisma enum
      let status: TemplateStatus = 'PENDING';
      if (meta.status === 'APPROVED') status = 'APPROVED';
      else if (meta.status === 'REJECTED') status = 'REJECTED';

      const existing = await (prisma as any).template.findFirst({
        where: { name: meta.name, organizationId: effectiveOrgId },
      });

      if (existing) {
        await (prisma as any).template.update({
          where: { id: existing.id },
          data: {
            category,
            language: meta.language,
            status,
            components: JSON.stringify(meta.components),
            isActive: meta.status === 'APPROVED',
          },
        });
        updatedCount++;
      } else {
        await (prisma as any).template.create({
          data: {
            name: meta.name,
            category,
            language: meta.language,
            status,
            components: JSON.stringify(meta.components),
            organizationId: effectiveOrgId,
            isActive: meta.status === 'APPROVED',
          },
        });
        createdCount++;
      }
    }

    res.json({ 
      message: 'Templates synced successfully', 
      stats: { created: createdCount, updated: updatedCount, total: metaTemplates.length }
    });
  } catch (error) {
    console.error('Sync templates error:', error);
    res.status(500).json({ error: 'Failed to sync templates' });
  }
};
