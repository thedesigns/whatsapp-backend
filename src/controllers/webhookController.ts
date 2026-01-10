import { Request, Response } from 'express';
import { processIncomingMessage } from '../services/whatsappService.js';
import { prisma } from '../config/database.js';
import { WHATSAPP_CONFIG } from '../config/whatsapp.js';

// Handle webhook verification (GET)
export const verifyWebhook = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log(`🔔 Webhook verification request received for Org: ${orgId || 'Legacy'}`);

  let verifyToken = WHATSAPP_CONFIG.verifyToken;

  // If orgId is provided, fetch specific token from DB
  if (orgId) {
    const org = await (prisma as any).organization.findUnique({
      where: { id: orgId },
      select: { verifyToken: true }
    });
    if (org?.verifyToken) {
      verifyToken = org.verifyToken;
    }
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified successfully!');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Webhook verification failed');
    res.sendStatus(403);
  }
};

// Handle incoming webhook messages (POST)
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  // Always respond with 200 OK IMMEDIATELY to prevent Meta/WhatsApp from retrying
  // Meta expects a response within ~10 seconds. Long-running bot logic should be in the background.
  res.sendStatus(200);

  try {
    const { orgId } = req.params;
    
    // Parse body if it's a Buffer (from raw middleware)
    let body = req.body;
    if (Buffer.isBuffer(body)) {
      body = JSON.parse(body.toString());
    }

    console.log(`📩 Webhook received for Org: ${orgId || 'Auto-detect'}:`, JSON.stringify(body, null, 2));

    // Check if this is a WhatsApp webhook
    if (body.object !== 'whatsapp_business_account') {
      console.log('⚠️ Not a WhatsApp webhook');
      return;
    }

    // Process the incoming message in the background
    // We don't await here because we already sent 200 OK
    processIncomingMessage(body, orgId).catch(error => {
      console.error('❌ Error processing incoming message in background:', error);
    });

  } catch (error) {
    console.error('❌ Error in webhook controller:', error);
  }
};

// Get webhook status (for testing)
export const getWebhookStatus = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.query;
  
  let verifyToken = WHATSAPP_CONFIG.verifyToken;
  let status = 'active';

  if (orgId) {
    const org = await (prisma as any).organization.findUnique({
      where: { id: orgId as string }
    });
    if (org) {
      verifyToken = org.verifyToken || 'not configured';
      status = org.isActive ? 'active' : 'inactive';
    }
  }

  res.json({
    status,
    verifyToken: verifyToken ? 'configured' : 'not configured',
    timestamp: new Date().toISOString(),
  });
};
