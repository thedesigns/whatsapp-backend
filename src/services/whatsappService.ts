import { getWhatsappClient, WHATSAPP_CONFIG } from '../config/whatsapp.js';
import { prisma } from '../config/database.js';
import { Direction, MessageStatus, MessageType } from '@prisma/client';
import { processChatbotFlow } from './chatbotService.js';
import { sendPushNotification } from './notificationService.js';
import axios from 'axios';
import crypto from 'crypto';

interface SendMessageOptions {
  to: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'template' | 'interactive';
  content: string;
  caption?: string;
  mediaUrl?: string;
  templateName?: string;
  templateLanguage?: string;
  templateComponents?: any[];
  buttons?: any[];
  sections?: any[];
  footerText?: string;
  catalogId?: string;
  productRetailerIds?: string[];
  flowId?: string;
  flowToken?: string;
  screenId?: string;
  header?: string;
}

interface WhatsAppMessage {
  messaging_product: string;
  recipient_type: string;
  to: string;
  type: string;
  [key: string]: any;
}

// Helper to get organization-specific client and config
const getOrgConfig = async (orgId: string) => {
  console.log(`🔍 Looking up org config for: ${orgId}`);
  
  const org = await (prisma as any).organization.findUnique({
    where: { id: orgId },
  });

  if (!org) {
    console.error(`❌ Organization not found: ${orgId}`);
    throw new Error(`Organization ${orgId} not found`);
  }

  // Fallback to env if missing in DB for development
  if ((!org.wabaId || org.wabaId === '') && process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    org.wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  }

  console.log(`✅ Org config loaded: ${org.name} (Phone: ${org.phoneNumberId}, WABA: ${org.wabaId})`);
  const client = getWhatsappClient(org.accessToken);
  return { org, client };
};

