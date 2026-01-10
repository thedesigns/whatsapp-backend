import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const org = await (prisma as any).organization.findFirst();
  if (!org) {
    console.log('No organization found');
    return;
  }

  // 1. Link the admin user if needed
  await (prisma as any).user.updateMany({
    where: { email: 'bizwhatz@gmail.com', organizationId: null },
    data: { organizationId: org.id, role: 'SUPER_ADMIN' }
  });
  console.log('✅ Admin user linked to organization');

  // 2. Create some mock contacts if low
  const contactCount = await (prisma as any).contact.count();
  if (contactCount < 5) {
     await (prisma as any).contact.createMany({
       data: [
         { waId: '919876543210', phoneNumber: '+91 98765 43210', name: 'John Doe', organizationId: org.id, tags: '[]' },
         { waId: '919876543211', phoneNumber: '+91 98765 43211', name: 'Jane Smith', organizationId: org.id, tags: '[]' },
         { waId: '919876543212', phoneNumber: '+91 98765 43212', name: 'Bob Wilson', organizationId: org.id, tags: '[]' },
       ]
     });
     console.log('✅ Mock contacts created');
  }

  // 3. Create mock conversations if empty
  const convCount = await (prisma as any).conversation.count();
  if (convCount === 0) {
    const contacts = await (prisma as any).contact.findMany({ take: 3 });
    for (const contact of contacts) {
      const conv = await (prisma as any).conversation.create({
        data: {
          contactId: contact.id,
          organizationId: org.id,
          status: 'OPEN',
          lastMessagePreview: 'Hello, how can I help you?',
          lastMessageAt: new Date(),
          tags: '[]'
        }
      });
      // Add a few messages
      await (prisma as any).message.createMany({
        data: [
          { 
            conversationId: conv.id, 
            organizationId: org.id, 
            content: 'Hi there!', 
            direction: 'INCOMING', 
            status: 'READ',
            timestamp: new Date(Date.now() - 3600000)
          },
          { 
            conversationId: conv.id, 
            organizationId: org.id, 
            content: 'Hello! How can I assist you today?', 
            direction: 'OUTGOING', 
            status: 'READ',
            timestamp: new Date()
          }
        ]
      });
    }
    console.log('✅ Mock conversations and messages created');
  }

  // 4. Create mock broadcasts if empty
  const broadcastCount = await (prisma as any).broadcast.count();
  if (broadcastCount === 0) {
    await (prisma as any).broadcast.create({
      data: {
        name: 'Welcome Campaign',
        templateName: 'hello_world',
        templateLanguage: 'en_US',
        status: 'COMPLETED',
        totalRecipients: 50,
        sentCount: 50,
        deliveredCount: 48,
        readCount: 35,
        failedCount: 2,
        organizationId: org.id,
        completedAt: new Date()
      }
    });
    console.log('✅ Mock broadcast campaign created');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
