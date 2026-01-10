import { Request, Response } from 'express';
import crypto from 'crypto';
import { integrationService } from '../services/integrationService.js';

/**
 * Verify WooCommerce Webhook Signature
 */
const verifyWooCommerceSignature = (req: Request, secret: string): boolean => {
  const signature = req.headers['x-wc-webhook-signature'] as string;
  if (!signature) return false;

  const payload = req.body instanceof Buffer ? req.body : JSON.stringify(req.body);
  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('base64');

  return generatedSignature === signature;
};

export const handleWooCommerceWebhook = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const topic = req.headers['x-wc-webhook-topic'] as string;
  const source = req.headers['x-wc-webhook-source'] as string;

  console.log(`🛒 [WooCommerce Webhook] ${topic} received from ${source} (Org: ${orgId})`);

  try {
    const config = await integrationService.getIntegrationConfig(orgId, 'WOOCOMMERCE');
    
    // Verify signature if secret is configured
    if (config?.webhookSecret) {
      if (!verifyWooCommerceSignature(req, config.webhookSecret)) {
        console.warn('⚠️ [WooCommerce] Invalid signature');
        res.status(401).send('Unauthorized');
        return;
      }
    }

    const payload = req.body;
    await integrationService.logEvent(orgId, 'woocommerce', topic, payload);

    // Business Logic based on Topic
    // WooCommerce topics: action.woocommerce_checkout_order_processed, action.woocommerce_order_status_changed, etc.
    // Or simpler: order.created, order.updated, product.created
    
    switch (topic) {
      case 'order.created':
        // Order Received - Initial creation
        if (payload.billing && payload.billing.phone) {
          await integrationService.sendOrderNotification(
            orgId,
            payload.billing.phone,
            'order_received',
            {
              order_number: payload.number,
              customer_name: payload.billing.first_name || 'Customer',
              total_price: payload.total
            }
          );
        }
        break;

      case 'order.updated':
        // Check for specific status changes
        const status = payload.status;
        const phone = payload.billing?.phone;
        
        if (!phone) break;

        if (status === 'processing') {
          // Order Confirmed
          await integrationService.sendOrderNotification(
            orgId,
            phone,
            'order_confirmed',
            {
              order_number: payload.number,
              customer_name: payload.billing.first_name || 'Customer'
            }
          );
        } else if (status === 'completed') {
          // Order Shipped / Completed
          await integrationService.sendOrderNotification(
            orgId,
            phone,
            'order_shipped',
            {
              order_number: payload.number,
              customer_name: payload.billing.first_name || 'Customer'
            }
          );
        } else if (status === 'cancelled') {
          // Order Cancelled
          await integrationService.sendOrderNotification(
            orgId,
            phone,
            'order_cancelled',
            {
              order_number: payload.number,
              customer_name: payload.billing.first_name || 'Customer'
            }
          );
        }
        break;

      // Abandoned cart for WooCommerce usually requires a plugin that triggers a custom webhook
      // or we hook into 'action.woocommerce_checkout_order_processed' before completion.
      // For this implementation, we'll assume a similar pattern if the user sends checkout data.
      case 'checkout.created': // Hypothetical common custom webhook for abandoned cart
        if (payload.billing && payload.billing.phone) {
          await integrationService.scheduleAbandonedCart(
            orgId,
            payload.billing.phone,
            payload.id.toString(), // External ID
            {
              customer_name: payload.billing.first_name || 'Customer',
              cart_url: payload.cart_url || '',
              total_price: payload.total
            },
            60
          );
        }
        break;

      default:
        console.log(`ℹ️ [WooCommerce] Unhandled topic: ${topic}`);
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error('❌ [WooCommerce Webhook Error]:', error.message);
    res.sendStatus(500);
  }
};