// Send a message through WhatsApp Cloud API
export const sendWhatsAppMessage = async (orgId: string, options: SendMessageOptions) => {
  const { to, type, content, caption, mediaUrl, templateName, templateLanguage, templateComponents } = options;

  let message: WhatsAppMessage = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, ''), // Remove non-digits
    type: type,
  };

  switch (type) {
    case 'text':
      message.text = { body: content };
      break;
    case 'image':
      message.image = mediaUrl?.startsWith('http') 
        ? { link: mediaUrl, caption } 
        : { id: content, caption };
      break;
    case 'document':
      message.document = mediaUrl?.startsWith('http')
        ? { link: mediaUrl, caption, filename: caption || 'document' }
        : { id: content, caption, filename: caption || 'document' };
      break;
    case 'audio':
      message.audio = mediaUrl?.startsWith('http') 
        ? { link: mediaUrl } 
        : { id: content };
      break;
    case 'video':
      message.video = mediaUrl?.startsWith('http')
        ? { link: mediaUrl, caption }
        : { id: content, caption };
      break;
    case 'template':
      // Sanitize template components - when SENDING a template, you typically only need
      // to pass components that have variable parameters. Static components (FOOTER, BUTTONS without dynamic content)
      // should NOT be passed - Meta knows them from the template definition.
      const sanitizedComponents = (templateComponents || []).map((comp: any) => {
        const typeUpper = (comp.type || '').toUpperCase();
        
        // HEADER with media parameters (image, document, video)
        if (typeUpper === 'HEADER') {
          if (!comp.parameters || comp.parameters.length === 0) {
            return null; // Skip headers without parameters
          }
          return {
            type: 'header',
            parameters: comp.parameters.map((p: any) => {
              const param: any = { type: p.type };
              const type = p.type.toLowerCase();
              
              if (['image', 'video', 'document'].includes(type)) {
                // If it's already wrapped correctly: { image: { link: '...' } }
                if (p[type]) {
                  param[type] = p[type];
                } 
                // Or if it's flat: { type: 'image', link: '...' } or { type: 'image', id: '...' }
                else if (p.link || p.id) {
                  param[type] = {};
                  if (p.link) param[type].link = p.link;
                  if (p.id) param[type].id = p.id;
                  if (p.filename) param[type].filename = p.filename;
                }
              } else if (type === 'text') {
                param.text = p.text || '';
              }
              return param;
            }),
          };
        }
        
        // BODY with text variable parameters
        if (typeUpper === 'BODY') {
          if (!comp.parameters || comp.parameters.length === 0) {
            return null; // Skip body without parameters
          }
          return {
            type: 'body',
            parameters: comp.parameters.map((p: any) => ({
              type: p.type,
              text: p.text,
            })),
          };
        }
        
        // BUTTON with dynamic content (like URL suffix)
        if (typeUpper === 'BUTTON') {
          if (!comp.parameters || comp.parameters.length === 0) {
            return null; // Skip buttons without parameters
          }
          return {
            type: 'button',
            sub_type: comp.sub_type,
            index: comp.index ?? 0,
            parameters: comp.parameters,
          };
        }
        
        // FOOTER and BUTTONS without parameters should be skipped entirely
        // (Meta already knows these from the template definition)
        if (typeUpper === 'FOOTER' || typeUpper === 'BUTTONS') {
          return null;
        }
        
        // Any other component with parameters
        if (comp.parameters && comp.parameters.length > 0) {
          return {
            type: typeUpper.toLowerCase(),
            parameters: comp.parameters,
          };
        }
        
        return null; // Skip components without parameters
      }).filter(Boolean); // Remove null entries

      message.template = {
        name: templateName,
        language: { code: templateLanguage || 'en' },
        components: sanitizedComponents,
      };
      console.log('📝 Sanitized template components:', JSON.stringify(sanitizedComponents, null, 2));
      break;
    case 'interactive':
      if (options.flowId) {
        message.interactive = {
            type: 'flow',
            body: { text: content || 'Please open the form below:' },
            action: {
                name: 'flow',
                parameters: {
                    flow_message_version: '3',
                    flow_token: options.flowToken || `token_${Date.now()}`,
                    flow_id: options.flowId,
                    flow_cta: options.caption || 'Open Form',
                    flow_action: 'navigate',
                    flow_action_payload: {
                        screen: options.screenId || 'QUESTION_ONE',
                    }
                }
            }
        };

        if (options.header) {
            message.interactive.header = { type: 'text', text: options.header };
        }
        if (options.footerText) {
            message.interactive.footer = { text: options.footerText };
        }
      } else if (options.catalogId) {
        const skus = options.productRetailerIds || [];
        message.interactive = {
            type: skus.length === 1 ? 'product' : 'product_list',
            header: { type: 'text', text: options.caption || 'Catalog' },
            body: { text: content },
            footer: { text: options.footerText || '' },
            action: {
                catalog_id: options.catalogId,
                ...(skus.length === 1 
                    ? { product_retailer_id: skus[0] }
                    : { 
                        sections: [
                            {
                                title: 'Our Products',
                                product_items: skus.map(s => ({ product_retailer_id: s.trim() }))
                            }
                        ]
                    }
                )
            }
        };
      } else if (options.buttons && options.buttons.length > 0) {
        message.interactive = {
          type: 'button',
          body: { text: content },
          action: {
            buttons: options.buttons
          }
        };
        if (options.footerText) {
          message.interactive.footer = { text: options.footerText };
        }
      } else if (options.sections && options.sections.length > 0) {
        message.interactive = {
            type: 'list',
            body: { text: content },
            action: {
                button: options.caption || 'Menu',
                sections: options.sections
            }
        };
        if (options.footerText) {
          message.interactive.footer = { text: options.footerText };
        }
      }
      break;
    default:
      message.text = { body: content };
  }

  try {
    const { org, client } = await getOrgConfig(orgId);
    
    const response = await client.post(
      `/${org.phoneNumberId}/messages`,
      message
    );

    console.log('✅ Message sent successfully:', response.data);
    return {
      success: true,
      messageId: response.data.messages?.[0]?.id,
      data: response.data,
    };
  } catch (error: any) {
    console.error('❌ Error sending message:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
};

// Mark a message as read
export const markMessageAsRead = async (orgId: string, messageId: string) => {
  try {
    const { org, client } = await getOrgConfig(orgId);
    
    await client.post(
      `/${org.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }
    );
    return { success: true };
  } catch (error: any) {
    console.error('❌ Error marking message as read:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

// Download media from WhatsApp
export const getMediaUrl = async (orgId: string, mediaId: string) => {
  try {
    const { client } = await getOrgConfig(orgId);
    const response = await client.get(`/${mediaId}`);
    return {
      success: true,
      url: response.data.url,
      mimeType: response.data.mime_type,
      fileSize: response.data.file_size,
    };
  } catch (error: any) {
    console.error('❌ Error getting media URL:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Download media content from WhatsApp's private URL
 * This function fetches the actual file content using the access token
 * Returns the file as a buffer that can be saved or processed
 */
export const downloadMediaContent = async (orgId: string, mediaId: string) => {
  try {
    const { org } = await getOrgConfig(orgId);
    
    // First, get the media URL
    const mediaInfo = await getMediaUrl(orgId, mediaId);
    if (!mediaInfo.success || !mediaInfo.url) {
      return { success: false, error: 'Failed to get media URL' };
    }

    // Download the actual content using the access token
    const response = await axios.get(mediaInfo.url, {
      headers: {
        'Authorization': `Bearer ${org.accessToken}`
      },
      responseType: 'arraybuffer'
    });

    return {
      success: true,
      buffer: Buffer.from(response.data),
      mimeType: mediaInfo.mimeType,
      fileSize: mediaInfo.fileSize,
      originalUrl: mediaInfo.url
    };
  } catch (error: any) {
    console.error('❌ Error downloading media content:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch templates from Meta Cloud API
 */
/**
 * Create a template on Meta Cloud API
 */
export const createMetaTemplate = async (orgId: string, templateData: any) => {
  try {
    const { org, client } = await getOrgConfig(orgId);

    if (!org.wabaId) {
      throw new Error('Business Account ID (WABA ID) is missing for this organization');
    }

    console.log(`🚀 Sending template to Meta for Org: ${org.name} (${orgId})`);
    console.log(`📦 Template Data:`, JSON.stringify({
      name: templateData.name,
      category: templateData.category,
      language: templateData.language,
      components: templateData.components
    }, null, 2));

    const response = await client.post(`/${org.wabaId}/message_templates`, {
      name: templateData.name,
      category: templateData.category,
      language: templateData.language,
      components: templateData.components,
      allow_category_change: templateData.allow_category_change
    });

    console.log('✅ Meta Template Response:', response.data);

    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    const errorData = error.response?.data || { error: { message: error.message } };
    console.error('❌ Error creating Meta template:', JSON.stringify(errorData, null, 2));
    
    return {
      success: false,
      error: errorData.error?.message || error.message,
      details: errorData.error // Pass full error object for debugging
    };
  }
};

/**
 * Delete a template from Meta Cloud API
 */
export const deleteMetaTemplate = async (orgId: string, templateName: string) => {
  try {
    const { org, client } = await getOrgConfig(orgId);

    if (!org.wabaId) {
      throw new Error('Business Account ID (WABA ID) is missing for this organization');
    }

    const response = await client.delete(`/${org.wabaId}/message_templates`, {
      params: {
        name: templateName
      }
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error: any) {
    console.error('❌ Error deleting Meta template:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.error?.message || error.message 
    };
  }
};

/**
 * Fetch templates from Meta Cloud API
 */
export const getMetaTemplates = async (orgId: string) => {
  try {
    const { org, client } = await getOrgConfig(orgId);

    if (!org.wabaId) {
       throw new Error('Business Account ID (WABA ID) is missing for this organization');
    }

    const response = await client.get(`/${org.wabaId}/message_templates`, {
      params: {
        fields: 'name,status,category,language,components',
        limit: 100
      }
    });

    return {
      success: true,
      templates: response.data.data
    };
  } catch (error: any) {
    console.error('❌ Error fetching Meta templates:', error.response?.data || error.message);
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
};

/**
 * Upload a media asset using Meta's Resumable Upload API to get a header_handle (4::... format)
 * This is required for template creation with media headers.
 * 
 * Step 1: Create upload session (POST /{APP_ID}/uploads)
 * Step 2: Upload file data (POST /{UPLOAD_SESSION_ID})
 */
export const uploadTemplateAssetToMeta = async (orgId: string, file: Express.Multer.File) => {
  try {
    const { org } = await getOrgConfig(orgId);
    
    const accessToken = org.accessToken;
    const appId = '2057829527955130'; // From token debug - the app that owns this token
    
    console.log('📤 Starting Resumable Upload for template asset...');
    console.log(`   File: ${file.originalname}, Size: ${file.size}, Type: ${file.mimetype}`);

    // Step 1: Create upload session
    const sessionResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${appId}/uploads`,
      null,
      {
        params: {
          file_length: file.size,
          file_type: file.mimetype,
          access_token: accessToken
        }
      }
    );
    
    const uploadSessionId = sessionResponse.data.id;
    console.log('✅ Upload session created:', uploadSessionId);

    // Step 2: Upload file data
    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${uploadSessionId}`,
      file.buffer,
      {
        headers: {
          'Authorization': `OAuth ${accessToken}`,
          'file_offset': '0',
          'Content-Type': 'application/octet-stream'
        }
      }
    );

    const handle = uploadResponse.data.h;
    console.log('✅ Resumable upload complete! Handle:', handle);
    
    return {
      success: true,
      handle: handle, // This should be the 4:: format handle
    };
  } catch (error: any) {
    console.error('❌ Error in resumable upload:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
};

/**
 * Upload media to Meta Cloud API for standard messaging
 */
export const uploadMediaToMeta = async (orgId: string, file: Express.Multer.File) => {
  try {
    const { org, client } = await getOrgConfig(orgId);
    
    // Use form-data package for proper Node.js multipart uploads
    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    
    // Append file buffer directly - form-data handles this correctly in Node.js
    formData.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    formData.append('type', file.mimetype);
    formData.append('messaging_product', 'whatsapp');

    const response = await client.post(
      `/${org.phoneNumberId}/media`,
      formData,
      {
        headers: {
          ...formData.getHeaders(), // form-data package provides correct headers
        },
      }
    );

    console.log('✅ Media uploaded successfully:', response.data);
    return {
      success: true,
      mediaId: response.data.id,
    };
  } catch (error: any) {
    console.error('❌ Error uploading media:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message,
    };
  }
};

// Process incoming webhook message
export const processIncomingMessage = async (webhookData: any, explicitOrgId?: string) => {
  const entry = webhookData.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  if (!value) {
    console.log('⚠️ No value in webhook data');
    return null;
  }

  let orgId: string | undefined = explicitOrgId;

  if (!orgId) {
    // Find organization by phone_number_id
    const metadata = value.metadata;
    const phoneNumberId = metadata?.phone_number_id;

    console.log(`📱 Webhook phone_number_id: ${phoneNumberId}`);

    if (!phoneNumberId) {
      console.log('⚠️ No phone_number_id in metadata and no explicit orgId');
      return null;
    }

    const org = await (prisma as any).organization.findFirst({
      where: { phoneNumberId, isActive: true },
    });

    if (!org) {
      // Log all organizations to help debug
      const allOrgs = await (prisma as any).organization.findMany({
        select: { id: true, name: true, phoneNumberId: true, isActive: true }
      });
      console.warn(`⚠️ Organization not found for phone_number_id: ${phoneNumberId}`);
      console.warn(`📋 Available organizations:`, JSON.stringify(allOrgs, null, 2));
      return null;
    }
    orgId = org.id;
    console.log(`✅ Organization matched: ${org.name} (${orgId})`);
  } else {
    console.log(`🔗 Using explicit orgId from URL: ${orgId}`);
  }

  const messages = value.messages;
  const statuses = value.statuses;
  const contacts = value.contacts;

  // LOOP PREVENTION: Check if this message is from the bot's own number
  // Usually happens if send_external is used to notify a number that is the bot itself
  const displayPhoneNumber = value.metadata?.display_phone_number;
  if (messages && messages.length > 0 && displayPhoneNumber) {
    const fromNumber = messages[0].from;
    if (fromNumber === displayPhoneNumber) {
      console.log(`🛡️ Loop Prevention: Ignored message from bot's own number (${displayPhoneNumber})`);
      return { processed: false, reason: 'self_message' };
    }
  }

  // Handle message status updates
  if (statuses && statuses.length > 0) {
    for (const status of statuses) {
      await handleMessageStatus(orgId!, status);
    }
  }

  // Handle incoming messages
  if (messages && messages.length > 0) {
    const contact = contacts?.[0];
    
    for (const message of messages) {
      await handleIncomingMessage(orgId!, message, contact);
    }
  }

  return { processed: true, organizationId: orgId };
};

