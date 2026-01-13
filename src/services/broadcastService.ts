import { prisma } from '../config/database.js';
import { sendWhatsAppMessage } from './whatsappService.js';
import { BroadcastStatus, MessageStatus } from '@prisma/client';

export const broadcastService = {
  /**
   * Start a broadcast campaign
   */
  startBroadcast: async (broadcastId: string) => {
    try {
      // 1. Fetch broadcast with recipients
      const broadcast = await (prisma as any).broadcast.findUnique({
        where: { id: broadcastId },
        include: { recipients: true },
      });

      if (!broadcast) throw new Error('Broadcast not found');
      if (broadcast.status !== 'PENDING' && broadcast.status !== 'SCHEDULED') return;

      // 2. Update status to PROCESSING
      await (prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { 
          status: 'PROCESSING',
          startedAt: new Date()
        },
      });

      console.log(`🚀 Starting Broadcast: ${broadcast.name} (${broadcastId})`);

      const BATCH_SIZE = 50;
      const BATCH_DELAY = 5000; // 5 seconds between batches
      const recipients = broadcast.recipients;

      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(recipients.length / BATCH_SIZE);
        
        console.log(`📦 [Broadcast] Processing Batch ${batchNumber}/${totalBatches} (${batch.length} recipients)`);

        await Promise.all(batch.map(async (recipient: any) => {
          try {
            // Build components array - header FIRST, then body (order matters for Meta API)
            const components: any[] = [];

            // Header component (media) - MUST come first
            if (broadcast.mediaId && broadcast.mediaType) {
              const mediaTypeLower = broadcast.mediaType.toLowerCase() as 'image' | 'document' | 'video';
              components.push({
                type: 'header',
                parameters: [{
                  type: mediaTypeLower,
                  [mediaTypeLower]: { id: broadcast.mediaId }
                }]
              });
            }

            // Body component (variables) - comes after header
            const bodyParams = broadcastService.parseVariables(recipient.variables);
            if (bodyParams.length > 0) {
              components.push({
                type: 'body',
                parameters: bodyParams
              });
            }

            const result = await sendWhatsAppMessage(broadcast.organizationId, {
              to: recipient.phoneNumber,
              type: 'template',
              content: '',
              templateName: broadcast.templateName,
              templateLanguage: broadcast.templateLanguage,
              templateComponents: components,
            });

            if (result.success) {
              await (prisma as any).broadcastRecipient.update({
                where: { id: recipient.id },
                data: {
                  status: 'SENT',
                  waMessageId: result.messageId,
                  sentAt: new Date(),
                },
              });

              await (prisma as any).broadcast.update({
                where: { id: broadcastId },
                data: { sentCount: { increment: 1 } },
              });

              // Update conversation preview and link
              const conversation = await (prisma as any).conversation.findFirst({
                where: {
                  contactId: (recipient as any).contactId || undefined, // Fallback if contactId isn't on recipient
                  contact: { phoneNumber: recipient.phoneNumber },
                  organizationId: broadcast.organizationId
                }
              });

              if (conversation) {
                await (prisma as any).conversation.update({
                  where: { id: conversation.id },
                  data: {
                    lastMessageAt: new Date(),
                    lastMessagePreview: `[Template: ${broadcast.templateName}]`,
                    broadcastId: broadcast.id,
                    broadcastName: broadcast.name,
                    isReply: false, // Reset reply status since we just sent a new broadcast
                  }
                });
              }
            } else {
              await (prisma as any).broadcastRecipient.update({
                where: { id: recipient.id },
                data: {
                  status: 'FAILED',
                  error: result.error,
                },
              });

              await (prisma as any).broadcast.update({
                where: { id: broadcastId },
                data: { failedCount: { increment: 1 } },
              });
            }
          } catch (recipientError: any) {
            console.error(`❌ [Batch] Failed to send to ${recipient.phoneNumber}:`, recipientError.message);
            await (prisma as any).broadcastRecipient.update({
              where: { id: recipient.id },
              data: {
                status: 'FAILED',
                error: recipientError.message,
              },
            });
          }
        }));

        if (i + BATCH_SIZE < recipients.length) {
          console.log(`⏳ [Broadcast] Waiting ${BATCH_DELAY / 1000}s for next batch...`);
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }

      // 4. Mark as COMPLETED
      await (prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { 
          status: 'COMPLETED',
          completedAt: new Date()
        },
      });

      console.log(`✅ Broadcast Completed: ${broadcast.name}`);

    } catch (error) {
      console.error(`❌ Broadcast Error (${broadcastId}):`, error);
      await (prisma as any).broadcast.update({
        where: { id: broadcastId },
        data: { status: 'FAILED' },
      });
    }
  },

  /**
   * Parse variable map into Meta Template Components
   * Expects variables like: { "1": "John", "2": "Premium" } representing {{1}}, {{2}}
   * Or named if we implement a mapping (CSV column -> Var index)
   */
  parseVariables: (variablesInput: any): any[] => {
    if (!variablesInput) return [];

    // Handle stringified JSON (from DB storage)
    let variables = variablesInput;
    if (typeof variablesInput === 'string') {
      try {
        variables = JSON.parse(variablesInput);
      } catch {
        return [];
      }
    }

    if (!variables || typeof variables !== 'object') return [];

    const bodyParameters: any[] = [];
    
    // Sort keys numerically to match {{1}}, {{2}}...
    const sortedKeys = Object.keys(variables).sort((a, b) => parseInt(a) - parseInt(b));

    for (const key of sortedKeys) {
      // Include ALL parameters, use placeholder if empty to avoid count mismatch
      const value = String(variables[key] ?? '').trim() || '-';
      bodyParameters.push({
        type: 'text',
        text: value,
      });
    }

    return bodyParameters;
  }
};
