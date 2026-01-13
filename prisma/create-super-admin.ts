// Script to create/update Super Admin user
// Run with: npx ts-node prisma/create-super-admin.ts

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'bizwhatz@gmail.com';
  const password = 'bizwhatz@123';
  const hashedPassword = await bcrypt.hash(password, 10);

  // Check if user exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    // Update existing user
    const updated = await prisma.user.update({
      where: { email },
      data: {
        password: hashedPassword,
        role: 'SUPER_ADMIN',
        name: 'Super Admin',
        isActive: true,
      },
    });
    console.log('✅ Super Admin updated:', updated.email);
  } else {
    // Create new user
    const created = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });
    console.log('✅ Super Admin created:', created.email);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
