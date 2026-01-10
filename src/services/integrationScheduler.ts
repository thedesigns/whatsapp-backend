import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { integrationService } from './integrationService.js';

/**
 * Initialize the integration background scheduler
 */
export const initIntegrationScheduler = () => {
  console.log('⏰ [Integration Scheduler] Service Initialized');
  
  // Check for scheduled notifications every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      
      // Find notifications that are PENDING and whose schedule time has reached
      const pendingNotifications = await (prisma as any).scheduledNotification.findMany({
        where: {
          status: 'PENDING',
          scheduledAt: {
            lte: now
          }
        },
        take: 50 // Process in batches
      });

      if (pendingNotifications.length > 0) {
        console.log(`📡 [Integration Scheduler] Processing ${pendingNotifications.length} notifications`);
        
        for (const notif of pendingNotifications) {
          try {
            const payload = JSON.parse(notif.payload);
            
            // Map common payload fields to template variables (this can be customized per type)
            const variables: any = {
              customer_name: payload.customer_name || 'Customer',
              cart_url: payload.cart_url || '',
              // Add more as needed
            };

            await integrationService.sendOrderNotification(
              notif.organizationId,
              notif.recipient,
              notif.templateName,
              variables,
              payload.image_url // Pass image_url if present
            );

            // Mark as sent
            await (prisma as any).scheduledNotification.update({
              where: { id: notif.id },
              data: {
                status: 'SENT',
                sentAt: new Date()
              }
            });
            
            console.log(`✅ [Integration Scheduler] Reminder sent to ${notif.recipient}`);
          } catch (error: any) {
            console.error(`❌ [Integration Scheduler] Error processing notification ${notif.id}:`, error.message);
            await (prisma as any).scheduledNotification.update({
              where: { id: notif.id },
              data: {
                status: 'FAILED',
                error: error.message
              }
            });
          }
        }
      }
    } catch (error: any) {
      console.error('❌ [Integration Scheduler] Fatal Error:', error.message);
    }
  });
};