// Handle incoming message
const handleIncomingMessage = async (orgId: string, message: any, contactInfo: any) => {
  const waId = message.from;
  const messageId = message.id;
  const timestamp = new Date(parseInt(message.timestamp) * 1000);

  // Find or create contact
  let contact = await (prisma as any).contact.findUnique({
    where: { 
      waId_organizationId: {
        waId,
        organizationId: orgId
      }
    },
  });

  if (!contact) {
    contact = await (prisma as any).contact.create({
      data: {
        waId,
        phoneNumber: waId,
        profileName: contactInfo?.profile?.name,
        name: contactInfo?.profile?.name,
        organizationId: orgId,
        tags: '[]',
      },
    });
    console.log('✅ New contact created:', contact.id);
  }

  // Find or create conversation
  let conversation = await (prisma as any).conversation.findFirst({
    where: {
      contactId: contact.id,
      organizationId: orgId,
      status: { in: ['OPEN', 'PENDING'] },
    },
  });

  if (!conversation) {
    // Check if this contact received any broadcast - link to most recent one
    const recentBroadcastRecipient = await (prisma as any).broadcastRecipient.findFirst({
      where: { 
        phoneNumber: waId,
        broadcast: { organizationId: orgId }
      },
      orderBy: { sentAt: 'desc' },
      include: { broadcast: { select: { id: true, name: true } } }
    });

    conversation = await (prisma as any).conversation.create({
      data: {
        contactId: contact.id,
        organizationId: orgId,
        status: 'OPEN',
        tags: '[]',
        // Link to broadcast if found
        broadcastId: recentBroadcastRecipient?.broadcast?.id || null,
        broadcastName: recentBroadcastRecipient?.broadcast?.name || null,
        isReply: !!recentBroadcastRecipient,
      },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            profileName: true,
            phoneNumber: true,
            avatar: true,
          },
        },
        broadcast: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    console.log('✅ New conversation created:', conversation.id, recentBroadcastRecipient ? `(linked to broadcast: ${recentBroadcastRecipient.broadcast.name})` : '');

    // Update broadcast reply count if linked
    if (recentBroadcastRecipient?.broadcast?.id) {
      await (prisma as any).broadcast.update({
        where: { id: recentBroadcastRecipient.broadcast.id },
        data: { replyCount: { increment: 1 } }
      });
    }

    // Emit new conversation event
    if (global.io) {
      global.io.to(`org:${orgId}`).emit('new_conversation', {
        conversation,
      });
    }
  } else if (!conversation.isReply) {
    // Check if this is a reply to a broadcast for an existing conversation
    const recentBroadcastRecipient = await (prisma as any).broadcastRecipient.findFirst({
      where: { 
        phoneNumber: waId,
        broadcast: { organizationId: orgId }
      },
      orderBy: { sentAt: 'desc' },
      include: { broadcast: { select: { id: true, name: true } } }
    });

    if (recentBroadcastRecipient && !conversation.broadcastId) {
      // Update existing conversation with broadcast info
      conversation = await (prisma as any).conversation.update({
        where: { id: conversation.id },
        data: {
          broadcastId: recentBroadcastRecipient.broadcast.id,
          broadcastName: recentBroadcastRecipient.broadcast.name,
          isReply: true,
        }
      });

      // Update broadcast reply count
      await (prisma as any).broadcast.update({
        where: { id: recentBroadcastRecipient.broadcast.id },
        data: { replyCount: { increment: 1 } }
      });

      console.log('✅ Existing conversation linked to broadcast:', recentBroadcastRecipient.broadcast.name);
    }
  }

  // Determine message type and content
  const messageType = getMessageType(message.type);
  let { content, mediaUrl, mediaId, caption } = extractMessageContent(message);

  // Resolve actual media URL from Meta if available
  if (mediaId && ['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'].includes(messageType)) {
      try {
          const mediaRes = await getMediaUrl(orgId, mediaId);
          if (mediaRes.success && mediaRes.url) {
              mediaUrl = mediaRes.url;
              console.log(`🔗 Resolved Meta Media URL: ${mediaUrl.substring(0, 50)}...`);
          }
      } catch (err) {
          console.error('❌ Failed to resolve media URL:', err);
      }
  }

  // Create message record
  const newMessage = await (prisma as any).message.create({
    data: {
      waMessageId: messageId,
      conversationId: conversation.id,
      organizationId: orgId,
      type: messageType,
      content,
      caption,
      mediaUrl,
      mediaId: extractMediaId(message), // Store the Meta Media ID
      direction: Direction.INCOMING,
      status: MessageStatus.DELIVERED,
      timestamp,
      metadata: extractMetadata(message) as any, // Store complex data like orders/flow results
    },
  });

  // Update conversation
  const updatedConv = await (prisma as any).conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: timestamp,
      lastMessagePreview: content?.substring(0, 100) || `[${message.type}]`,
      unreadCount: { increment: 1 },
    },
  });
  console.log(`[Backend] Updated unreadCount for ${conversation.id} to: ${updatedConv.unreadCount}`);

  // Emit real-time event
  if (global.io) {
    global.io.to(`org:${orgId}`).emit('new_message', {
      message: newMessage,
      conversationId: conversation.id,
      conversation: updatedConv,
      contact,
    });
  }

  console.log('✅ Message processed:', newMessage.id);

  // Send push notification to assigned agent if any
  const assignedAgentId = updatedConv.assignedAgentId;
  if (assignedAgentId && Direction.INCOMING === newMessage.direction) {
    const agent = await (prisma as any).user.findUnique({
      where: { id: assignedAgentId },
      select: { pushToken: true, pushNotifications: true }
    });

    if (agent?.pushToken && agent?.pushNotifications !== false) {
      const title = `New message from ${contact.name || contact.phoneNumber}`;
      const body = content || `Received a ${message.type}`;
      
      sendPushNotification(agent.pushToken, title, body, {
        conversationId: conversation.id,
        type: 'NEW_MESSAGE'
      }).catch(err => console.error('❌ Push notification trigger error:', err));
    }
  }

  // Forward to external webhook and trigger chatbot for incoming messages
  if (Direction.INCOMING === newMessage.direction) {
    await forwardToExternalWebhook(orgId, {
      type: 'message',
      data: newMessage,
      contact
    });

    // Check if chatbot is enabled for this conversation (Broadcast override)
    let shouldTriggerChatbot = true;
    if (updatedConv.broadcastId) {
       const broadcast = await (prisma as any).broadcast.findUnique({
         where: { id: updatedConv.broadcastId },
         select: { enableChatbot: true }
       });
       if (broadcast && broadcast.enableChatbot === false) {
         console.log(`🤖 Chatbot SKIPPED for ${contact.phoneNumber} (Broadcast override)`);
         shouldTriggerChatbot = false;
       }
    }

    if (shouldTriggerChatbot) {
      processChatbotFlow(orgId, contact.id, contact.waId, content, newMessage).catch(err => {
        console.error('🤖 Chatbot execution error:', err);
      });
    }
  }

  return newMessage;
};

