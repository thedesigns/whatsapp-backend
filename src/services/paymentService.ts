import Razorpay from 'razorpay';
import Stripe from 'stripe';

export const createRazorpayLink = async (
  amount: number,
  currency: string = 'INR',
  description: string,
  keyId: string,
  keySecret: string,
  customer?: { name?: string; email?: string; contact?: string }
) => {
  try {
    const instance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const link = await instance.paymentLink.create({
      amount: Math.round(amount * 100), // Razorpay expects subunits (paise)
      currency: currency.toUpperCase(),
      description: description,
      customer: {
        name: customer?.name || 'Customer',
        email: customer?.email || 'customer@example.com',
        contact: customer?.contact?.replace(/[^0-9]/g, '') || '', // Clean phone
      },
      notify: {
        sms: true,
        email: true,
      },
      reminder_enable: true,
    });

    return {
      id: link.id,
      short_url: link.short_url,
      status: link.status
    };
  } catch (error) {
    console.error('Razorpay Link Error:', error);
    throw new Error('Failed to generate Razorpay link');
  }
};

export const createStripeLink = async (
  amount: number,
  currency: string = 'usd',
  description: string,
  secretKey: string,
  customer?: { email?: string }
) => {
  try {
    const stripe = new Stripe(secretKey, {
      apiVersion: '2025-12-15.clover' as any, // Cast to any to bypass strict type check for now if needed, or use specific version
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: description,
            },
            unit_amount: Math.round(amount * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://example.com/success', // Placeholder
      cancel_url: 'https://example.com/cancel', // Placeholder
      customer_email: customer?.email,
    });

    return {
      id: session.id,
      short_url: session.url, // Stripe Checkout URL
      status: 'created'
    };
  } catch (error) {
    console.error('Stripe Link Error:', error);
    throw new Error('Failed to generate Stripe link');
  }
};
