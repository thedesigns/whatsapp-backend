import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const flow = await prisma.flow.findFirst({
    where: { name: 'Hello' }
  });
  
  if (!flow) {
    console.log('Flow not found!');
    return;
  }
  
  const nodes = JSON.parse(flow.nodes || '[]');
  const edges = JSON.parse(flow.edges || '[]');
  
  console.log('=== NODES ===');
  for (const node of nodes) {
    console.log(`- ${node.type} (${node.id})`);
    if (node.data) {
      console.log(`  Data: ${JSON.stringify(node.data).substring(0, 100)}...`);
    }
  }
  
  console.log('\n=== EDGES ===');
  for (const edge of edges) {
    console.log(`- ${edge.source} -> ${edge.target} (handle: ${edge.sourceHandle || 'default'})`);
  }
  
  // Check if start_trigger has outgoing edges
  const startTriggerNode = nodes.find((n: any) => n.type === 'start_trigger');
  if (startTriggerNode) {
    const outgoingEdges = edges.filter((e: any) => e.source === startTriggerNode.id);
    console.log('\n=== START TRIGGER CONNECTIONS ===');
    if (outgoingEdges.length === 0) {
      console.log('⚠️ WARNING: start_trigger has NO outgoing connections!');
      console.log('Creating connection to first available node...');
      
      // Find a node that could be the next step (message, button, etc.)
      const nextNode = nodes.find((n: any) => 
        n.type !== 'start_trigger' && 
        n.type !== 'input' && 
        !edges.some((e: any) => e.target === n.id)
      );
      
      if (nextNode) {
        edges.push({
          id: `e-start-${nextNode.id}`,
          source: startTriggerNode.id,
          target: nextNode.id,
          sourceHandle: 'default'
        });
        
        await prisma.flow.update({
          where: { id: flow.id },
          data: { edges: JSON.stringify(edges) }
        });
        
        console.log(`✅ Connected start_trigger to ${nextNode.type} (${nextNode.id})`);
      } else {
        console.log('No suitable node found to connect to');
      }
    } else {
      console.log('✅ start_trigger has connections:', outgoingEdges);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
