import { Request, Response } from 'express';
import crypto from 'crypto';
import { WHATSAPP_CONFIG } from '../config/whatsapp.js';

// Verify webhook signature from WhatsApp
export const verifyWebhookSignature = (
  req: Request,
  res: Response,
  next: () => void
): void => {
  // Handle GET request for webhook verification
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === WHATSAPP_CONFIG.verifyToken) {
      console.log('✅ Webhook verified successfully');
      res.status(200).send(challenge);
      return;
    } else {
      console.log('❌ Webhook verification failed');
      res.sendStatus(403);
      return;
    }
  }

  // Handle POST request - verify signature
  if (req.method === 'POST') {
    const signature = req.headers['x-hub-signature-256'] as string;
    
    if (!signature) {
      console.log('⚠️ No signature found in request');
      // Still process the request in development
      if (process.env.NODE_ENV === 'development') {
        next();
        return;
      }
      res.sendStatus(401);
      return;
    }

    const payload = req.body;
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', WHATSAPP_CONFIG.accessToken)
      .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
      .digest('hex');

    if (signature !== expectedSignature) {
      console.log('❌ Invalid webhook signature');
      if (process.env.NODE_ENV === 'development') {
        next();
        return;
      }
      res.sendStatus(401);
      return;
    }

    next();
  }
};
