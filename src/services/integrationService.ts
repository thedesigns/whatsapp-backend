import { prisma } from '../config/database.js';
import { sendWhatsAppMessage } from './whatsappService.js';
// import { NotificationType } from '@prisma/client'; // Temporarily removed to fix lint

export const integrationService = {
  /**
   * Log an incoming webhook event
   */
  async logEvent(orgId: string, source: string, event: string, payload: any) {
    return await (prisma as any).integrationEvent.create({
      data: {
        organizationId: orgId,
        source: source.toLowerCase(),
        event,
        payload: JSON.stringify(payload),
      }
    });
  },

  /**
   * Send an immediate order notification
   */
  async sendOrderNotification(orgId: string, phone: string, templateName: string, variables: any, imageUrl?: string) {
    console.log(`📡 [Integration] Sending ${templateName} to ${phone} with image: ${!!imageUrl}`);
    
    const components: any[] = [];

    // Add Image Header if provided
    if (imageUrl) {
      components.push({
        type: 'HEADER',
        parameters: [
          {
            type: 'image',
            image: {
              link: imageUrl
            }
          }
        ]
      });
    }

    // Convert variables object to array format for WhatsApp BODY
    components.push({
      type: 'BODY',
      parameters: Object.keys(variables).map(key => ({
        type: 'text',
        text: String(variables[key])
      }))
    });

    return await sendWhatsAppMessage(orgId, {
      to: phone,
      type: 'template',
      content: '',
      templateName,
      templateLanguage: 'en',
      templateComponents: components
    });
  },

  /**
   * Schedule an abandoned cart reminder
   */
  async scheduleAbandonedCart(orgId: string, phone: string, externalId: string, payload: any, delayMinutes: number = 60) {
    const scheduledAt = new Date(Date.now() + delayMinutes * 60000);
    
    // Check if there's already a pending reminder for this checkout
    const existing = await (prisma as any).scheduledNotification.findFirst({
      where: {
        organizationId: orgId,
        externalId,
        status: 'PENDING',
        type: 'ABANDONED_CART'
      }
    });

    if (existing) {
      console.log(`♻️ [Integration] Updating existing abandoned cart reminder for ${externalId}`);
      return await (prisma as any).scheduledNotification.update({
        where: { id: existing.id },
        data: {
          payload: JSON.stringify(payload),
          scheduledAt
        }
      });
    }

    console.log(`⏰ [Integration] Scheduling abandoned cart reminder for ${phone} in ${delayMinutes} mins`);
    return await (prisma as any).scheduledNotification.create({
      data: {
        organizationId: orgId,
        type: 'ABANDONED_CART',
        status: 'PENDING',
        recipient: phone,
        payload: JSON.stringify(payload),
        templateName: 'abandoned_cart_reminder', // Default template name
        scheduledAt,
        externalId
      }
    });
  },

  /**
   * Cancel a scheduled notification (e.g. when order is placed)
   */
  async cancelScheduledNotification(orgId: string, externalId: string) {
    const pending = await (prisma as any).scheduledNotification.findMany({
      where: {
        organizationId: orgId,
        externalId,
        status: 'PENDING'
      }
    });

    if (pending.length > 0) {
      console.log(`🚫 [Integration] Cancelling ${pending.length} pending notifications for ${externalId}`);
      await (prisma as any).scheduledNotification.updateMany({
        where: {
          organizationId: orgId,
          externalId,
          status: 'PENDING'
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date()
        }
      });
    }
  },

  /**
   * Get integration configuration for an organization
   */
  async getIntegrationConfig(orgId: string, type: string) {
    const integration = await (prisma as any).integration.findFirst({
      where: {
        organizationId: orgId,
        type: type.toUpperCase(),
        isActive: true
      }
    });
    
    if (integration && integration.config) {
      try {
        return JSON.parse(integration.config);
      } catch (e) {
        return {};
      }
    }
    return null;
  }
};