/**
 * Forward event to external webhook
 */
const forwardToExternalWebhook = async (orgId: string, payload: any) => {
  try {
    const org = await (prisma as any).organization.findUnique({
      where: { id: orgId },
      select: { externalWebhookUrl: true, externalWebhookSecret: true }
    });

    if (!org?.externalWebhookUrl) return;

    console.log(`📡 Forwarding ${payload.type} to external webhook: ${org.externalWebhookUrl}`);

    const headers: any = { 'Content-Type': 'application/json' };
    
    if (org.externalWebhookSecret) {
      const signature = crypto
        .createHmac('sha256', org.externalWebhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');
      headers['X-Hub-Signature-256'] = `sha256=${signature}`;
    }

    await axios.post(org.externalWebhookUrl, payload, { headers, timeout: 5000 });
  } catch (error: any) {
    console.warn(`⚠️ External webhook forwarding failed: ${error.message}`);
  }
};

// Handle message status updates
const handleMessageStatus = async (orgId: string, status: any) => {
  const waMessageId = status.id;
  const newStatus = status.status.toUpperCase();

  try {
    const message = await (prisma as any).message.findFirst({
      where: { waMessageId, organizationId: orgId },
    });

    if (message) {
      const statusMap: Record<string, MessageStatus> = {
        SENT: MessageStatus.SENT,
        DELIVERED: MessageStatus.DELIVERED,
        READ: MessageStatus.READ,
        FAILED: MessageStatus.FAILED,
      };

      await (prisma as any).message.update({
        where: { id: message.id },
        data: {
          status: statusMap[newStatus] || message.status,
          isRead: newStatus === 'READ',
        },
      });

      // Emit real-time event for chat UI
      if (global.io) {
        global.io.to(`org:${orgId}`).emit('message_status', {
          messageId: message.id,
          waMessageId,
          status: newStatus,
        });
      }

      // Forward to external webhook
      await forwardToExternalWebhook(orgId, {
        type: 'status',
        data: {
          messageId: message.id,
          waMessageId,
          status: newStatus,
          timestamp: new Date()
        }
      });
    }

    // --- NEW: Handle BroadcastRecipient status updates ---
    const recipient = await (prisma as any).broadcastRecipient.findFirst({
      where: { waMessageId, status: { not: 'FAILED' } },
      include: { broadcast: true }
    });

    if (recipient) {
      console.log(`📊 Updating BroadcastRecipient status: ${waMessageId} -> ${newStatus}`);
      
      const statusMap: Record<string, MessageStatus> = {
        SENT: MessageStatus.SENT,
        DELIVERED: MessageStatus.DELIVERED,
        READ: MessageStatus.READ,
        FAILED: MessageStatus.FAILED,
      };

      const finalStatus = statusMap[newStatus] || recipient.status;

      // Update recipient status
      await (prisma as any).broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: finalStatus,
          deliveredAt: newStatus === 'DELIVERED' ? new Date() : recipient.deliveredAt,
          readAt: newStatus === 'READ' ? new Date() : recipient.readAt,
        }
      });

      // Update broadcast aggregates
      const updateData: any = {};
      if (newStatus === 'DELIVERED') updateData.deliveredCount = { increment: 1 };
      if (newStatus === 'READ') updateData.readCount = { increment: 1 };
      if (newStatus === 'FAILED') updateData.failedCount = { increment: 1 };

      if (Object.keys(updateData).length > 0) {
        await (prisma as any).broadcast.update({
          where: { id: recipient.broadcastId },
          data: updateData
        });
      }

      // Emit real-time update for reporting UI
      if (global.io) {
        global.io.to(`org:${orgId}`).emit('broadcast_status_update', {
          broadcastId: recipient.broadcastId,
          recipientId: recipient.id,
          status: finalStatus
        });
      }
    }
  } catch (error) {
    console.error('Error updating message status:', error);
  }
};

