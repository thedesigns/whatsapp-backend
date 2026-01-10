
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const token = process.env.WHATSAPP_ACCESS_TOKEN;
const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;

async function debug() {
  try {
    console.log('--- Checking WABA ID ---');
    const res = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}?access_token=${token}`);
    console.log('WABA Info:', JSON.stringify(res.data, null, 2));
  } catch (e: any) {
    console.error('WABA Check Failed:', e.response?.data || e.message);
  }
}

debug();
