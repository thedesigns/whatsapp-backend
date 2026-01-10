import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany();
  console.log('Organizations:', JSON.stringify(orgs, null, 2));
  
  const users = await prisma.user.findMany({ select: { email: true, organizationId: true } });
  console.log('Users:', JSON.stringify(users, null, 2));

  const templates = await prisma.template.findMany();
  console.log('Templates count:', templates.length);

  const contacts = await prisma.contact.findMany();
  console.log('Contacts count:', contacts.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