// Get message type from WhatsApp type
const getMessageType = (waType: string): MessageType => {
  const typeMap: Record<string, MessageType> = {
    text: MessageType.TEXT,
    image: MessageType.IMAGE,
    video: MessageType.VIDEO,
    audio: MessageType.AUDIO,
    document: MessageType.DOCUMENT,
    location: MessageType.LOCATION,
    contacts: MessageType.CONTACTS,
    sticker: MessageType.STICKER,
    interactive: MessageType.INTERACTIVE,
    button: MessageType.BUTTON,
    reaction: MessageType.REACTION,
    // @ts-ignore - ORDER might not be in the enum yet if client is not updated
    order: MessageType.ORDER || 'ORDER',
    template: MessageType.TEMPLATE,
  };
  return typeMap[waType] || MessageType.UNKNOWN;
};

// Helper to extract Media ID
const extractMediaId = (message: any): string | null => {
  const type = message.type;
  if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
    return message[type]?.id || null;
  }
  return null;
};

// Extract content from message based on type
const extractMessageContent = (message: any) => {
  const type = message.type;
  let content = '';
  let mediaUrl = '';
  let mediaId = '';
  let caption = '';

  switch (type) {
    case 'text':
      content = message.text?.body || '';
      break;
    case 'image':
      mediaId = message.image?.id || '';
      mediaUrl = mediaId; // Store ID for resolution later
      caption = message.image?.caption || '';
      content = caption || '[Image]';
      break;
    case 'video':
      mediaId = message.video?.id || '';
      mediaUrl = mediaId;
      caption = message.video?.caption || '';
      content = caption || '[Video]';
      break;
    case 'audio':
      mediaId = message.audio?.id || '';
      mediaUrl = mediaId;
      content = '[Audio]';
      break;
    case 'document':
      mediaId = message.document?.id || '';
      mediaUrl = mediaId;
      caption = message.document?.caption || '';
      content = message.document?.filename || '[Document]';
      break;
    case 'location':
      content = `Location: ${message.location?.latitude}, ${message.location?.longitude}`;
      break;
    case 'contacts':
      content = `[Contact: ${message.contacts?.[0]?.name?.formatted_name || 'Unknown'}]`;
      break;
    case 'sticker':
      mediaUrl = message.sticker?.id || '';
      content = '[Sticker]';
      break;
    case 'order':
      const order = message.order;
      const itemCount = order.product_items?.length || 0;
      content = `🛍️ New Order: ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
      break;
    case 'interactive':
      const interactive = message.interactive;
      if (interactive.type === 'button_reply') {
        content = interactive.button_reply?.title || 'Button Clicked';
      } else if (interactive.type === 'list_reply') {
        content = interactive.list_reply?.title || 'List Item Selected';
      } else if (interactive.type === 'nfm_reply') {
        // Flow reply - Extracting display text if possible, otherwise generic
        const responseData = JSON.parse(interactive.nfm_reply?.response_json || '{}');
        content = `📝 Form Response: ${Object.keys(responseData).length} fields submitted`;
      } else {
        content = '[Interactive Message]';
      }
      break;
    case 'button':
      content = message.button?.text || '[Button Click]';
      break;
    default:
      content = `[${type}]`;
  }

  return { content, mediaUrl, mediaId, caption };
};

// Extract metadata for complex messages
const extractMetadata = (message: any) => {
  const type = message.type;
  let metadata: any = null;

  if (type === 'order') metadata = message.order;
  else if (type === 'interactive') metadata = message.interactive;
  else if (type === 'button') metadata = message.button;
  else if (type === 'location') metadata = message.location;
  else if (type === 'contacts') metadata = message.contacts;

  // Consistently stringify for DB storage
  return metadata ? JSON.stringify(metadata) : null;
};


// Get phone number info
export const getPhoneNumberInfo = async (orgId: string) => {
  try {
    const { org, client } = await getOrgConfig(orgId);
    const response = await client.get(`/${org.phoneNumberId}`);
    return { success: true, data: response.data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
