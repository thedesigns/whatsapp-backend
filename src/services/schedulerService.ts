import cron from 'node-cron';
import { prisma } from '../config/database.js';
import { broadcastService } from './broadcastService.js';

/**
 * Initialize the background scheduler
 */
export const initScheduler = () => {
  console.log('⏰ [Scheduler] Service Initialized');
  
  // Check for scheduled broadcasts every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      
      // Find broadcasts that are SCHEDULED and whose schedule time has reached
      const pendingBroadcasts = await (prisma as any).broadcast.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: {
            lte: now
          }
        }
      });

      if (pendingBroadcasts.length > 0) {
        console.log(`📡 [Scheduler] Found ${pendingBroadcasts.length} broadcasts to process`);
        
        for (const broadcast of pendingBroadcasts) {
          try {
            console.log(`🚀 [Scheduler] Auto-starting broadcast: ${broadcast.name} (${broadcast.id})`);
            
            // Start the broadcast processing
            // No need to await here if we want them to run in parallel, 
            // but for safety in dev we'll await or handle concurrency
            await broadcastService.startBroadcast(broadcast.id);
          } catch (error: any) {
            console.error(`❌ [Scheduler] Error processing broadcast ${broadcast.id}:`, error.message);
          }
        }
      }
    } catch (error: any) {
      console.error('❌ [Scheduler] Fatal Error:', error.message);
    }
  });
};
