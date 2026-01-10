import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function setup() {
  console.log('🚀 Setting up default organization and linking admin...');
  try {
    // 1. Create or get default organization
    let org = await (prisma as any).organization.findFirst({
      where: { name: 'Default Organization' }
    });

    if (!org) {
      org = await (prisma as any).organization.create({
        data: {
          name: 'Default Organization',
          wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '566546662747506',
          phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '658261390699917',
          verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'bizwhatznew2026',
          accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
          isActive: true,
        }
      });
      console.log('✅ Created Default Organization');
    } else {
      console.log('ℹ️  Default Organization already exists.');
    }

    // 2. Link Super Admin to this organization
    const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@antigravity.com';
    const admin = await (prisma as any).user.findUnique({
      where: { email: adminEmail }
    });

    if (admin) {
      await (prisma as any).user.update({
        where: { id: admin.id },
        data: { organizationId: org.id }
      });
      console.log(`✅ Linked Super Admin (${adminEmail}) to Organization: ${org.name}`);
    } else {
      console.log('❌ Super Admin not found. Run bootstrap first.');
    }

  } catch (error) {
    console.error('❌ Setup failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

setup();
