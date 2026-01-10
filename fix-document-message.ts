import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const flow = await prisma.flow.findFirst({ where: { name: 'Hello' }});
  if (!flow) { console.log('Not found'); return; }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  const edges = JSON.parse(flow.edges || '[]');
  
  // Find the message node that outputs {{document}}
  const docMsgNodeIdx = nodes.findIndex((n: any) => n.data?.message === '{{document}}');
  
  if (docMsgNodeIdx >= 0) {
    const oldNode = nodes[docMsgNodeIdx];
    console.log('Found message node at index:', docMsgNodeIdx);
    console.log('Replacing with a proper confirmation message...');
    
    // Change the message to confirm receipt instead of trying to send the URL
    nodes[docMsgNodeIdx] = {
      ...oldNode,
      data: {
        ...oldNode.data,
        message: '✅ Thank you! We received your document.\n\n📄 File: {{document}}'
      }
    };
    
    await prisma.flow.update({
      where: { id: flow.id },
      data: { nodes: JSON.stringify(nodes) }
    });
    
    console.log('✅ Updated message node to show confirmation instead of URL');
    console.log('New message:', nodes[docMsgNodeIdx].data.message);
  } else {
    console.log('No {{document}} message node found');
  }
}

main().finally(() => prisma.$disconnect());
