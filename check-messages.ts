import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const flow = await prisma.flow.findFirst({ where: { name: 'Hello' }});
  if (!flow) { console.log('Not found'); return; }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  
  console.log('All message nodes:');
  nodes.filter((n: any) => n.type === 'message').forEach((n: any) => {
    console.log('-', n.id);
    console.log('  Message:', n.data?.message);
  });
}

main().finally(() => prisma.$disconnect());
