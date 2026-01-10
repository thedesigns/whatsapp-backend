import { Request, Response } from 'express';
import { integrationService } from '../services/integrationService.js';

export const handleTallySync = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  
  console.log(`📊 [Tally Sync] Data received for Org: ${orgId}`);

  try {
    const payload = req.body;
    await integrationService.logEvent(orgId, 'tally', 'sync_received', payload);

    // Tally integrations usually send bulk vouchers or specific ledger updates
    // For now, we'll log the event and provide a placeholder for automated billing alerts
    
    if (payload.event === 'ledger_balance_alert') {
      const customerPhone = payload.phone;
      if (customerPhone) {
        await integrationService.sendOrderNotification(
          orgId,
          customerPhone,
          'payment_reminder',
          {
            customer_name: payload.name,
            balance: payload.balance
          }
        );
      }
    }

    res.json({ status: 'success', message: 'Tally data processed' });
  } catch (error: any) {
    console.error('❌ [Tally Sync Error]:', error.message);
    res.status(500).json({ status: 'error', message: error.message });
  }
};
