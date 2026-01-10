import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// WhatsApp Cloud API Configuration
export const WHATSAPP_CONFIG = {
  apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
};

// Create axios instance for a specific organization
export const getWhatsappClient = (accessToken: string, apiVersion: string = WHATSAPP_CONFIG.apiVersion): AxiosInstance => {
  return axios.create({
    baseURL: `https://graph.facebook.com/${apiVersion}`,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
};

// Legacy instance (for transition, pointing to default credentials)
export const whatsappApi: AxiosInstance = getWhatsappClient(WHATSAPP_CONFIG.accessToken);

// Validate a specific configuration
export const validateConfig = (config: { accessToken: string; phoneNumberId: string }): boolean => {
  return !!(config.accessToken && config.phoneNumberId);
};

// Validate environment configuration (Legacy)
export const validateWhatsAppConfig = (): boolean => {
  const required = ['accessToken', 'phoneNumberId', 'verifyToken'];
  const missing = required.filter(
    key => !WHATSAPP_CONFIG[key as keyof typeof WHATSAPP_CONFIG]
  );
  
  if (missing.length > 0) {
    console.warn(`⚠️ Missing WhatsApp environment configuration: ${missing.join(', ')}`);
    return false;
  }
  
  return true;
};
