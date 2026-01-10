import axios from 'axios';

const BACKEND_URL = 'http://localhost:3000';
const ORG_ID = 'test-org-id'; // You'll need a valid Org ID from your DB

const testShopifyWebhook = async () => {
  console.log('🚀 Testing Shopify Webhook (Order Create)...');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/integrations/shopify/webhook/${ORG_ID}`, {
      name: '#1001',
      total_price: '150.00',
      checkout_token: 'check_abc_123',
      customer: {
        first_name: 'John',
        phone: '+1234567890'
      }
    }, {
      headers: {
        'x-shopify-topic': 'orders/create',
        'x-shopify-shop-domain': 'test-store.myshopify.com'
      }
    });
    console.log('✅ Shopify Test Status:', response.status);
  } catch (error: any) {
    console.error('❌ Shopify Test Failed:', error.response?.data || error.message);
  }
};

const testWooCommerceWebhook = async () => {
  console.log('🚀 Testing WooCommerce Webhook (Order Created)...');
  try {
    const response = await axios.post(`${BACKEND_URL}/api/integrations/woocommerce/webhook/${ORG_ID}`, {
      number: 'WC-1001',
      total: '200.00',
      status: 'processing',
      billing: {
        first_name: 'Jane',
        phone: '+0987654321'
      }
    }, {
      headers: {
        'x-wc-webhook-topic': 'order.created',
        'x-wc-webhook-source': 'https://example-store.com'
      }
    });
    console.log('✅ WooCommerce Test Status:', response.status);
  } catch (error: any) {
    console.error('❌ WooCommerce Test Failed:', error.response?.data || error.message);
  }
};

// Uncomment to run locally if needed
// testShopifyWebhook();
// testWooCommerceWebhook();
