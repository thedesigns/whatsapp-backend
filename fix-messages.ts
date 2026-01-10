import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const flow = await prisma.flow.findFirst({ where: { name: 'Hello' }});
  if (!flow) { console.log('Not found'); return; }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  
  // Find the FAIL message node and update it to show the error
  const failMsgIdx = nodes.findIndex((n: any) => n.id === 'message_1767900876645');
  if (failMsgIdx >= 0) {
    nodes[failMsgIdx].data.message = '❌ Upload failed!\n\nError: {{media_forward_error}}';
    console.log('Updated fail message to show error');
  }
  
  // Find success message and update
  const successMsgIdx = nodes.findIndex((n: any) => n.id === 'message_1767900867293');
  if (successMsgIdx >= 0) {
    nodes[successMsgIdx].data.message = '✅ Document uploaded successfully!\n\n📁 Result: {{document_result}}';
    console.log('Updated success message');
  }
  
  await prisma.flow.update({
    where: { id: flow.id },
    data: { nodes: JSON.stringify(nodes) }
  });
  
  console.log('✅ Flow updated!');
}

main().finally(() => prisma.$disconnect());
