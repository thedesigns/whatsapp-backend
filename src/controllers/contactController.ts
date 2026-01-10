import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { Prisma } from '@prisma/client';

// Create a new contact
export const createContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phoneNumber, name } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!phoneNumber) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    // Clean phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // If we have an organizationId, check for existing in that org
    if (organizationId) {
      let contact = await (prisma as any).contact.findUnique({
        where: {
          waId_organizationId: {
            waId: cleanPhone,
            organizationId
          }
        },
      });

      if (contact) {
        // Update name if provided
        if (name && !contact.name) {
          contact = await (prisma as any).contact.update({
            where: { id: contact.id },
            data: { name },
          });
        }
        res.json(contact);
        return;
      }
    }

    if (!organizationId) {
        res.status(400).json({ error: 'Organization context is required for contact creation' });
        return;
    }

    // Create new contact
    const contact = await (prisma as any).contact.create({
      data: {
        phoneNumber: cleanPhone,
        waId: cleanPhone,
        name: name || undefined,
        organizationId,
        tags: '[]'
      },
    });

    res.status(201).json(contact);
  } catch (error) {
    console.error('Create contact error:', error);
    res.status(500).json({ error: 'Failed to create contact' });
  }
};

// Get all contacts in organization
export const getContacts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, page = 1, limit = 20, groupId, groupIds } = req.query;
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

    if (search) {
      where.OR = [
        { name: { contains: search as string } },
        { phoneNumber: { contains: search as string } },
        { profileName: { contains: search as string } },
      ];
    }

    if (groupId) {
      where.groups = {
        some: { id: groupId as string }
      };
    } else if (groupIds) {
      const gIds = Array.isArray(groupIds) ? groupIds : [groupIds];
      where.groups = {
        some: { id: { in: gIds as string[] } }
      };
    }

    const contacts = await (prisma as any).contact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Number(limit),
      skip: (Number(page) - 1) * Number(limit),
    });

    const total = await (prisma as any).contact.count({ where });

    // Map labels from tags field (stored as JSON string)
    const mappedContacts = contacts.map((c: any) => ({
      ...c,
      labels: JSON.parse(c.tags || '[]')
    }));

    res.json({
      contacts: mappedContacts,
      total,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get contacts error:', error);
    res.status(500).json({ error: 'Failed to get contacts' });
  }
};

// Get contact by ID in organization
export const getContactById = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const contact = await (prisma as any).contact.findFirst({
      where,
      include: {
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!contact) {
      res.status(404).json({ error: 'Contact not found or access denied' });
      return;
    }

    res.json({
      ...contact,
      labels: JSON.parse(contact.tags || '[]')
    });
  } catch (error) {
    console.error('Get contact error:', error);
    res.status(500).json({ error: 'Failed to get contact' });
  }
};

// Update contact in organization
export const updateContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, email, avatar, labels, metadata } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'Organization context required' });
        return;
    }

    const contact = await (prisma as any).contact.update({
      where: { id, organizationId },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(avatar !== undefined && { avatar }),
        ...(labels !== undefined && { tags: JSON.stringify(labels) }),
        ...(metadata !== undefined && { metadata }),
      },
    });

    res.json(contact);
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ error: 'Failed to update contact' });
  }
};

// Delete contact in organization
export const deleteContact = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'Organization context required' });
        return;
    }

    await (prisma as any).contact.delete({
      where: { id, organizationId }
    });

    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
};

// Bulk import contacts
export const bulkImport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { contacts, groupId } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'Organization context required' });
        return;
    }

    if (!Array.isArray(contacts)) {
        res.status(400).json({ error: 'Contacts array is required' });
        return;
    }

    // Optional: Pre-verify groupId belongs to this organization if provided
    if (groupId) {
      const groupExists = await (prisma as any).contactGroup.findFirst({
        where: { id: groupId, organizationId }
      });
      if (!groupExists) {
        res.status(400).json({ error: 'Invalid group ID' });
        return;
      }
    }

    const operations = contacts.map((c: any) => {
      const cleanPhone = c.phoneNumber.replace(/\D/g, '');
      return (prisma as any).contact.upsert({
        where: {
          waId_organizationId: {
            waId: cleanPhone,
            organizationId
          }
        },
        update: {
          name: c.name || undefined,
          ...(groupId && {
            groups: {
              connect: { id: groupId }
            }
          })
        },
        create: {
          phoneNumber: cleanPhone,
          waId: cleanPhone,
          name: c.name || undefined,
          organizationId,
          tags: '[]',
          ...(groupId && {
            groups: {
              connect: { id: groupId }
            }
          })
        }
      });
    });

    await prisma.$transaction(operations);

    res.json({ message: `Successfully imported ${contacts.length} contacts` });
  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ error: 'Failed to import contacts' });
  }
};

// --- Contact Group Controllers ---

// Get all groups
export const getGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    const groups = await (prisma as any).contactGroup.findMany({
      where: { organizationId },
      include: {
        _count: {
          select: { contacts: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(groups);
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ error: 'Failed to get contact groups' });
  }
};

// Create a group
export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    if (!name) {
      res.status(400).json({ error: 'Group name is required' });
      return;
    }

    const group = await (prisma as any).contactGroup.create({
      data: {
        name,
        description,
        organizationId
      }
    });

    res.status(201).json(group);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'A group with this name already exists' });
      return;
    }
    console.error('Create group error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

// Update group
export const updateGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    const group = await (prisma as any).contactGroup.update({
      where: { id, organizationId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
      }
    });

    res.json(group);
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

// Delete group
export const deleteGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    await (prisma as any).contactGroup.delete({
      where: { id, organizationId }
    });

    res.json({ message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
};
