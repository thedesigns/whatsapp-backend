import { Request, Response } from 'express';
import { prisma } from '../config/database';

interface AuthRequest extends Request {
  user?: {
    id: string;
    organizationId?: string;
    role?: string;
  };
}

// Get all flow variables for the organization
export const getFlowVariables = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization not found' });
      return;
    }

    const variables = await (prisma as any).flowVariable.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });

    res.json(variables);
  } catch (error) {
    console.error('Error fetching flow variables:', error);
    res.status(500).json({ error: 'Failed to fetch variables' });
  }
};

// Create a new flow variable
export const createFlowVariable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization not found' });
      return;
    }

    const { name, value, description } = req.body;

    if (!name || !value) {
      res.status(400).json({ error: 'Name and value are required' });
      return;
    }

    // Validate variable name (alphanumeric and underscores only)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      res.status(400).json({ error: 'Variable name must start with a letter or underscore, and contain only letters, numbers, and underscores' });
      return;
    }

    const variable = await (prisma as any).flowVariable.create({
      data: {
        name: name.toLowerCase(),
        value,
        description,
        organizationId,
      },
    });

    res.status(201).json(variable);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Variable with this name already exists' });
      return;
    }
    console.error('Error creating flow variable:', error);
    res.status(500).json({ error: 'Failed to create variable' });
  }
};

// Update a flow variable
export const updateFlowVariable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization not found' });
      return;
    }

    const { id } = req.params;
    const { name, value, description } = req.body;

    // Verify the variable belongs to this organization
    const existing = await (prisma as any).flowVariable.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Variable not found' });
      return;
    }

    const variable = await (prisma as any).flowVariable.update({
      where: { id },
      data: {
        ...(name && { name: name.toLowerCase() }),
        ...(value !== undefined && { value }),
        ...(description !== undefined && { description }),
      },
    });

    res.json(variable);
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Variable with this name already exists' });
      return;
    }
    console.error('Error updating flow variable:', error);
    res.status(500).json({ error: 'Failed to update variable' });
  }
};

// Delete a flow variable
export const deleteFlowVariable = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization not found' });
      return;
    }

    const { id } = req.params;

    // Verify the variable belongs to this organization
    const existing = await (prisma as any).flowVariable.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Variable not found' });
      return;
    }

    await (prisma as any).flowVariable.delete({
      where: { id },
    });

    res.json({ message: 'Variable deleted successfully' });
  } catch (error) {
    console.error('Error deleting flow variable:', error);
    res.status(500).json({ error: 'Failed to delete variable' });
  }
};
