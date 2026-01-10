import { Request, Response } from 'express';
import { integrationService } from '../services/integrationService.js';

export const handleZohoWebhook = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  
  console.log(`💼 [Zoho Webhook] Received for Org: ${orgId}`);

  try {
    const payload = req.body;
    await integrationService.logEvent(orgId, 'zoho', 'webhook_received', payload);

    // Zoho Books / Inventory logic
    // Usually provides 'invoice' or 'estimate' related events
    const eventType = payload.event_type;
    const data = payload.data || {};

    if (eventType === 'invoice_created') {
      const customer = data.customer_name || 'Customer';
      const phone = data.customer_phone;
      
      if (phone) {
        await integrationService.sendOrderNotification(
          orgId,
          phone,
          'invoice_generated',
          {
            customer_name: customer,
            invoice_number: data.invoice_number,
            amount: data.total
          }
        );
      }
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error('❌ [Zoho Webhook Error]:', error.message);
    res.sendStatus(200); // Always respond 200 to Zoho to avoid retries
  }
};
