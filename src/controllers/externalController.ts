import { Response } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { Direction, MessageStatus, MessageType } from '@prisma/client';
import { emitToConversation } from '../services/socketService.js';

/**
 * Send a message via external API
 * Supports text, image, video, document, audio
 */
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phoneNumber, type = 'text', content, caption, mediaUrl, mediaId } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(401).json({ error: 'Organization context missing' });
      return;
    }

    if (!phoneNumber || (!content && !mediaUrl && !mediaId)) {
      res.status(400).json({ error: 'phoneNumber and content/mediaUrl/mediaId are required' });
      return;
    }

    const waId = phoneNumber.replace(/\D/g, '');

    // 1. Find or Create Contact
    let contact = await (prisma as any).contact.findUnique({
      where: { 
        waId_organizationId: {
          waId,
          organizationId
        }
      },
    });

    if (!contact) {
      contact = await (prisma as any).contact.create({
        data: {
          waId,
          phoneNumber: waId,
          organizationId,
          tags: '[]',
        },
      });
    }

    // 2. Find or Create Conversation
    let conversation = await (prisma as any).conversation.findFirst({
      where: {
        contactId: contact.id,
        organizationId,
        status: { in: ['OPEN', 'PENDING'] },
      },
    });

    if (!conversation) {
      conversation = await (prisma as any).conversation.create({
        data: {
          contactId: contact.id,
          organizationId,
          status: 'OPEN',
          tags: '[]',
        },
      });
    }

    // 3. Send via WhatsApp API
    const waResult = await sendWhatsAppMessage(organizationId, {
      to: waId,
      type: type as any,
      content: content || mediaId || '',
      caption,
      mediaUrl,
    });

    // 4. Create Message Record
    const message = await (prisma as any).message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.user?.id, // Could be system-orgId
        organizationId,
        waMessageId: waResult.messageId || null,
        type: type.toUpperCase() as MessageType,
        content: content || `[${type}]`,
        caption,
        mediaUrl: mediaUrl || null,
        mediaId: mediaId || null,
        direction: Direction.OUTGOING,
        status: waResult.success ? MessageStatus.SENT : MessageStatus.FAILED,
      },
    });

    // 5. Update Conversation
    await (prisma as any).conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: content?.substring(0, 100) || `[${type}]`,
      },
    });

    // 6. Emit Socket Event
    emitToConversation(conversation.id, 'new_message', { message });

    if (!waResult.success) {
      res.status(500).json({ 
        error: 'Failed to send via WhatsApp', 
        message, 
        waError: waResult.error 
      });
      return;
    }

    res.status(201).json(message);
  } catch (error: any) {
    console.error('External sendMessage error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Send a template message via external API
 */
export const sendTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phoneNumber, templateName, language = 'en', components = [] } = req.body;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(401).json({ error: 'Organization context missing' });
      return;
    }

    if (!phoneNumber || !templateName) {
      res.status(400).json({ error: 'phoneNumber and templateName are required' });
      return;
    }

    const waId = phoneNumber.replace(/\D/g, '');

    // 1. Find or Create Contact
    let contact = await (prisma as any).contact.findUnique({
      where: { 
        waId_organizationId: {
          waId,
          organizationId
        }
      },
    });

    if (!contact) {
      contact = await (prisma as any).contact.create({
        data: {
          waId,
          phoneNumber: waId,
          organizationId,
          tags: '[]',
        },
      });
    }

    // 2. Find or Create Conversation
    let conversation = await (prisma as any).conversation.findFirst({
      where: {
        contactId: contact.id,
        organizationId,
        status: { in: ['OPEN', 'PENDING'] },
      },
    });

    if (!conversation) {
      conversation = await (prisma as any).conversation.create({
        data: {
          contactId: contact.id,
          organizationId,
          status: 'OPEN',
          tags: '[]',
        },
      });
    }

    // 3. Send via WhatsApp API
    const waResult = await sendWhatsAppMessage(organizationId, {
      to: waId,
      type: 'template',
      content: '',
      templateName,
      templateLanguage: language,
      templateComponents: components,
    });

    // 4. Create Message Record
    const message = await (prisma as any).message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.user?.id,
        organizationId,
        waMessageId: waResult.messageId || null,
        type: MessageType.TEMPLATE,
        content: `[Template: ${templateName}]`,
        direction: Direction.OUTGOING,
        status: waResult.success ? MessageStatus.SENT : MessageStatus.FAILED,
        metadata: JSON.stringify({ templateName, language, components }),
      },
    });

    // 5. Update Conversation
    await (prisma as any).conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: `[Template: ${templateName}]`,
      },
    });

    // 6. Emit Socket Event
    emitToConversation(conversation.id, 'new_message', { message });

    if (!waResult.success) {
      res.status(500).json({ 
        error: 'Failed to send via WhatsApp', 
        message, 
        waError: waResult.error 
      });
      return;
    }

    res.status(201).json(message);
  } catch (error: any) {
    console.error('External sendTemplate error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get or Generate API Key
 */
export const getApiKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const organizationId = req.user?.organizationId;

    if (organizationId && organizationId !== orgId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const org = await (prisma as any).organization.findUnique({
      where: { id: orgId },
      select: { apiKey: true, externalWebhookUrl: true, externalWebhookSecret: true }
    });

    res.json({ 
      apiKey: org?.apiKey || '',
      externalWebhookUrl: org?.externalWebhookUrl || '',
      externalWebhookSecret: org?.externalWebhookSecret || ''
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Generate a new API Key for the organization
 */
export const generateApiKey = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const organizationId = req.user?.organizationId;
    const { v4: uuidv4 } = await import('uuid');

    if (organizationId && organizationId !== orgId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const newApiKey = `bw_${uuidv4().replace(/-/g, '')}`;

    const updated = await (prisma as any).organization.update({
      where: { id: orgId },
      data: { apiKey: newApiKey }
    });

    res.json({ apiKey: updated.apiKey });
  } catch (error: any) {
    console.error('generateApiKey error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update external API settings (API Key, Webhook URL)
 */
export const updateSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const { apiKey, externalWebhookUrl, externalWebhookSecret } = req.body;
    const organizationId = req.user?.organizationId;

    if (organizationId && organizationId !== orgId && req.user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updated = await (prisma as any).organization.update({
      where: { id: orgId },
      data: {
        apiKey,
        externalWebhookUrl,
        externalWebhookSecret
      }
    });

    res.json({
      apiKey: updated.apiKey,
      externalWebhookUrl: updated.externalWebhookUrl,
      externalWebhookSecret: updated.externalWebhookSecret
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
