import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { processChatbotFlow } from '../services/chatbotService.js';

/**
 * Helper to parse nodes/edges strings to JSON
 */
const parseFlow = (flow: any) => {
  if (!flow) return null;
  return {
    ...flow,
    nodes: typeof flow.nodes === 'string' ? JSON.parse(flow.nodes) : flow.nodes,
    edges: typeof flow.edges === 'string' ? JSON.parse(flow.edges) : flow.edges,
  };
};

export const getFlows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    const flows = await (prisma as any).flow.findMany({
      where: { organizationId }
    });
    
    // Parse strings back to objects for frontend
    const parsedFlows = flows.map(parseFlow);
    
    res.json(parsedFlows);
  } catch (error) {
    console.error('Get flows error:', error);
    res.status(500).json({ error: 'Failed to fetch flows' });
  }
};

export const getFlow = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;
  
      const flow = await (prisma as any).flow.findFirst({
        where: { id, organizationId }
      });
      
      if (!flow) {
        res.status(404).json({ error: 'Flow not found' });
        return;
      }
  
      res.json(parseFlow(flow));
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch flow' });
    }
};

export const saveFlow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, nodes, edges, trigger, isDefault } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
        res.status(403).json({ error: 'Organization context required' });
        return;
    }

    // Ensure only one default flow per organization if this one is set to default
    if (isDefault) {
        await (prisma as any).flow.updateMany({
            where: { organizationId },
            data: { isDefault: false }
        });
    }

    // Ensure data is stringified for database
    const nodesStr = typeof nodes === 'string' ? nodes : JSON.stringify(nodes);
    const edgesStr = typeof edges === 'string' ? edges : JSON.stringify(edges);

    let flow;
    if (id === 'default' || id === 'new') {
        flow = await (prisma as any).flow.create({
            data: {
                name: name || 'Untitled Flow',
                nodes: nodesStr,
                edges: edgesStr,
                triggerKeyword: (trigger || 'WELCOME').toUpperCase(),
                organizationId,
                isActive: true,
                isDefault: !!isDefault
            }
        });
    } else {
        flow = await (prisma as any).flow.update({
            where: { id, organizationId },
            data: {
                ...(name && { name }),
                nodes: nodesStr,
                edges: edgesStr,
                ...(trigger && { triggerKeyword: trigger.toUpperCase() }),
                ...(isDefault !== undefined && { isDefault: !!isDefault })
            }
        });
    }

    res.json(parseFlow(flow));
  } catch (error) {
    console.error('Save flow error:', error);
    res.status(500).json({ error: 'Failed to save flow' });
  }
};

export const testFlow = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { phoneNumber, flowId } = req.body;
      const organizationId = req.user?.organizationId;
      
      if (!organizationId) {
         res.status(403).json({ error: 'Organization context required' });
         return;
      }
  
      const flow = await (prisma as any).flow.findUnique({ where: { id: flowId } });
      if (!flow) {
          res.status(404).json({ error: 'Flow not found' });
          return;
      }
  
      // Ensure contact exists
      let contact = await (prisma as any).contact.findUnique({
          where: { waId_organizationId: { waId: phoneNumber, organizationId } }
      });
  
      if (!contact) {
          contact = await (prisma as any).contact.create({
              data: {
                  waId: phoneNumber,
                  phoneNumber,
                  name: 'Test User',
                  organizationId,
                  tags: '[]'
              }
          });
      }
  
      // Trigger flow with the keyword
      await processChatbotFlow(organizationId, contact.id, phoneNumber, flow.triggerKeyword);
  
      res.json({ success: true, message: `Flow triggered for ${phoneNumber}` });
    } catch (error) {
       console.error('Test flow error:', error);
       res.status(500).json({ error: 'Failed to trigger test flow' });
    }
  };

export const deleteFlow = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(403).json({ error: 'Organization context required' });
      return;
    }

    // Verify flow exists and belongs to this organization
    const flow = await (prisma as any).flow.findFirst({
      where: { id, organizationId }
    });

    if (!flow) {
      res.status(404).json({ error: 'Flow not found' });
      return;
    }

    // Delete all associated flow sessions first (foreign key constraint)
    await (prisma as any).flowSession.deleteMany({
      where: { flowId: id }
    });

    // Delete the flow
    await (prisma as any).flow.delete({
      where: { id }
    });

    console.log(`🗑️ Deleted flow: ${flow.name} (${id})`);
    res.json({ success: true, message: `Flow "${flow.name}" deleted successfully` });
  } catch (error) {
    console.error('Delete flow error:', error);
    res.status(500).json({ error: 'Failed to delete flow' });
  }
};
