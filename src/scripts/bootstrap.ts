import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function bootstrap() {
  console.log('🚀 Starting Super Admin bootstrap...');
  try {
    const email = process.env.SUPER_ADMIN_EMAIL || 'admin@antigravity.com';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
    const name = 'System Super Admin';

    // Check if any Super Admin exists
    const existing = await (prisma as any).user.findFirst({
      where: { role: 'SUPER_ADMIN' }
    });

    if (existing) {
      console.log('ℹ️  Super Admin already exists.');
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await (prisma as any).user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: 'SUPER_ADMIN',
        isActive: true,
      }
    });

    console.log(`✅ Super Admin created successfully!`);
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 Password: ${password}`);
    console.log(`⚠️  For security, please change this password after your first login.`);

  } catch (error) {
    console.error('❌ Bootstrap failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap();
