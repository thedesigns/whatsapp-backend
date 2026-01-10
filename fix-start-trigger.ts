import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Get the 'Hello' flow and update its start_trigger node
  const flow = await prisma.flow.findFirst({
    where: { name: 'Hello' }
  });
  
  if (!flow) {
    console.log('Flow not found!');
    return;
  }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  const startTriggerIdx = nodes.findIndex((n: any) => n.type === 'start_trigger');
  
  if (startTriggerIdx >= 0) {
    // Update the start_trigger node with proper configuration
    nodes[startTriggerIdx].data = {
      ...nodes[startTriggerIdx].data,
      label: 'Start Trigger',
      triggerMode: 'keywords',
      keywords: ['HI', 'HELLO', 'hi', 'hello'],
      caseSensitive: false,
      partialMatch: false
    };
    
    await prisma.flow.update({
      where: { id: flow.id },
      data: { 
        nodes: JSON.stringify(nodes),
        isDefault: true  // Also make it the default flow
      }
    });
    
    console.log('✅ Updated start_trigger node with HI keyword');
    console.log('Updated node data:', JSON.stringify(nodes[startTriggerIdx].data, null, 2));
  } else {
    console.log('No start_trigger node found in this flow');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
