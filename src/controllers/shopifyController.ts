import { Request, Response } from 'express';
import crypto from 'crypto';
import { integrationService } from '../services/integrationService.js';

/**
 * Verify Shopify Webhook HMAC
 */
const verifyShopifyHMAC = (req: Request, secret: string): boolean => {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  if (!hmac) return false;

  const generatedHash = crypto
    .createHmac('sha256', secret)
    .update(req.body instanceof Buffer ? req.body : JSON.stringify(req.body))
    .digest('base64');

  return generatedHash === hmac;
};

export const handleShopifyWebhook = async (req: Request, res: Response): Promise<void> => {
  const { orgId } = req.params;
  const topic = req.headers['x-shopify-topic'] as string;
  const shop = req.headers['x-shopify-shop-domain'] as string;

  console.log(`🔌 [Shopify Webhook] ${topic} received for ${shop} (Org: ${orgId})`);

  try {
    const config = await integrationService.getIntegrationConfig(orgId, 'SHOPIFY');
    
    // Verify HMAC if secret is configured
    const secret = config?.webhookSecret || config?.clientSecret;
    if (secret) {
      if (!verifyShopifyHMAC(req, secret)) {
        console.warn('⚠️ [Shopify] Invalid HMAC signature');
        res.status(401).send('Unauthorized');
        return;
      }
    }

    const payload = req.body;
    await integrationService.logEvent(orgId, 'shopify', topic, payload);

    // Business Logic based on Topic
    // Business Logic based on Topic
    switch (topic) {
      case 'checkouts/create':
      case 'checkouts/update':
        // Abandoned Cart Logic
        if (payload.customer && payload.customer.phone) {
          // Extract product image URL if available
          const firstItem = payload.line_items?.[0];
          const imageUrl = firstItem?.image_url || '';

          await integrationService.scheduleAbandonedCart(
            orgId,
            payload.customer.phone,
            payload.token, // External ID (Checkout Token)
            {
              customer_name: payload.customer.first_name || 'Customer',
              cart_url: payload.abandoned_checkout_url,
              total_price: payload.total_price,
              image_url: imageUrl,
              product_name: firstItem?.title || 'Items in your cart'
            },
            60 // 60 minutes delay
          );
        }
        break;

      case 'orders/create':
        // Cancel abandoned cart reminder if order is placed
        if (payload.checkout_token) {
          await integrationService.cancelScheduledNotification(orgId, payload.checkout_token);
        }
        
        // Send "Order Received" notification
        if (payload.customer && payload.customer.phone) {
          await integrationService.sendOrderNotification(
            orgId,
            payload.customer.phone,
            'order_received',
            {
              order_number: payload.name,
              customer_name: payload.customer.first_name || 'Customer',
              total_price: payload.total_price
            }
          );
        }
        break;

      case 'orders/paid':
        // Send "Order Confirmed" notification
        if (payload.customer && payload.customer.phone) {
          await integrationService.sendOrderNotification(
            orgId,
            payload.customer.phone,
            'order_confirmed',
            {
              order_number: payload.name,
              customer_name: payload.customer.first_name || 'Customer'
            }
          );
        }
        break;

      case 'orders/fulfilled':
        // Send "Order Shipped" notification
        if (payload.customer && payload.customer.phone) {
          await integrationService.sendOrderNotification(
            orgId,
            payload.customer.phone,
            'order_shipped',
            {
              order_number: payload.name,
              customer_name: payload.customer.first_name || 'Customer',
              tracking_number: payload.fulfillments?.[0]?.tracking_number || 'N/A',
              tracking_url: payload.fulfillments?.[0]?.tracking_urls?.[0] || ''
            }
          );
        }
        break;

      case 'orders/cancelled':
        // Send "Order Cancelled" notification
        if (payload.customer && payload.customer.phone) {
          await integrationService.sendOrderNotification(
            orgId,
            payload.customer.phone,
            'order_cancelled',
            {
              order_number: payload.name,
              customer_name: payload.customer.first_name || 'Customer'
            }
          );
        }
        break;

      default:
        console.log(`ℹ️ [Shopify] Unhandled topic: ${topic}`);
    }

    res.sendStatus(200);
  } catch (error: any) {
    console.error('❌ [Shopify Webhook Error]:', error.message);
    res.sendStatus(500);
  }
};
