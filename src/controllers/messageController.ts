import { Response, Request } from 'express';
import { prisma } from '../config/database.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { sendWhatsAppMessage, markMessageAsRead, uploadMediaToMeta, getMediaUrl } from '../services/whatsappService.js';
import { Direction, MessageStatus, MessageType } from '@prisma/client';
import { emitToConversation } from '../services/socketService.js';

// Get messages for a conversation
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50, before } = req.query;

    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const where: any = { conversationId };
    if (organizationId) {
      where.organizationId = organizationId;
    }
    
    if (before) {
      where.timestamp = { lt: new Date(before as string) };
    }

    const messages = await (prisma as any).message.findMany({
      where,
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: Number(limit),
      skip: before ? 0 : (Number(page) - 1) * Number(limit),
    });

    // Return in chronological order
    res.json(messages.reverse());
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

// Send a message
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { 
      type = 'text', 
      content, 
      caption, 
      mediaUrl
    } = req.body;

    const finalTemplateName = req.body.templateName || req.body.template_name;
    const finalTemplateLanguage = req.body.templateLanguage || req.body.language || 'en';
    const finalTemplateComponents = req.body.templateComponents || req.body.components;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // For sending, we NEED an organization context even if Super Admin
    // If Super Admin is not tied to an org, they must provide one or we check the conversation's org
    const convWhere: any = { id: conversationId };
    if (organizationId) {
      convWhere.organizationId = organizationId;
    }

    // Get conversation with contact
    const conversation = await (prisma as any).conversation.findUnique({
      where: convWhere,
      include: { contact: true },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    const targetOrgId = organizationId || conversation.organizationId;

    // Assign to current agent if unassigned
    if (!conversation.assignedAgentId) {
      await (prisma as any).conversation.update({
        where: { id: conversationId },
        data: { assignedAgentId: userId },
      });
    }

    // Send via WhatsApp API
    const waResult = await sendWhatsAppMessage(targetOrgId, {
      to: conversation.contact.waId,
      type: type as any,
      content,
      caption,
      mediaUrl,
      templateName: finalTemplateName,
      templateLanguage: finalTemplateLanguage,
      templateComponents: finalTemplateComponents as any[]
    });

    // Create message record
    const message = await (prisma as any).message.create({
      data: {
        conversationId,
        senderId: userId,
        organizationId: targetOrgId,
        waMessageId: waResult.messageId || null,
        type: type.toUpperCase() as MessageType,
        content,
        caption,
        mediaUrl,
        direction: Direction.OUTGOING,
        status: waResult.success ? MessageStatus.SENT : MessageStatus.FAILED,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update conversation
    await (prisma as any).conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: content?.substring(0, 100) || `[${type}]`,
        status: 'OPEN',
      },
    });

    // Emit real-time event
    emitToConversation(conversationId, 'new_message', { message });

    if (!waResult.success) {
      res.status(500).json({
        error: 'Message saved but failed to send via WhatsApp',
        message,
        waError: waResult.error,
      });
      return;
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

// Send template message
export const sendTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { templateName, language = 'en', components = [] } = req.body;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const convWhere: any = { id: conversationId };
    if (organizationId) {
      convWhere.organizationId = organizationId;
    }

    // Get conversation with contact
    const conversation = await (prisma as any).conversation.findUnique({
      where: convWhere,
      include: { contact: true },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    const targetOrgId = organizationId || conversation.organizationId;

    // Send template via WhatsApp API
    const waResult = await sendWhatsAppMessage(targetOrgId, {
      to: conversation.contact.waId,
      type: 'template',
      content: '',
      templateName,
      templateLanguage: language,
      templateComponents: components,
    });

    // Create message record
    const message = await (prisma as any).message.create({
      data: {
        conversationId,
        senderId: userId,
        organizationId: targetOrgId,
        waMessageId: waResult.messageId || null,
        type: MessageType.TEMPLATE,
        content: `[Template: ${templateName}]`,
        direction: Direction.OUTGOING,
        status: waResult.success ? MessageStatus.SENT : MessageStatus.FAILED,
        metadata: { templateName, language, components },
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update conversation
    await (prisma as any).conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: `[Template: ${templateName}]`,
      },
    });

    emitToConversation(conversationId, 'new_message', { message });
    
    if (!waResult.success) {
      res.status(500).json({
        error: 'Template message saved but failed to send via WhatsApp',
        message,
        waError: waResult.error,
      });
      return;
    }

    res.status(201).json(message);
  } catch (error: any) {
    console.error('Send template error:', error);
    console.error('Error details:', error.message);
    if (error.response) {
      console.error('API Response:', error.response.data);
    }
    res.status(500).json({ 
      error: 'Failed to send template', 
      details: error.message,
      apiError: error.response?.data 
    });
  }
};

// Mark messages as read
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { messageIds } = req.body;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const convWhere: any = { id: conversationId };
    if (organizationId) {
      convWhere.organizationId = organizationId;
    }

    const conversation = await (prisma as any).conversation.findUnique({
       where: convWhere
    });

    if (!conversation) {
        res.status(404).json({ error: 'Conversation not found or access denied' });
        return;
    }

    const targetOrgId = organizationId || conversation.organizationId;

    // Update local database
    await (prisma as any).message.updateMany({
      where: {
        conversationId,
        organizationId: targetOrgId,
        id: { in: messageIds },
        direction: Direction.INCOMING,
      },
      data: { isRead: true },
    });

    // Reset unread count
    await (prisma as any).conversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });

    // Mark as read on WhatsApp (for the last message)
    const lastMessage = await (prisma as any).message.findFirst({
      where: {
        conversationId,
        organizationId: targetOrgId,
        direction: Direction.INCOMING,
        waMessageId: { not: null },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (lastMessage?.waMessageId) {
      await markMessageAsRead(targetOrgId, lastMessage.waMessageId);
    }

    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// Search messages
export const searchMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { q, conversationId } = req.query;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!q) {
      res.status(400).json({ error: 'Search query is required' });
      return;
    }

    const where: any = {
      content: {
        contains: q as string,
      },
    };

    if (organizationId) {
        where.organizationId = organizationId;
    }

    if (conversationId) {
      where.conversationId = conversationId;
    }

    const messages = await (prisma as any).message.findMany({
      where,
      include: {
        conversation: {
          include: {
            contact: {
              select: { name: true, phoneNumber: true },
            },
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: 50,
    });

    res.json(messages);
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
};

// Delete a message (Admin only)
export const deleteMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    // Check if message exists
    const msgWhere: any = { id };
    if (organizationId) {
      msgWhere.organizationId = organizationId;
    }

    const message = await (prisma as any).message.findFirst({
      where: msgWhere,
    });

    if (!message) {
      res.status(404).json({ error: 'Message not found or access denied' });
      return;
    }

    await (prisma as any).message.delete({
      where: { id },
    });

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
};

// Send media message (multiparts form-data)
export const sendMediaMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { conversationId } = req.params;
    const { type, caption } = req.body;
    const file = req.file;
    const userId = req.user!.id;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const convWhere: any = { id: conversationId };
    if (organizationId) {
      convWhere.organizationId = organizationId;
    }

    // Get conversation
    const conversation = await (prisma as any).conversation.findUnique({
      where: convWhere,
      include: { contact: true },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found or access denied' });
      return;
    }

    const targetOrgId = organizationId || conversation.organizationId;

    // Assign to me if unassigned
    if (!conversation.assignedAgentId) {
      await (prisma as any).conversation.update({
        where: { id: conversationId },
        data: { assignedAgentId: userId },
      });
    }

    // 1. Upload to Meta first to get Media ID
    const uploadResult = await uploadMediaToMeta(targetOrgId, file);

    if (!uploadResult.success) {
      res.status(500).json({ error: 'Failed to upload media to WhatsApp', detail: uploadResult.error });
      return;
    }

    // 2. Send via WhatsApp API using Media ID
    const waResult = await sendWhatsAppMessage(targetOrgId, {
      to: conversation.contact.waId,
      type: (type || 'image') as any,
      content: uploadResult.mediaId!,
      caption,
      mediaUrl: uploadResult.mediaId!, // Use ID as placeholder
    });

    // 3. Create record
    const message = await (prisma as any).message.create({
      data: {
        conversationId,
        senderId: userId,
        organizationId: targetOrgId,
        waMessageId: waResult.messageId || null,
        type: (type?.toUpperCase() || 'IMAGE') as MessageType,
        content: uploadResult.mediaId!, // Store Media ID in content
        caption,
        mediaId: uploadResult.mediaId,
        mediaType: file.mimetype,
        mediaSize: file.size,
        fileName: file.originalname,
        direction: Direction.OUTGOING,
        status: waResult.success ? MessageStatus.SENT : MessageStatus.FAILED,
      },
      include: {
        sender: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update conversation
    await (prisma as any).conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: message.content || `[${type}]`,
      },
    });

    emitToConversation(conversationId, 'new_message', { message });

    res.status(201).json(message);
  } catch (error) {
    console.error('Send media message error:', error);
    res.status(500).json({ error: 'Failed to send media message' });
  }
};

// Upload media to Meta and return media ID (for template headers)
export const uploadMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const file = req.file;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    console.log('📤 Upload media request:', {
      hasFile: !!file,
      fileName: file?.originalname,
      fileSize: file?.size,
      mimeType: file?.mimetype,
      organizationId,
      isSuperAdmin
    });

    if (!file) {
      console.error('❌ No file in request');
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    const targetOrgId = organizationId || req.body.organizationId;
    
    if (!targetOrgId) {
      res.status(400).json({ error: 'Organization ID required' });
      return;
    }

    // Also save locally for public access (Meta needs a public URL for template examples)
    const fs = await import('fs/promises');
    const path = await import('path');
    const filename = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const uploadDir = path.join(process.cwd(), 'uploads');
    
    // Ensure directory exists
    try {
      await fs.access(uploadDir);
    } catch {
      await fs.mkdir(uploadDir, { recursive: true });
    }
    
    await fs.writeFile(path.join(uploadDir, filename), file.buffer);
    
    // Construct public URL
    // NOTE: Meta needs an externally accessible URL for template examples
    let publicUrl: string;
    
    if (process.env.BACKEND_URL) {
      // Use the configured public URL (e.g. ngrok)
      publicUrl = `${process.env.BACKEND_URL.replace(/\/$/, '')}/uploads/${filename}`;
    } else {
      // Fallback to request host
      const protocol = req.protocol;
      const host = req.get('host');
      publicUrl = `${protocol}://${host}/uploads/${filename}`;
    }

    console.log('📂 Local file saved:', publicUrl);

    // Upload to Meta for standard messaging (numerical ID)
    const uploadResult = await uploadMediaToMeta(targetOrgId, file);

    // ALSO upload as a template asset to get the 4:: handle (required for templates)
    let headerHandle = null;
    try {
        const { uploadTemplateAssetToMeta } = await import('../services/whatsappService.js');
        const assetResult = await uploadTemplateAssetToMeta(targetOrgId, file);
        if (assetResult.success) {
            headerHandle = assetResult.handle;
            console.log('🆔 Template asset handle obtained:', headerHandle);
        } else {
            console.warn('⚠️ Template asset upload returned success:false:', assetResult.error);
        }
    } catch (assetErr: any) {
        console.warn('⚠️ Failed to get template asset handle, but media upload succeeded:', assetErr.message);
    }

    if (!uploadResult.success) {
      res.status(500).json({ 
        error: 'Failed to upload media to WhatsApp', 
        detail: uploadResult.error,
        publicUrl 
      });
      return;
    }

    res.json({
      success: true,
      mediaId: uploadResult.mediaId,
      headerHandle, // The 4:: style handle
      publicUrl,
      type: file.mimetype,
      filename: file.originalname,
    });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
};

// Proxy media requests to Meta
export const proxyMedia = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { mediaId } = req.params;
    const organizationId = req.user?.organizationId;
    const isSuperAdmin = req.user?.role === 'SUPER_ADMIN';

    if (!organizationId && !isSuperAdmin) {
      res.status(403).json({ error: 'User not associated with an organization' });
      return;
    }

    if (!mediaId) {
      res.status(400).json({ error: 'Media ID is required' });
      return;
    }

    // If Super Admin, we need to find which organization this media belongs to OR use a targetOrgId if provided
    // For now, if Super Admin is not tied to an org, we try to find the organizationId from the message record
    let targetOrgId = organizationId;
    
    if (!targetOrgId && isSuperAdmin) {
        const message = await (prisma as any).message.findFirst({
            where: { mediaId }
        });
        if (message) {
            targetOrgId = message.organizationId;
        }
    }

    if (!targetOrgId) {
        res.status(403).json({ error: 'Organization context not found for this media' });
        return;
    }

    // 1. Get the temporary URL from Meta
    const result = await getMediaUrl(targetOrgId, mediaId);

    if (result.success && result.url) {
      // 2. Instead of redirecting, we pipe the stream to handle auth correctly
      const { getWhatsappClient } = await import('../config/whatsapp.js');
      const org = await (prisma as any).organization.findUnique({ 
        where: { id: targetOrgId } 
      });

      if (!org || !org.accessToken) {
        res.status(403).json({ error: 'Organization credentials not found' });
        return;
      }
      
      const client = getWhatsappClient(org.accessToken);
      
      const response = await client.get(result.url, {
        baseURL: '', // Override baseURL since we have the full URL
        responseType: 'stream'
      });

      // Set correct content type if available
      if (result.mimeType) {
        res.setHeader('Content-Type', result.mimeType);
      }
      if (result.fileSize) {
        res.setHeader('Content-Length', result.fileSize);
      }

      // Pipe the stream directly to the response
      response.data.pipe(res);
    } else {
      res.status(404).json({ error: 'Media not found on Meta or failed to resolve URL' });
    }
  } catch (error) {
    console.error('Proxy media error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to proxy media stream' });
    }
  }
};
