
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      wabaId: true,
      phoneNumberId: true
    }
  });
  console.log(JSON.stringify(orgs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
