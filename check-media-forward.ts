import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const flow = await prisma.flow.findFirst({ where: { name: 'Hello' }});
  if (!flow) { console.log('Not found'); return; }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  
  // Find media_forward node
  const mediaForward = nodes.find((n: any) => n.type === 'media_forward');
  if (mediaForward) {
    console.log('Media Forward Node found:');
    console.log('  URL:', mediaForward.data?.url);
    console.log('  Media ID Variable:', mediaForward.data?.mediaIdVariable);
    console.log('  Result Variable:', mediaForward.data?.resultVariable);
    console.log('  Field Name:', mediaForward.data?.fieldName);
  }
  
  // Find wait node
  const waitNode = nodes.find((n: any) => n.type === 'wait');
  if (waitNode) {
    console.log('\nWait Node found:');
    console.log('  Variable:', waitNode.data?.variable);
    console.log('  Expected Type:', waitNode.data?.expectedType);
  }
}

main().finally(() => prisma.$disconnect());
