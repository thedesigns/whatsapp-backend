import { prisma } from '../config/database.js';
import { sendWhatsAppMessage } from './whatsappService.js';
import axios from 'axios';
import fs from 'fs';
import { createRazorpayLink, createStripeLink } from './paymentService.js';

interface Node {
  id: string;
  type: string;
  data: any;
}

interface Edge {
  source: string;
  target: string;
  sourceHandle?: string;
}

export const processChatbotFlow = async (orgId: string, contactId: string, waId: string, messageText: string, messageData: any = {}) => {
  try {
    // 1. Check for trigger keywords FIRST (Exact matches should override sessions)
    let triggeredFlow = await (prisma as any).flow.findFirst({
      where: { 
        organizationId: orgId, 
        isActive: true,
        triggerKeyword: { equals: messageText.trim().toUpperCase() } 
      },
      orderBy: { isDefault: 'desc' } // Prioritize default flow if keywords collide
    });

    // 2. Check for active session
    let session = await (prisma as any).flowSession.findUnique({
      where: { contactId_organizationId: { contactId, organizationId: orgId } },
      include: { flow: true, contact: true }
    });

    // 3. Handle session logic or flow start
    if (triggeredFlow) {
      if (session && session.flowId !== triggeredFlow.id) {
        console.log(`🔀 Switching session from ${session.flow.name} to ${triggeredFlow.name} via keyword trigger`);
        session = await (prisma as any).flowSession.update({
          where: { id: session.id },
          data: {
            flowId: triggeredFlow.id,
            currentNodeId: 'start',
            variables: '{}',
            lastInteraction: new Date()
          },
          include: { flow: true, contact: true }
        });
      } else if (!session) {
        session = await (prisma as any).flowSession.create({
          data: {
            contactId,
            organizationId: orgId,
            flowId: triggeredFlow.id,
            currentNodeId: 'start',
            variables: '{}',
            lastInteraction: new Date()
          },
          include: { flow: true, contact: true }
        });
      } else {
        session = await (prisma as any).flowSession.update({
          where: { id: session.id },
          data: {
            currentNodeId: 'start',
            lastInteraction: new Date()
          },
          include: { flow: true, contact: true }
        });
      }
    } else if (session) {
      let currentVars: any = {};
      try { currentVars = JSON.parse(session.variables); } catch {}
      
      const timeout = currentVars['_session_timeout'] || session.flow.sessionTimeout || 3600;
      const lastInteraction = new Date(session.lastInteraction).getTime();
      const now = Date.now();
      
      if (now - lastInteraction > timeout * 1000) {
        console.log(`⏰ Session expired for ${waId}, looking for fallback...`);
        session = null;
      } else {
        await (prisma as any).flowSession.update({
          where: { id: session.id },
          data: { lastInteraction: new Date() }
        });
      }
    }

    // 4. Fallback to catch-all or default if no session
    if (!session) {
      let fallbackFlow = await (prisma as any).flow.findFirst({
        where: { 
          organizationId: orgId, 
          isActive: true,
          triggerKeyword: '*'
        },
        orderBy: { isDefault: 'desc' }
      });

      // NEW: Check for flows with start_trigger nodes that match the message
      if (!fallbackFlow) {
        const allActiveFlows = await (prisma as any).flow.findMany({
          where: { 
            organizationId: orgId, 
            isActive: true
          },
          orderBy: { isDefault: 'desc' }
        });

        for (const flow of allActiveFlows) {
          try {
            const nodesJson = JSON.parse(flow.nodes || '[]');
            const startTriggerNode = nodesJson.find((n: any) => n.type === 'start_trigger');
            
            if (startTriggerNode) {
              const triggerMode = startTriggerNode.data?.triggerMode || 'any';
              
              if (triggerMode === 'any') {
                // This flow accepts any message - use it as fallback
                console.log(`🌐 Found start_trigger with "any" mode in flow: ${flow.name}`);
                fallbackFlow = flow;
                break;
              } else if (triggerMode === 'keywords') {
                // Check if any keyword matches
                const keywords = startTriggerNode.data?.keywords || [];
                const caseSensitive = startTriggerNode.data?.caseSensitive || false;
                const partialMatch = startTriggerNode.data?.partialMatch || false;
                const userMessage = caseSensitive ? messageText.trim() : messageText.trim().toLowerCase();
                
                for (const keyword of keywords) {
                  const compareKeyword = caseSensitive ? keyword : keyword.toLowerCase();
                  
                  if (partialMatch) {
                    if (userMessage.includes(compareKeyword)) {
                      console.log(`🎯 Matched keyword "${keyword}" in start_trigger of flow: ${flow.name}`);
                      fallbackFlow = flow;
                      break;
                    }
                  } else {
                    if (userMessage === compareKeyword) {
                      console.log(`🎯 Matched keyword "${keyword}" in start_trigger of flow: ${flow.name}`);
                      fallbackFlow = flow;
                      break;
                    }
                  }
                }
                
                if (fallbackFlow) break;
              }
            }
          } catch (e) {
            console.warn(`⚠️ Failed to parse nodes for flow ${flow.id}:`, e);
          }
        }
      }

      if (!fallbackFlow) {
        fallbackFlow = await (prisma as any).flow.findFirst({
          where: { 
            organizationId: orgId, 
            isActive: true,
            isDefault: true
          }
        });
      }

      if (fallbackFlow) {
        // Check working hours for the fallback flow
        if (fallbackFlow.workingHours && !checkWorkingHours(fallbackFlow.workingHours)) {
           console.log(`⏰ Outside working hours for flow: ${fallbackFlow.name}`);
           return;
        }

        session = await (prisma as any).flowSession.create({
          data: {
            contactId,
            organizationId: orgId,
            flowId: fallbackFlow.id,
            currentNodeId: 'start',
            variables: '{}',
            lastInteraction: new Date()
          },
          include: { flow: true, contact: true }
        });
      }
    }

    if (!session) {
      console.log(`❌ No matching flow or session for: "${messageText}"`);
      return;
    }

    // 4. Execute nodes
    await executeFlow(session, waId, messageText, messageData);

  } catch (error) {
    console.error('❌ Chatbot process error:', error);
  }
};

// Check if current time is within working hours
const checkWorkingHours = (workingHoursJson: string): boolean => {
  try {
    const config = JSON.parse(workingHoursJson);
    // Expected format: { days: [0,1,2,3,4,5], startHour: 9, endHour: 18 }
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday
    const hour = now.getHours();

    if (config.days && !config.days.includes(day)) return false;
    if (config.startHour !== undefined && hour < config.startHour) return false;
    if (config.endHour !== undefined && hour >= config.endHour) return false;
    
    return true;
  } catch {
    return true; // If parsing fails, allow execution
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const executeFlow = async (session: any, waId: string, lastInput: string, inputData: any = {}) => {
  const log = (msg: string) => {
    console.log(msg);
    try {
      fs.appendFileSync('/Users/sameers/Desktop/whatsppbusinesapi/backend/debug.log', `${new Date().toISOString()} ${msg}\n`);
    } catch {}
  };

  log(`\n🤖 [Chatbot] >>> EXECUTING FLOW: ${session.flow.name} for ${waId} <<<`);
  const nodes: Node[] = JSON.parse(session.flow.nodes);
  const edges: Edge[] = JSON.parse(session.flow.edges);
  let variables = JSON.parse(session.variables);

  // Auto-capture sender info
  variables['sender_mobile'] = waId;
  if (session.contact) {
      variables['sender_name'] = session.contact.name || session.contact.profileName || 'Customer';
  }

  // Inject system variables
  const actualType = (inputData.type || 'text').toString().toLowerCase();
  let resolvedInput = lastInput;

  // For interactive messages (buttons/lists), if text is empty, try to get title from metadata
  if (actualType === 'interactive' && !resolvedInput) {
      const metadata = typeof inputData.metadata === 'string' ? JSON.parse(inputData.metadata) : inputData.metadata;
      if (metadata?.type === 'button_reply') resolvedInput = metadata.button_reply?.title || '';
      else if (metadata?.type === 'list_reply') resolvedInput = metadata.list_reply?.title || '';
  }

  if (actualType === 'text' || actualType === 'interactive') {
      variables['last_input'] = resolvedInput;
      log(`📥 Captured last_input: "${resolvedInput}" (${actualType})`);
  } else {
      // For media types, store both the URL and the mediaId
      variables['last_input'] = inputData.caption || `[${actualType.toUpperCase()}]`;
      variables['last_media_url'] = inputData.mediaUrl || '';
      variables['last_media_id'] = inputData.mediaId || '';  // Store mediaId for re-sending
      log(`📥 Captured media: type=${actualType}, mediaId=${inputData.mediaId}, caption="${inputData.caption}"`);
  }
  variables['last_response'] = variables['last_input']; // Alias
  variables['last_message_type'] = actualType;

  let currentNodeId = session.currentNodeId;

  // If we just started, find the entry point
  if (currentNodeId === 'start') {
     // First, look for a start_trigger node
     const startTriggerNode = nodes.find(n => n.type === 'start_trigger');
     if (startTriggerNode) {
       currentNodeId = startTriggerNode.id;
     } else {
       // Legacy: try to find the node connected FROM the 'start' node via an edge
       const startEdge = edges.find(e => e.source === 'start');
       if (startEdge) {
         currentNodeId = startEdge.target;
       } else {
         // Fallback: find a node with no incoming edges (orphan entry point)
         currentNodeId = nodes.find(n => n.id !== 'start' && !edges.some(e => e.target === n.id))?.id;
       }
     }
  }

  // If we were waiting for input at current node
  const currentNode = nodes.find(n => n.id === currentNodeId);
  if (currentNode?.type === 'wait') {
     const expectedType = currentNode.data?.expectedType || 'text';
     // Safely access type from inputData (Prisma message record)
     const actualType = (inputData.type || 'text').toString().toLowerCase(); 
     
     let isValid = false;
     if (expectedType === 'any') isValid = true;
     else if (expectedType === 'text' && actualType === 'text') isValid = true;
     else if (expectedType === 'image' && actualType === 'image') isValid = true;
     else if (expectedType === 'document' && actualType === 'document') isValid = true;
     else if (expectedType === 'audio' && actualType === 'audio') isValid = true;
     else if (expectedType === 'video' && actualType === 'video') isValid = true;
     else if (expectedType === 'file' && ['image','video','audio','document'].includes(actualType)) isValid = true;
     
     if (!isValid) {
        if (currentNode.data?.retryOnInvalid) {
            const errorMsg = currentNode.data?.errorMessage || 'Invalid content. Please upload the correct format.';
            await sendWhatsAppMessage(session.organizationId, {
                to: waId, type: 'text', content: replaceVariables(errorMsg, variables)
            });
            // Stop execution, stay on same node
             await (prisma as any).flowSession.update({
               where: { id: session.id },
               data: { lastInteraction: new Date() }
            });
            return;
        }
     }

     const varName = currentNode.data?.variable || 'last_input';
     // Store Content
     if (actualType === 'text' || actualType === 'interactive') {
        variables[varName] = resolvedInput;
     } else {
        // Store both mediaId and URL for media types
        // mediaId can be used to re-send the same media via WhatsApp API
        variables[varName] = inputData.caption || `[${actualType.toUpperCase()}]`;
        variables[`${varName}_url`] = inputData.mediaUrl || '';
        variables[`${varName}_id`] = inputData.mediaId || '';  // WhatsApp Media ID
        if (inputData.caption) variables[`${varName}_caption`] = inputData.caption;
        log(`💾 Stored media for ${varName}: mediaId=${inputData.mediaId}`);
     }
     
     variables['last_message_type'] = actualType; // Useful for branching
     currentNodeId = edges.find(e => e.source === currentNode.id)?.target;
  }

  // Handle button node responses
  if (currentNode?.type === 'button' && variables['_pendingButtons']) {
    const pendingButtons: string[] = variables['_pendingButtons'];
    const userSelection = lastInput.trim().toLowerCase();
    
    // Find matching button by ID or title
    let matchedButtonIndex = -1;
    for (let i = 0; i < 3; i++) {
      const btnId = currentNode.data[`btn${i}Id`]?.toLowerCase();
      const btnTitle = currentNode.data[`btn${i}Title`]?.toLowerCase();
      if (btnId === userSelection || btnTitle === userSelection || pendingButtons[i]?.toLowerCase() === userSelection) {
        matchedButtonIndex = i;
        break;
      }
    }

    if (matchedButtonIndex >= 0) {
      // Valid selection
      const matchedTitle = currentNode.data[`btn${matchedButtonIndex}Title`];
      const matchedId = currentNode.data[`btn${matchedButtonIndex}Id`];
      
      variables['selected_button'] = matchedTitle;
      variables['selected_button_id'] = matchedId;

      // New Integrated Response Saver: Save to configured 'variable'
      if (currentNode.data.variable) {
          variables[currentNode.data.variable.trim()] = matchedTitle;
          log(`💾 Integrated Save (Button): Saved "${matchedTitle}" to variable "${currentNode.data.variable.trim()}"`);
      }

      // Route to correct handle
      const handleName = `btn${matchedButtonIndex}`;
      const nextEdge = edges.find(e => e.source === currentNode.id && e.sourceHandle === handleName);
      
      // BRANCHING FALLBACK: If no specific handle edge, use the default (Any) edge
      currentNodeId = nextEdge?.target || edges.find(e => e.source === currentNode.id && !e.sourceHandle)?.target;
      
      // Clean up button state
      delete variables['_pendingButtons'];
      delete variables['_buttonNodeId'];
      delete variables['_retryOnInvalid'];
      delete variables['_fallbackMessage'];
    } else {
      // Invalid selection
      if (variables['_retryOnInvalid']) {
        // Send fallback message and fall through to re-send options
        await sendWhatsAppMessage(session.organizationId, {
          to: waId,
          type: 'text',
          content: variables['_fallbackMessage']
        });
        // Do NOT return; let the logic proceed to re-execute the current node
      } else {
        // No retry - proceed to default next node
        currentNodeId = edges.find(e => e.source === currentNode.id && !e.sourceHandle)?.target;
        delete variables['_pendingButtons'];
      }
    }
  }

  // Handle List node responses
  if (currentNode?.type === 'list' && variables['_pendingListIds']) {
      const userSelection = lastInput.trim();
      let matchedId: string | null = null;
      let matchedTitle: string | null = null;

      // 1. Try to extract ID from metadata (most reliable)
      const metadata = typeof inputData.metadata === 'string' ? JSON.parse(inputData.metadata) : inputData.metadata;
      if (metadata?.type === 'list_reply') {
          matchedId = metadata.list_reply?.id;
          matchedTitle = metadata.list_reply?.title;
          console.log(`📋 List Metadata Match: ID=${matchedId}, Title=${matchedTitle}`);
      }

      // 2. Fallback to title matching if metadata didn't work (older or manual clients)
      if (!matchedId) {
          const sections = currentNode.data.sections || [];
          for (const section of sections) {
              for (const row of section.rows) {
                  if (row.id === userSelection || row.title.toLowerCase() === userSelection.toLowerCase()) {
                      matchedId = row.id;
                      matchedTitle = row.title;
                      break;
                  }
              }
              if (matchedId) break;
          }
      }

      // 3. Special check for system commands (__next, __prev) if not matched yet
      if (!matchedId) {
          if (userSelection.toLowerCase().includes('next') || userSelection.includes('➡️')) matchedId = '__next';
          if (userSelection.toLowerCase().includes('back') || userSelection.includes('⬅️')) matchedId = '__prev';
      }

      if (matchedId === '__next') {
          variables['_list_page'] = (parseInt(variables['_list_page'] || '0') + 1).toString();
          console.log(`➡️ List Pagination: Moving to page ${variables['_list_page']}`);
          currentNodeId = currentNode.id;
      } else if (matchedId === '__prev') {
          variables['_list_page'] = Math.max(0, parseInt(variables['_list_page'] || '0') - 1).toString();
          console.log(`⬅️ List Pagination: Moving to page ${variables['_list_page']}`);
          currentNodeId = currentNode.id;
      } else if (matchedId) {
          // Check if it's a valid ID from the list we just sent
          const pendingIds = variables['_pendingListIds'] || [];
          if (pendingIds.includes(matchedId)) {
              console.log(`✅ Valid list selection: ${matchedId}`);
              
              variables['selected_list_id'] = matchedId;
              variables['selected_list_title'] = matchedTitle || userSelection;

              // New Integrated Response Saver: Save to configured 'variable'
              if (currentNode.data.variable) {
                  variables[currentNode.data.variable.trim()] = matchedTitle || userSelection;
                  log(`💾 Integrated Save (List): Saved "${matchedTitle || userSelection}" to variable "${currentNode.data.variable.trim()}"`);
              }

              const nextEdge = edges.find(e => e.source === currentNode.id && e.sourceHandle === matchedId);
              
              // BRANCHING FALLBACK: If no specific handle edge, use the default (Any) edge
              currentNodeId = nextEdge?.target || edges.find(e => e.source === currentNode.id && !e.sourceHandle)?.target;
              
              delete variables['_pendingListIds'];
              delete variables['_buttonNodeId'];
              delete variables['_retryOnInvalid'];
              delete variables['_fallbackMessage'];
              delete variables['_list_page'];
          } else {
              console.warn(`⚠️ List selection ID not in pending list: ${matchedId}`);
              matchedId = null; // Forces retry/fallback
          }
      }

      if (!matchedId) {
         if (variables['_retryOnInvalid']) {
            await sendWhatsAppMessage(session.organizationId, {
              to: waId,
              type: 'text',
              content: variables['_fallbackMessage']
            });
         } else {
            currentNodeId = edges.find(e => e.source === currentNode.id && !e.sourceHandle)?.target;
            delete variables['_pendingListIds'];
         }
      }
  }

  // Handle Flow node responses
  if (currentNode?.type === 'flow' && variables['_waiting_flow']) {
      // Check if this is an nfm_reply
      const metadata = typeof inputData.metadata === 'string' ? JSON.parse(inputData.metadata) : inputData.metadata;
      if (metadata?.type === 'nfm_reply') {
          try {
              const flowResult = JSON.parse(metadata.nfm_reply?.response_json || '{}');
              console.log('📝 Received Flow Results:', flowResult);
              
              // Map all flow fields into variables
              Object.keys(flowResult).forEach(key => {
                  variables[key] = flowResult[key];
              });
              
              delete variables['_waiting_flow'];
              currentNodeId = edges.find(e => e.source === currentNode.id)?.target;
          } catch (e) {
              console.error('❌ Error parsing Flow response:', e);
          }
      }
  }

  let steps = 0;
  while (currentNodeId && steps < 30) {
    steps++;
    const node = nodes.find(n => n.id === currentNodeId);
    if (!node) break;

    log(`📍 [Chatbot] Executing Node: ${node.type} (${node.id})`);
    let nextNodeId: string | null = null;

    try {
      switch (node.type) {
        case 'session_config':
          if (node.data.timeout) {
             variables['_session_timeout'] = node.data.timeout * 3600;
          }
          if (node.data.clearVariables) {
             variables['_clear_variables_on_restart'] = true;
          }
          break; // Continues to find next edge

          case 'variable':
            if (node.data.variableName) {
                const varName = node.data.variableName.trim();
                let val = node.data.value || '';
                
                log(`🧪 Variable Node [${varName}] RAW value: "${val}"`);

                // VARIABLE RESCUE: If val is empty OR it includes last_input/last_response markers
                // but resolves to empty, try to fetch the value from the last interactive selection.
                const resolved = replaceVariables(val, variables);
                
                const needsRescue = !val || 
                                    (val.includes('last_input') || val.includes('last_response')) && (!resolved || resolved === val) ||
                                    !resolved.trim();

                if (needsRescue) {
                    const rescued = variables['last_input'] || variables['selected_button'] || variables['selected_list_title'] || '';
                    if (rescued) {
                        val = rescued;
                        log(`🆘 Variable Rescue: Rescued empty/failed variable using "${val}"`);
                    } else {
                        val = resolved;
                    }
                } else {
                    val = resolved;
                }

                variables[varName] = val;
                log(`💾 Set variable: "${varName}" = "${variables[varName]}"`);
            }
            break;

        case 'list_variable':
           if (node.data.variableName) {
               const varName = node.data.variableName.trim();
               const rawItems = node.data.items || '';
               const items = rawItems.split('\n').map((s: string) => s.trim()).filter(Boolean);
               variables[varName] = items;
               console.log(`💾 Set list variable: "${varName}" = [${items.length} items]`);
           }
           break;

        case 'update_contact':
           try {
               const updateData: any = {};
               if (node.data.contactName) {
                   const newName = replaceVariables(node.data.contactName, variables);
                   updateData.name = newName;
                   variables['sender_name'] = newName; // Update local scope immediately
               }
               if (node.data.contactEmail) {
                   updateData.email = replaceVariables(node.data.contactEmail, variables);
               }
               if (node.data.contactTags) {
                   const newTagsArr = replaceVariables(node.data.contactTags, variables).split(',').map((t: string) => t.trim()).filter(Boolean);
                   updateData.tags = JSON.stringify(newTagsArr);
               }

               if (Object.keys(updateData).length > 0) {
                   await (prisma as any).contact.update({
                       where: { id: session.contactId },
                       data: updateData
                   });
                   console.log(`👤 Updated contact profile: ${JSON.stringify(updateData)}`);
               }
           } catch (err) {
               console.error('❌ Failed to update contact node:', err);
           }
            break;

         case 'send_external':
            try {
                const toVar = replaceVariables(node.data.to || '', variables);
                const messageVar = replaceVariables(node.data.message || '', variables);
                
                if (toVar && messageVar) {
                    console.log(`📣 Sending external notification to: ${toVar}`);
                    await sendWhatsAppMessage(session.organizationId, {
                        to: toVar.replace(/\+/g, '').trim(),
                        type: 'text',
                        content: messageVar
                    });
                } else {
                    console.warn('⚠️ Send External failed: Missing recipient or message');
                }
            } catch (err) {
                console.error('❌ Send External handler error:', err);
            }
            break;



        case 'map':
           const srcVar = node.data.sourceArray || 'items';
           const outVar = node.data.outputVariable || 'mapped_result';
           const template = node.data.template || '{{item}}';
           const sep = (node.data.separator || '\n').replace('\\n', '\n');
           
           let srcList = variables[srcVar];
           if (typeof srcList === 'string' && srcList.startsWith('[')) {
               try { srcList = JSON.parse(srcList); } catch { srcList = []; }
           }
           
           if (Array.isArray(srcList)) {
               const mapped = srcList.map((item: any) => {
                   const context = { ...variables, item };
                   return replaceVariables(template, context);
               });
               variables[outVar] = mapped.join(sep);
               console.log(`🗺️ Map Result (${outVar}) created from ${srcList.length} items`);
           } else {
               variables[outVar] = '';
           }
           break;

         case 'catalogue':
            const skus = (node.data.skus || '').split(',').map((s: string) => s.trim()).filter(Boolean);
            await sendWhatsAppMessage(session.organizationId, {
                to: waId,
                type: 'interactive',
                content: replaceVariables(node.data.body || 'Please check our products:', variables),
                caption: replaceVariables(node.data.header || 'Our Products', variables),
                footerText: replaceVariables(node.data.footer || '', variables),
                catalogId: node.data.catalogId,
                productRetailerIds: skus
            });
            break;

         case 'flow':
            await sendWhatsAppMessage(session.organizationId, {
                to: waId,
                type: 'interactive',
                content: replaceVariables(node.data.body || 'Please fill the form below:', variables),
                caption: replaceVariables(node.data.buttonText || 'Open Form', variables),
                header: replaceVariables(node.data.header || '', variables),
                footerText: replaceVariables(node.data.footer || '', variables),
                flowId: node.data.flowId,
                flowToken: `flow_${session.id}`,
                screenId: node.data.screenId || 'QUESTION_ONE'
            });
            
            // Mark as waiting for flow response
            await (prisma as any).flowSession.update({
                where: { id: session.id },
                data: { currentNodeId: node.id, variables: JSON.stringify({ ...variables, _waiting_flow: true }) }
            });
            return; // Pause execution

        case 'google_sheet':
           const url = node.data.url;
           if (url) {
               let payloadStr = node.data.payload || '{}';
               payloadStr = replaceVariables(payloadStr, variables);
               try {
                   const payload = JSON.parse(payloadStr);
                   await axios.post(url, payload);
               } catch (e) {
                   console.error(`Sheet Error (${node.id})`, e);
               }
           }
           break;

        case 'google_sheet_query':
          // Query Google Sheet via Apps Script - dynamic match conditions
          const scriptUrl = node.data.scriptUrl;
          if (scriptUrl) {
            try {
              // Build match conditions from dynamic array
              const matchConditions = node.data.matchConditions || [];
              const matchParams: Record<string, string> = {};
              
              matchConditions.forEach((cond: { variable: string; column: string }, idx: number) => {
                if (cond.variable && cond.column) {
                  // Get value from variables, with special handling for sender_mobile
                  let value = cond.variable === 'sender_mobile' 
                    ? (variables['sender_mobile'] || waId) 
                    : (variables[cond.variable] || '');
                  
                  // Store for sending to script
                  matchParams[`match_${idx}_value`] = String(value);
                  matchParams[`match_${idx}_column`] = cond.column;
                }
              });
              
              const outputColumnsList = node.data.outputColumns || '';
              
              log(`🔍 [Google Sheet Query] Searching with ${matchConditions.length} conditions: ${JSON.stringify(matchParams)}`);
              
              const response = await axios.get(scriptUrl, {
                params: {
                  matchConditions: JSON.stringify(matchConditions.map((c: any, idx: number) => ({
                    column: c.column,
                    value: c.variable === 'sender_mobile' 
                      ? (variables['sender_mobile'] || waId) 
                      : (variables[c.variable] || '')
                  }))),
                  outputColumns: outputColumnsList
                },
                timeout: 15000
              });

              if (response.data && response.data.found) {
                // Store each returned column in variables
                log(`✅ [Google Sheet Query] Found match! Columns: ${JSON.stringify(response.data.columns)}`);
                
                if (response.data.columns && typeof response.data.columns === 'object') {
                  Object.entries(response.data.columns).forEach(([colName, colValue]) => {
                    const cleanName = colName.trim().replace(/\s+/g, '_');
                    variables[cleanName] = colValue;
                    log(`   💾 Set variable: ${cleanName} = ${colValue}`);
                  });
                }

                // Send found message if configured
                if (node.data.foundMessage) {
                  await sendWhatsAppMessage(session.organizationId, {
                    to: waId,
                    type: 'text',
                    content: replaceVariables(node.data.foundMessage, variables)
                  });
                }

                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target || null;
              } else {
                log(`❌ [Google Sheet Query] No match found`);
                
                // Send not found message if configured
                if (node.data.notFoundMessage) {
                  await sendWhatsAppMessage(session.organizationId, {
                    to: waId,
                    type: 'text',
                    content: replaceVariables(node.data.notFoundMessage, variables)
                  });
                }

                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              }
              
              currentNodeId = nextNodeId;
              continue;
            } catch (e: any) {
              console.error(`❌ [Google Sheet Query] Error:`, e.message || e);
              
              // On error, go to fail path
              if (node.data.notFoundMessage) {
                await sendWhatsAppMessage(session.organizationId, {
                  to: waId,
                  type: 'text',
                  content: replaceVariables(node.data.notFoundMessage || 'Sorry, we encountered an error looking up your information.', variables)
                });
              }
              
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              currentNodeId = nextNodeId;
              continue;
            }
          }
          break;


         case 'payment':
            try {
                const provider = node.data.provider || 'razorpay';
                const amount = parseFloat(replaceVariables(node.data.amount || '0', variables));
                const currency = replaceVariables(node.data.currency || 'INR', variables);
                const description = replaceVariables(node.data.description || 'Payment Request', variables);
                const msgBody = node.data.messageBody || 'Please complete your payment here: {{link}}';
                
                let payResult;
                
                if (provider === 'razorpay') {
                    const keyId = replaceVariables(node.data.apiKey || '', variables);
                    const keySecret = replaceVariables(node.data.apiSecret || '', variables);
                    
                    if (!keyId || !keySecret) throw new Error('Razorpay Keys Missing');
                    
                    payResult = await createRazorpayLink(
                        amount, 
                        currency, 
                        description, 
                        keyId, 
                        keySecret,
                        {
                            name: variables['sender_name'],
                            contact: variables['sender_mobile']
                        }
                    );
                } else if (provider === 'stripe') {
                    const secretKey = replaceVariables(node.data.apiKey || '', variables); // Stripe only needs secret
                    
                    if (!secretKey) throw new Error('Stripe Secret Key Missing');
                    
                    payResult = await createStripeLink(
                        amount,
                        currency,
                        description,
                        secretKey
                    );
                }
                
                if (payResult?.short_url) {
                    variables['payment_link'] = payResult.short_url;
                    variables['payment_id'] = payResult.id;
                    log(`💰 Payment Link Generated: ${payResult.short_url}`);
                    
                    // Send Link Message
                    const finalMsg = replaceVariables(msgBody, { ...variables, link: payResult.short_url });
                    await sendWhatsAppMessage(session.organizationId, {
                        to: waId,
                        type: 'text',
                        content: finalMsg
                    });
                    
                    nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target || null;
                } else {
                    throw new Error('Link generation returned null');
                }
            } catch (error: any) {
                console.error(`❌ Payment Node Error (${node.id}):`, error.message);
                
                // Send error message if configured
                if (node.data.errorMessage) {
                   await sendWhatsAppMessage(session.organizationId, {
                        to: waId,
                        type: 'text',
                        content: replaceVariables(node.data.errorMessage, variables)
                    });
                }
                
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
            }
            currentNodeId = nextNodeId;
            break;


        case 'loop':
          const loopId = node.id;
          const indexKey = `_loop_idx_${loopId}`;
          const arrVar = node.data.arrayVariable || 'items';
          const itemVar = node.data.currentItemVariable || 'item';
          
          let list = variables[arrVar];
          if (typeof list === 'string') {
              try { list = JSON.parse(list); } catch { list = []; }
          }
          if (!Array.isArray(list)) list = [];
          
          const idx = variables[indexKey] || 0;
          
          if (idx < list.length) {
              variables[itemVar] = list[idx];
              variables[indexKey] = idx + 1;
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'loop')?.target || null;
          } else {
              delete variables[indexKey]; // Reset for next time (or cleanup)
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'done')?.target || null;
          }
          currentNodeId = nextNodeId;
          continue;

        case 'message':
        case 'text':
          await sendWhatsAppMessage(session.organizationId, {
            to: waId,
            type: 'text',
            content: replaceVariables(node.data.message || '', variables)
          });
          break;

        case 'button':
          // Collect button definitions from node data
          const buttons: any[] = [];
          for (let i = 0; i < 3; i++) {
            const title = node.data[`btn${i}Title`];
            const id = node.data[`btn${i}Id`] || `btn_${i}`;
            if (title) {
              buttons.push({ type: 'reply', reply: { id, title: title.substring(0, 20) } });
            }
          }

          // Send interactive button message
          // Send interactive button message
          await sendWhatsAppMessage(session.organizationId, {
            to: waId,
            type: 'interactive',
            content: replaceVariables(node.data.headerMessage || 'Please choose:', variables),
            buttons: buttons,
            footerText: node.data.footerMessage ? replaceVariables(node.data.footerMessage, variables) : undefined
          });

          // Store button state and wait for user response
          variables['_pendingButtons'] = buttons.map(b => b.reply.id);
          variables['_buttonNodeId'] = node.id;
          variables['_retryOnInvalid'] = node.data.retryOnInvalid || false;
          variables['_fallbackMessage'] = node.data.fallbackMessage || 'Invalid option. Please try again.';

          // Save state and pause execution
          await (prisma as any).flowSession.update({
            where: { id: session.id },
            data: { currentNodeId: node.id, variables: JSON.stringify(variables) }
          });
          return; // STOP - waiting for user button press

        case 'list':
          let waListSections = [];
          const validIds: string[] = [];
          
          // Option 1: Dynamic array from variable
          if (node.data.dynamicArray) {
              const arrayVar = node.data.dynamicArray.trim();
              let rawArray = variables[arrayVar];
              
              // Handle if array is stringified JSON
              if (typeof rawArray === 'string' && rawArray.startsWith('[')) {
                  try { rawArray = JSON.parse(rawArray); } catch(e) {}
              }
              
              if (Array.isArray(rawArray)) {
                  const itemsPerPage = 9;
                  const currentPage = parseInt(variables['_list_page'] || '0');
                  const startIdx = currentPage * itemsPerPage;
                  const endIdx = startIdx + itemsPerPage;
                  const currentItems = rawArray.slice(startIdx, endIdx);
                  
                  const rows = currentItems.map((item: any, idx: number) => {
                      const title = typeof item === 'object' ? (item.title || item.name || `Item ${startIdx + idx + 1}`) : String(item);
                      const description = typeof item === 'object' ? (item.description || item.price || '') : '';
                      const rId = typeof item === 'object' ? (item.id || item.sku || `row_${startIdx + idx}`) : `row_${startIdx + idx}`;
                      validIds.push(String(rId));
                      return {
                          id: String(rId),
                          title: String(title).substring(0, 24),
                          description: String(description).substring(0, 72)
                      };
                  });
                  
                  // Add Pagination Rows
                  if (endIdx < rawArray.length) {
                      const nextId = '__next';
                      validIds.push(nextId);
                      rows.push({ id: nextId, title: 'Next ➡️', description: 'See more options' });
                  }
                  if (currentPage > 0) {
                      const prevId = '__prev';
                      validIds.push(prevId);
                      rows.push({ id: prevId, title: '⬅️ Back', description: 'See previous options' });
                  }
                  
                  waListSections = [{ title: 'Options', rows }];
              }
          }
          
          // Option 2: Fetch from Google Sheet
          if (waListSections.length === 0 && node.data.sheetUrl) {
              try {
                  log(`📊 [List] Fetching items from Google Sheet...`);
                  const sheetResponse = await axios.get(node.data.sheetUrl, {
                      params: {
                          action: 'getListItems',
                          titleCol: node.data.sheetTitleCol || 'A',
                          descCol: node.data.sheetDescCol || 'B',
                          idCol: node.data.sheetIdCol || 'C'
                      },
                      timeout: 15000
                  });
                  
                  if (sheetResponse.data && Array.isArray(sheetResponse.data.items)) {
                      const sheetItems = sheetResponse.data.items;
                      log(`✅ [List] Got ${sheetItems.length} items from sheet`);
                      
                      const itemsPerPage = 9;
                      const currentPage = parseInt(variables['_list_page'] || '0');
                      const startIdx = currentPage * itemsPerPage;
                      const endIdx = startIdx + itemsPerPage;
                      const currentItems = sheetItems.slice(startIdx, endIdx);
                      
                      const rows = currentItems.map((item: any, idx: number) => {
                          const title = item.title || item.name || `Item ${startIdx + idx + 1}`;
                          const description = item.description || item.desc || '';
                          const rId = item.id || `sheet_${startIdx + idx}`;
                          validIds.push(String(rId));
                          return {
                              id: String(rId),
                              title: String(title).substring(0, 24),
                              description: String(description).substring(0, 72)
                          };
                      });
                      
                      // Pagination
                      if (endIdx < sheetItems.length) {
                          validIds.push('__next');
                          rows.push({ id: '__next', title: 'Next ➡️', description: 'See more options' });
                      }
                      if (currentPage > 0) {
                          validIds.push('__prev');
                          rows.push({ id: '__prev', title: '⬅️ Back', description: 'See previous options' });
                      }
                      
                      waListSections = [{ title: node.data.sheetSectionTitle || 'Options', rows }];
                  }
              } catch (sheetError: any) {
                  log(`❌ [List] Sheet fetch error: ${sheetError.message}`);
              }
          }

          
          if (waListSections.length === 0) {
              const listSections = node.data.sections || [];
              waListSections = listSections.map((s: any) => ({
                  title: s.title,
                  rows: s.rows.map((r: any) => {
                      const rId = r.id || `row_${Math.random().toString(36).substr(2, 5)}`;
                      validIds.push(rId);
                      return {
                          id: rId,
                          title: r.title.substring(0, 24),
                          description: r.description ? r.description.substring(0, 72) : undefined
                      };
                  })
              }));
          }

          await sendWhatsAppMessage(session.organizationId, {
              to: waId,
              type: 'interactive',
              content: replaceVariables(node.data.body || 'Please choose:', variables),
              footerText: node.data.footer,
              caption: node.data.menuTitle || 'Options',
              sections: waListSections
          });

          variables['_pendingListIds'] = validIds;
          variables['_buttonNodeId'] = node.id; 
          variables['_retryOnInvalid'] = node.data.retryOnInvalid || false;
          variables['_fallbackMessage'] = node.data.fallbackMessage || 'Invalid selection. Please try again.';

          await (prisma as any).flowSession.update({
            where: { id: session.id },
            data: { currentNodeId: node.id, variables: JSON.stringify(variables) }
          });
          return;

        case 'image':
        case 'video':
        case 'document':
          let mediaUrl = replaceVariables(node.data.mediaUrl || '', variables);
          mediaUrl = convertGoogleDriveLink(mediaUrl);

          await sendWhatsAppMessage(session.organizationId, {
            to: waId,
            type: node.type as any,
            content: node.data.mediaId || '',
            mediaUrl: mediaUrl,
            caption: node.data.caption
          });
          break;

        case 'start_trigger':
          // Start Trigger Node - Entry point for the flow
          // Handle trigger mode: 'any' or 'keywords'
          const triggerMode = node.data.triggerMode || 'any';
          const triggerKeywords = node.data.keywords || [];
          
          log(`🚀 Start Trigger Node - Mode: ${triggerMode}`);
          
          if (triggerMode === 'keywords' && triggerKeywords.length > 0) {
            // Check if the user's message matches any keyword
            const userMessage = lastInput.trim().toLowerCase();
            const caseSensitive = node.data.caseSensitive || false;
            const partialMatch = node.data.partialMatch || false;
            
            let matchedKeywordIndex = -1;
            for (let i = 0; i < triggerKeywords.length; i++) {
              const keyword = caseSensitive ? triggerKeywords[i] : triggerKeywords[i].toLowerCase();
              const compareText = caseSensitive ? lastInput.trim() : userMessage;
              
              if (partialMatch) {
                if (compareText.includes(keyword)) {
                  matchedKeywordIndex = i;
                  break;
                }
              } else {
                if (compareText === keyword) {
                  matchedKeywordIndex = i;
                  break;
                }
              }
            }
            
            if (matchedKeywordIndex >= 0) {
              variables['matched_keyword'] = triggerKeywords[matchedKeywordIndex];
              log(`✅ Matched keyword: "${triggerKeywords[matchedKeywordIndex]}"`);
              
              // Route to specific keyword handle if exists
              const keywordEdge = edges.find(e => e.source === node.id && e.sourceHandle === `kw_${matchedKeywordIndex}`);
              if (keywordEdge) {
                nextNodeId = keywordEdge.target;
              } else {
                // Use default handle
                nextNodeId = edges.find(e => e.source === node.id && (e.sourceHandle === 'default' || !e.sourceHandle))?.target || null;
              }
            } else {
              // No keyword matched - use default path
              log(`⚠️ No keyword matched for: "${lastInput}"`);
              nextNodeId = edges.find(e => e.source === node.id && (e.sourceHandle === 'default' || !e.sourceHandle))?.target || null;
            }
          } else {
            // 'any' mode - just continue to the next node
            variables['matched_keyword'] = lastInput;
            nextNodeId = edges.find(e => e.source === node.id && (e.sourceHandle === 'default' || !e.sourceHandle))?.target || null;
          }
          
          currentNodeId = nextNodeId;
          if (currentNodeId) continue;
          break;

        case 'delay':
          const seconds = parseInt(node.data.delay) || 1;
          await new Promise(r => setTimeout(r, seconds * 1000));
          break;

        case 'sql':
            if (node.data.query) {
                const query = replaceVariables(node.data.query, variables);
                try {
                    console.log(`🗄️ Executing SQL: ${query}`);
                    const result = await (prisma as any).$queryRawUnsafe(query);
                    console.log(`✅ SQL Success: ${Array.isArray(result) ? result.length : 1} rows`);
                    
                    if (node.data.mapping && Array.isArray(node.data.mapping)) {
                        node.data.mapping.forEach((m: any) => {
                            if (m.path && m.variable) {
                                // Simple dot/bracket notation
                                const pathParts = m.path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
                                let current = result;
                                for (const part of pathParts) {
                                    if (current === undefined || current === null) break;
                                    current = current[part];
                                }
                                if (current !== undefined) {
                                    variables[m.variable] = typeof current === 'object' ? JSON.stringify(current) : current;
                                }
                            }
                        });
                    }
                    nextNodeId = (edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target 
                                || edges.find(e => e.source === node.id && !e.sourceHandle)?.target) || null;
                } catch (e) {
                    console.error('❌ SQL Error:', e);
                    variables['sql_error'] = e instanceof Error ? e.message : 'Unknown error';
                    nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
                }
            }
            currentNodeId = nextNodeId;
            if (currentNodeId) continue;
            break;

        case 'media_forward':
          // Forward uploaded media to an external API (for OCR, storage, etc.)
          // OR save locally if URL is empty or starts with '/local'
          try {
            const mediaIdVar = node.data.mediaIdVariable || 'document_id'; // Variable containing the WhatsApp media ID
            const mediaId = replaceVariables(`{{${mediaIdVar}}}`, variables) || variables[mediaIdVar];
            const targetUrl = replaceVariables(node.data.url || '', variables);
            const fieldName = node.data.fieldName || 'file'; // Form field name for the file
            const resultVar = node.data.resultVariable || 'media_result';
            const saveLocally = !targetUrl || targetUrl.startsWith('/local') || targetUrl === 'local';
            
            if (!mediaId || mediaId.includes('{{')) {
              log(`⚠️ Media Forward: No media ID found in variable "${mediaIdVar}"`);
              variables['media_forward_error'] = `No media ID found in ${mediaIdVar}`;
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              currentNodeId = nextNodeId;
              continue;
            }

            // Import the download function
            const { downloadMediaContent } = await import('./whatsappService.js');
            
            // Download the media content from WhatsApp
            log(`📤 Media Forward: Downloading media ${mediaId}...`);
            const mediaResult = await downloadMediaContent(session.organizationId, mediaId);
            
            if (!mediaResult.success || !mediaResult.buffer) {
              log(`❌ Media Forward: Failed to download media - ${mediaResult.error}`);
              variables['media_forward_error'] = mediaResult.error || 'Failed to download media';
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              currentNodeId = nextNodeId;
              continue;
            }

            log(`✅ Media Forward: Downloaded ${mediaResult.buffer.length} bytes (${mediaResult.mimeType})`);

            // If saving locally, save to uploads folder
            if (saveLocally) {
              const fs = await import('fs');
              const pathModule = await import('path');
              const { v4: uuidv4 } = await import('uuid');
              
              const UPLOAD_DIR = pathModule.default.join(process.cwd(), 'uploads');
              if (!fs.default.existsSync(UPLOAD_DIR)) {
                fs.default.mkdirSync(UPLOAD_DIR, { recursive: true });
              }
              
              // Determine extension from mime type
              const mimeExt: Record<string, string> = {
                'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
                'application/pdf': 'pdf', 'application/msword': 'doc', 'text/plain': 'txt',
                'video/mp4': 'mp4', 'audio/mpeg': 'mp3',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
              };
              const ext = mimeExt[mediaResult.mimeType || ''] || 'bin';
              const filename = `${uuidv4()}.${ext}`;
              const filepath = pathModule.default.join(UPLOAD_DIR, filename);
              
              fs.default.writeFileSync(filepath, mediaResult.buffer);
              
              const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3000}`;
              const publicUrl = `${backendUrl}/uploads/${filename}`;
              const relativeUrl = `/uploads/${filename}`;
              
              log(`✅ Media Forward: Saved locally as ${filename}`);
              log(`📁 Local URL: ${publicUrl}`);
              
              // Store the URLs in variables
              variables[resultVar] = publicUrl;
              variables[`${resultVar}_relative`] = relativeUrl;
              variables[`${resultVar}_filename`] = filename;
              
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target ||
                          edges.find(e => e.source === node.id && !e.sourceHandle)?.target || null;
              currentNodeId = nextNodeId;
              continue;
            }

            // Otherwise, forward to external API
            log(`📤 Media Forward: Forwarding to ${targetUrl}`);

            // Create FormData and upload to external API
            const FormData = (await import('form-data')).default;
            const formData = new FormData();
            
            // Determine filename from mime type
            const extension = mediaResult.mimeType?.split('/')[1] || 'bin';
            const filename = `upload_${Date.now()}.${extension}`;
            
            formData.append(fieldName, mediaResult.buffer, {
              filename,
              contentType: mediaResult.mimeType || 'application/octet-stream'
            });
            
            // Add any additional form fields configured
            if (node.data.additionalFields && Array.isArray(node.data.additionalFields)) {
              for (const field of node.data.additionalFields) {
                if (field.key && field.value) {
                  formData.append(field.key, replaceVariables(field.value, variables));
                }
              }
            }
            
            // Prepare headers
            const headers: Record<string, string> = {
              ...formData.getHeaders()
            };
            
            // Add custom headers if configured
            if (node.data.headers && Array.isArray(node.data.headers)) {
              for (const h of node.data.headers) {
                if (h.key && h.value) {
                  headers[h.key] = replaceVariables(h.value, variables);
                }
              }
            }
            
            // Add bearer token if configured
            if (node.data.bearerToken) {
              headers['Authorization'] = `Bearer ${replaceVariables(node.data.bearerToken, variables)}`;
            }
            
            log(`📤 Media Forward: POSTing to ${targetUrl}...`);
            
            const response = await axios.post(targetUrl, formData, {
              headers,
              timeout: 60000 // 60s timeout for OCR processing
            });
            
            log(`✅ Media Forward: Response status ${response.status}`);
            
            // Store full response
            variables[resultVar] = typeof response.data === 'object' 
              ? JSON.stringify(response.data) 
              : String(response.data);
            
            // Apply response mapping if configured
            if (node.data.mapping && Array.isArray(node.data.mapping)) {
              for (const m of node.data.mapping) {
                if (m.path && m.variable) {
                  const pathParts = m.path.split('.');
                  let current = response.data;
                  
                  for (const part of pathParts) {
                    if (current === undefined || current === null) break;
                    if (part.includes('[') && part.includes(']')) {
                      const [key, idxStr] = part.split('[');
                      const idx = parseInt(idxStr.replace(']', ''));
                      current = current[key] ? current[key][idx] : undefined;
                    } else {
                      current = current[part];
                    }
                  }
                  
                  if (current !== undefined) {
                    variables[m.variable] = typeof current === 'object' 
                      ? JSON.stringify(current) 
                      : String(current);
                    log(`💾 Media Forward: Mapped ${m.path} -> ${m.variable} = "${String(current).substring(0, 50)}..."`);
                  }
                }
              }
            }
            
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target ||
                        edges.find(e => e.source === node.id && !e.sourceHandle)?.target || null;
            currentNodeId = nextNodeId;
            continue;
            
          } catch (err: any) {
            // Enhanced error logging
            let errorMsg = err.message;
            if (err.response) {
              // The request was made and the server responded with a status code outside 2xx
              errorMsg = `API Error ${err.response.status}: ${JSON.stringify(err.response.data || err.message)}`;
              log(`❌ Media Forward Error: Status ${err.response.status}`);
              log(`❌ Response data: ${JSON.stringify(err.response.data)}`);
            } else if (err.request) {
              // The request was made but no response was received
              errorMsg = `No response from server: ${err.message}`;
              log(`❌ Media Forward Error: No response - ${err.message}`);
            } else {
              log(`❌ Media Forward Error: ${err.message}`);
            }
            console.error('❌ Media Forward Full Error:', err.message);
            variables['media_forward_error'] = errorMsg;
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
            currentNodeId = nextNodeId;
            continue;
          }

        case 'api':
          try {
            const url = replaceVariables(node.data.url, variables);
            const headers: Record<string, string> = {};
            
            // Standard headers
            if (node.data.headers && Array.isArray(node.data.headers)) {
                node.data.headers.forEach((h: any) => {
                    if (h.key && h.value) {
                        headers[h.key] = replaceVariables(h.value, variables);
                    }
                });
            }

            // Legacy Bearer support (backwards compatibility)
            if (node.data.bearerToken) {
              headers['Authorization'] = `Bearer ${replaceVariables(node.data.bearerToken, variables)}`;
            }

            const method = node.data.method || 'GET';
            let data = null;
            if (['POST', 'PUT'].includes(method) && node.data.body) {
                const bodyStr = replaceVariables(node.data.body, variables);
                try {
                    data = JSON.parse(bodyStr);
                } catch (e) {
                    console.error('❌ API JSON Parse Error:', e);
                    console.error('Raw Body String:', bodyStr);
                    variables['api_error'] = `Invalid JSON Body: ${e instanceof Error ? e.message : 'Unknown error'}`;
                    // If JSON fails, the call will likely fail or send empty, which is handled in the catch block
                }
            }

            console.log(`🚀 API Request: ${method} ${url}`);
            if (data) console.log(`📦 Payload:`, JSON.stringify(data));

            const response = await axios({
                method,
                url,
                headers,
                data,
                timeout: 10000 // 10s timeout
            });

            // Store legacy response result
            if (node.data.responseVar) {
                 variables[node.data.responseVar] = JSON.stringify(response.data);
            }

            // New Response Mapping
            if (node.data.mapping && Array.isArray(node.data.mapping)) {
                node.data.mapping.forEach((m: any) => {
                    if (m.path && m.variable) {
                        // Simple dot notation traversal (e.g. body.data.id)
                        const pathParts = m.path.split('.');
                        let current = response.data;
                        if (pathParts[0] === 'body') pathParts.shift(); // Optional 'body' prefix
                        
                        for (const part of pathParts) {
                            if (current === undefined || current === null) break;
                            // Handle array index e.g. items[0]
                            if (part.includes('[') && part.includes(']')) {
                                const [key, idxStr] = part.split('[');
                                const idx = parseInt(idxStr.replace(']', ''));
                                current = current[key] ? current[key][idx] : undefined;
                            } else {
                                current = current[part];
                            }
                        }
                        
                        if (current !== undefined) {
                            variables[m.variable] = typeof current === 'object' ? JSON.stringify(current) : String(current);
                        }
                    }
                });
            }

            console.log(`✅ API Success:`, response.status);

            // --- Custom Response Branching ---
            // We check the FIRST mapped variable value against any defined routes
            const apiRoutes = node.data.routes || [];
            let matchedApiRouteId = null;
            
            if (apiRoutes.length > 0 && node.data.mapping?.[0]?.variable) {
                const checkVar = node.data.mapping[0].variable;
                const checkValue = String(variables[checkVar] || '').trim();
                
                for (const route of apiRoutes) {
                    const operator = route.operator || '==';
                    const targetValue = route.value.trim();
                    let isMatch = false;

                    if (operator === '==') {
                        isMatch = checkValue.toLowerCase() === targetValue.toLowerCase();
                    } else {
                        const numResolved = parseFloat(checkValue);
                        const numTarget = parseFloat(targetValue);
                        if (!isNaN(numResolved) && !isNaN(numTarget)) {
                            if (operator === '>') isMatch = numResolved > numTarget;
                            else if (operator === '<') isMatch = numResolved < numTarget;
                        }
                    }

                    if (isMatch) {
                        matchedApiRouteId = route.id;
                        log(`✅ [API-Branch] matched: "${operator} ${targetValue}" (Handle: ${route.id})`);
                        break;
                    }
                }
            }

            if (matchedApiRouteId) {
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === matchedApiRouteId)?.target || null;
            }

            // Fallback to standard success if no custom route matched or connected
            if (!nextNodeId) {
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target || 
                             edges.find(e => e.source === node.id && !e.sourceHandle)?.target || null;
            }

            currentNodeId = nextNodeId;
            continue;
          } catch (err: any) {
            console.error(`❌ API Error:`, err.message);
            variables['api_error'] = err.message;
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
            currentNodeId = nextNodeId;
            continue;
          }

        case 'wait':
          await (prisma as any).flowSession.update({
            where: { id: session.id },
            data: { currentNodeId: node.id, variables: JSON.stringify(variables) }
          });
          return; // STOP execution

        case 'drive_image_lookup':
          const connectionType = node.data.connectionType || 'script';
          const lookupUrl = node.data.apiUrl;
          const driveApiKey = node.data.apiKey;
          const searchTerm = replaceVariables(node.data.searchVariable || 'product_name', variables);
          const parentId = node.data.parentFolderId || '';
          const searchMode = node.data.searchMode || 'folder';
          
          let foundImages: any[] = [];
          let success = false;

          if (connectionType === 'api_key' && driveApiKey) {
            try {
                console.log(`🔑 Native Drive Search: "${searchTerm}" (Mode: ${searchMode})`);
                // 1. Search for files/folders using Drive API v3
                let query = "";
                if (searchMode === 'file') {
                    query = `mimeType contains 'image/' and name contains '${searchTerm}'`;
                } else {
                    query = `mimeType = 'application/vnd.google-apps.folder' and name contains '${searchTerm}'`;
                }
                
                if (parentId) query = `(${query}) and '${parentId}' in parents`;

                const searchRes = await axios.get(`https://www.googleapis.com/drive/v3/files`, {
                    params: {
                        q: query,
                        key: driveApiKey,
                        fields: 'files(id, name, mimeType)'
                    }
                });

                const files = searchRes.data.files || [];
                
                if (files.length > 0) {
                    if (searchMode === 'file') {
                        foundImages = files.map((f: any) => ({
                            id: f.id,
                            name: f.name,
                            url: `https://drive.google.com/uc?export=download&id=${f.id}`
                        }));
                        success = true;
                    } else {
                        // Found a folder, now list its children
                        const folderId = files[0].id;
                        const filesRes = await axios.get(`https://www.googleapis.com/drive/v3/files`, {
                            params: {
                                q: `'${folderId}' in parents and mimeType contains 'image/'`,
                                key: driveApiKey,
                                fields: 'files(id, name, mimeType)'
                            }
                        });
                        const folderFiles = filesRes.data.files || [];
                        foundImages = folderFiles.map((f: any) => ({
                            id: f.id,
                            name: f.name,
                            url: `https://drive.google.com/uc?export=download&id=${f.id}`
                        }));
                        success = true;
                    }
                }
            } catch (e: any) {
                console.error('❌ Native Drive Lookup Error:', e.response?.data || e.message);
            }
          } else if (lookupUrl) {
            try {
              log(`🔗 Script Drive Search: "${searchTerm}" (Mode: ${searchMode})`);
              const response = await axios.post(lookupUrl, {
                folder: searchTerm,
                parentId: parentId,
                searchMode: searchMode
              });

              if (response.data.success && response.data.found) {
                log(`✅ Script Found ${response.data.images?.length || 0} images`);
                foundImages = response.data.images || [];
                success = true;
              } else {
                log(`⚠️ Script Lookup Failed or No Images: ${JSON.stringify(response.data)}`);
              }
            } catch (e: any) {
              log(`❌ Script Drive Lookup Error: ${e.message}`);
            }
          }

          if (success && foundImages.length > 0) {
            const outputVar = node.data.outputVariable || 'image_urls';
            variables[outputVar] = JSON.stringify(foundImages.map((img: any) => img.url));
            variables[`${outputVar}_data`] = JSON.stringify(foundImages);
            variables[`${outputVar}_first`] = foundImages[0].url;

            console.log(`✅ Found ${foundImages.length} images for ${searchTerm}`);

            if (node.data.sendAutomatically) {
              const caption = replaceVariables(node.data.caption || '', variables);
              for (const img of foundImages) {
                await sendWhatsAppMessage(session.organizationId, {
                  to: waId, type: 'image', content: '', mediaUrl: img.url, caption: caption || undefined
                });
                // Small delay between images
                await sleep(500);
              }
              // Wait a bit longer after all images before sending the next node message
              await sleep(1000);
            }
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'found')?.target || null;
          } else {
            console.log(`❌ Drive Search: No results for "${searchTerm}"`);
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'not_found')?.target || null;
          }
          
          currentNodeId = nextNodeId;
          continue;

        case 'validator':
          const inputVal = String(replaceVariables(`{{${node.data.inputVariable || 'last_input'}}}`, variables));
          const vType = node.data.validationType || 'email';
          let isValid = false;

          switch (vType) {
            case 'email':
              isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputVal);
              break;
            case 'phone':
              isValid = /^\+?[1-9]\d{1,14}$/.test(inputVal.replace(/\D/g, ''));
              break;
            case 'pan':
              isValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(inputVal.toUpperCase());
              break;
            case 'aadhar':
              isValid = /^[2-9]{1}[0-9]{3}\s[0-9]{4}\s[0-9]{4}$/.test(inputVal) || /^[2-9]{1}[0-9]{11}$/.test(inputVal);
              break;
            case 'gst':
              isValid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(inputVal.toUpperCase());
              break;
            case 'pincode':
              isValid = /^[1-9][0-9]{5}$/.test(inputVal);
              break;
            case 'image':
              isValid = variables['last_message_type'] === 'image';
              break;
            case 'pdf':
              isValid = variables['last_message_type'] === 'document';
              break;
          }

          console.log(`🛡️ Validator [${vType}]: "${inputVal}" -> ${isValid}`);
          
          if (!isValid && node.data.errorMessage) {
            await sendWhatsAppMessage(session.organizationId, {
              to: waId,
              type: 'text',
              content: replaceVariables(node.data.errorMessage, variables)
            });
          }

          nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === (isValid ? 'valid' : 'invalid'))?.target || null;
          currentNodeId = nextNodeId;
          continue;

        case 'phone_parser':
          const countryCode = variables['sender_mobile']?.substring(0, 2); // Simple heuristic
          // In a real app, use a lib like google-libphonenumber
          // For now, we use a basic mapping
          const countryMap: Record<string, string> = { '91': 'India', '1': 'USA/Canada', '44': 'UK', '971': 'UAE', '65': 'Singapore' };
          
          const detectedCode = Object.keys(countryMap).find(code => waId.startsWith(code)) || 'Unknown';
          const detectedName = countryMap[detectedCode] || 'Unknown';
          
          variables[node.data.countryCodeVariable || 'country_code'] = detectedCode;
          variables[node.data.countryNameVariable || 'country_name'] = detectedName;
          
          console.log(`🌍 Phone Parser: ${waId} -> ${detectedName} (${detectedCode})`);
          
          nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === `country_${detectedCode}`)?.target 
                    || edges.find(e => e.source === node.id && e.sourceHandle === 'default')?.target 
                    || null;
          currentNodeId = nextNodeId;
          continue;

        case 'business_hours':
          const tz = node.data.timezone || 'Asia/Kolkata';
          const now = new Date(new Date().toLocaleString("en-US", {timeZone: tz}));
          const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const today = dayNames[now.getDay()];
          
          const startTime = node.data[`${today}_start`] || '09:00';
          const endTime = node.data[`${today}_end`] || '18:00';
          
          const [sH, sM] = startTime.split(':').map(Number);
          const [eH, eM] = endTime.split(':').map(Number);
          
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          const startMinutes = sH * 60 + sM;
          const endMinutes = eH * 60 + eM;
          
          const isOpen = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
          console.log(`🕒 Business Hours [${today}]: ${startTime}-${endTime} (Current: ${now.getHours()}:${now.getMinutes()}) -> ${isOpen ? 'OPEN' : 'CLOSED'}`);
          
          nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === (isOpen ? 'open' : 'closed'))?.target || null;
          currentNodeId = nextNodeId;
          continue;

        case 'agent':
          console.log(`🎧 Handoff to Agent: ${waId}`);
          // Update conversation status to OPEN (Human)
          await (prisma as any).conversation.updateMany({
            where: { waId, organizationId: session.organizationId },
            data: { status: 'OPEN' }
          });
          
          // Optional: Send handoff message
          await sendWhatsAppMessage(session.organizationId, {
            to: waId,
            type: 'text',
            content: replaceVariables(node.data.handoffMessage || 'Connecting you to an agent...', variables)
          });
          
          await terminateSession(session.id);
          return;

        case 'shopify':
          const shop = node.data.shopDomain;
          const authType = node.data.authType || 'token';
          const token = node.data.accessToken;
          const shopifyApiKey = node.data.apiKey;
          const shopifyApiSecret = node.data.apiSecret;
          const rawOrderNum = String(replaceVariables(`{{${node.data.orderVariable || 'order_id'}}}`, variables));
          const outVarShopify = node.data.outputVariable || 'order_details';

          // Clean the order ID (remove # and custom prefix like LRL-)
          let orderNum = rawOrderNum.replace('#', '').trim();
          if (node.data.orderPrefix) {
            orderNum = orderNum.replace(node.data.orderPrefix, '');
          }
          orderNum = orderNum.trim();

          if (shop && orderNum && (token || (shopifyApiKey && shopifyApiSecret))) {
            try {
              console.log(`🛍️ Shopify Search: "${orderNum}" (Original: "${rawOrderNum}") on ${shop}`);
              
              const headers: any = {};
              if (token) {
                // Modern "Custom App" Admin API Access Token
                headers['X-Shopify-Access-Token'] = token;
              } else if (shopifyApiKey && shopifyApiSecret) {
                // Legacy "Private App" Authentication (Discontinued by Shopify)
                console.warn('⚠️ Using legacy Shopify API Key/Secret authentication. This method is discontinued.');
                const creds = Buffer.from(`${shopifyApiKey}:${shopifyApiSecret}`).toString('base64');
                headers['Authorization'] = `Basic ${creds}`;
              }

              // Search by name
              let response = await axios.get(`https://${shop}/admin/api/2024-01/orders.json?name=${orderNum}&status=any`, { headers });
              let orders = response.data.orders || [];

              // Fallback: If not found, try searching with # (some stores handle this differently)
              if (orders.length === 0) {
                response = await axios.get(`https://${shop}/admin/api/2024-01/orders.json?name=%23${orderNum}&status=any`, { headers });
                orders = response.data.orders || [];
              }

              if (orders.length > 0) {
                const order = orders[0];
                variables[outVarShopify] = JSON.stringify(order);
                variables[`${outVarShopify}_total`] = order.total_price;
                variables[`${outVarShopify}_status`] = order.financial_status;
                variables[`${outVarShopify}_fulfillment`] = order.fulfillment_status || 'unfulfilled';
                variables[`${outVarShopify}_customer`] = order.customer?.first_name || 'Customer';
                variables[`${outVarShopify}_tracking_url`] = order.order_status_url || '';
                
                console.log(`✅ Shopify: Order #${order.name} found for ${rawOrderNum}`);
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target || null;
              } else {
                console.log(`❌ Shopify: Order "${orderNum}" not found.`);
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              }
            } catch (e: any) {
              console.error('❌ Shopify Node Error:', e.response?.data || e.message);
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
            }
          }
          currentNodeId = nextNodeId;
          continue;

        case 'woocommerce':
          const storeUrl = node.data.storeUrl?.replace(/\/$/, '');
          const ck = node.data.consumerKey;
          const cs = node.data.consumerSecret;
          const orderId = replaceVariables(`{{${node.data.orderVariable || 'order_id'}}}`, variables);
          const outVarWoo = node.data.outputVariable || 'order_details';

          if (storeUrl && ck && cs && orderId) {
            try {
              console.log(`🛒 WooCommerce Search: ${orderId} on ${storeUrl}`);
              const response = await axios.get(`${storeUrl}/wp-json/wc/v3/orders/${orderId}`, {
                params: { consumer_key: ck, consumer_secret: cs }
              });

              const order = response.data;
              if (order && order.id) {
                variables[outVarWoo] = JSON.stringify(order);
                variables[`${outVarWoo}_total`] = order.total;
                variables[`${outVarWoo}_status`] = order.status;
                variables[`${outVarWoo}_customer`] = order.billing?.first_name || 'Customer';

                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'success')?.target || null;
              } else {
                nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
              }
            } catch (e: any) {
              console.error('❌ WooCommerce Error:', e.response?.data || e.message);
              nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'fail')?.target || null;
            }
          }
          currentNodeId = nextNodeId;
          continue;

        case 'keyword_match':
          // Keywords is now an array of {id, keyword}
          const keywordObjs = node.data.keywords || [];
          const inputVar = node.data.inputVariable || 'last_input';
          const userInput = String(variables[inputVar] || '');
          const isCaseSensitive = node.data.caseSensitive || false;
          
          let matchedHandleId = 'default';
          
          for (const kw of keywordObjs) {
            if (!kw.keyword) continue;
            const inputToCheck = isCaseSensitive ? userInput : userInput.toLowerCase();
            const keywordToCheck = isCaseSensitive ? kw.keyword : kw.keyword.toLowerCase();
            
            // Check if input contains the keyword
            if (inputToCheck.includes(keywordToCheck)) {
              matchedHandleId = kw.id;
              log(`🔑 Keyword Match: "${userInput}" matched "${kw.keyword}" (Handle: ${kw.id})`);
              break;
            }
          }
          
          nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === matchedHandleId)?.target || null;
          
          // FALLBACK: if we thought we matched but no edge exists, try default
          if (!nextNodeId && matchedHandleId !== 'default') {
             nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'default')?.target || null;
          }

          currentNodeId = nextNodeId;
          continue;

        case 'router':
          const switchVar = node.data.variable || 'variable';
          const rawValue = variables[switchVar];
          const resolvedValue = String(rawValue || '').trim();
          const routeObjs = node.data.routes || [];
          
          log(`🔀 [Router] Evaluating {{${switchVar}}} = "${resolvedValue}"`);
          
          let matchedRouteId = null;
          for (const route of routeObjs) {
            const operator = route.operator || '==';
            const targetValue = route.value.trim();
            
            let isMatch = false;
            
            if (operator === '==') {
              isMatch = resolvedValue.toLowerCase() === targetValue.toLowerCase();
            } else {
              // Numeric comparisons
              const numResolved = parseFloat(resolvedValue);
              const numTarget = parseFloat(targetValue);
              
              if (!isNaN(numResolved) && !isNaN(numTarget)) {
                if (operator === '>') {
                  isMatch = numResolved > numTarget;
                } else if (operator === '<') {
                  isMatch = numResolved < numTarget;
                }
              }
            }
            
            if (isMatch) {
              matchedRouteId = route.id;
              log(`✅ [Router] matched Case: "${operator} ${targetValue}" (Handle: ${route.id})`);
              break;
            }
          }
          
          if (matchedRouteId) {
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === matchedRouteId)?.target || null;
          }
          
          // Fallback to default if no specific match OR no edge for specific match
          if (!nextNodeId) {
            log(`⚠️ [Router] No matching edge or case. Using Default path.`);
            nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === 'default')?.target || null;
          }
          
          currentNodeId = nextNodeId;
          continue;

        case 'group_images':
          const rawSource = node.data.arrayVariable || 'image_urls';
          console.log(`[Chatbot] 🔄 Group Images Start. Raw Source: "${rawSource.substring(0, 100)}..."`);
          
          let imgList: string[] = [];
          
          // 1. Resolve variables in the source string (e.g. "Sent images {{order_id}}" -> "Sent images 123")
          // But if it's a pure variable name, it might have been passed without braces
          let resolvedSource = replaceVariables(rawSource, variables).trim();
          
          // 2. Identify the list format
          if (resolvedSource.startsWith('[') && resolvedSource.endsWith(']')) {
              console.log(`[Chatbot] 📦 Source is JSON Array`);
              try { imgList = JSON.parse(resolvedSource); } catch (e) { 
                  console.error(`[Chatbot] ❌ JSON parse error for Group Images:`, e);
              }
          } else if (resolvedSource.includes(',') || resolvedSource.includes('\n')) {
              console.log(`[Chatbot] 🗒️ Source is Delimited List (Comma/Newline)`);
              imgList = resolvedSource.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
          } else if (resolvedSource.startsWith('http')) {
              console.log(`[Chatbot] 🔗 Source is Single URL`);
              imgList = [resolvedSource];
          } else if (variables[rawSource]) {
              console.log(`[Chatbot] 🔑 Source is Variable Lookup: "${rawSource}"`);
              const val = variables[rawSource];
              if (Array.isArray(val)) imgList = val;
              else if (typeof val === 'string') {
                  if (val.startsWith('[')) try { imgList = JSON.parse(val); } catch {}
                  else if (val.includes(',') || val.includes('\n')) imgList = val.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                  else imgList = [val];
              }
          } else {
              // Try resolving rawSource directly if it's just a single URL that replaceVariables didn't touch
              if (rawSource.startsWith('http')) {
                  imgList = [rawSource];
              }
          }
          
          console.log(`[Chatbot] 📋 Initial URL count: ${imgList.length}`);
          
          if (Array.isArray(imgList) && imgList.length > 0) {
              const delayBetweenImgs = parseFloat(node.data.delayBetween || '1');
              const captionTemplate = node.data.caption || '';
              
              for (let i = 0; i < imgList.length; i++) {
                  let imgUrl = imgList[i];
                  if (!imgUrl) continue;
                  
                  imgUrl = convertGoogleDriveLink(imgUrl);
                  
                  if (!imgUrl.startsWith('http')) {
                      console.warn(`[Chatbot] ⚠️ Skipping non-HTTP URL: "${imgUrl}"`);
                      continue;
                  }
                  
                  const finalCaption = replaceVariables(captionTemplate, variables);
                  console.log(`[Chatbot] 📤 [${i+1}/${imgList.length}] Sending Image: ${imgUrl.substring(0, 60)}...`);
                  
                  try {
                      const sendRes = await sendWhatsAppMessage(session.organizationId, {
                          to: waId,
                          type: 'image',
                          content: imgUrl,
                          mediaUrl: imgUrl,
                          caption: i === imgList.length - 1 ? finalCaption : ''
                      });
                      
                      if (sendRes.success) {
                          console.log(`[Chatbot] ✅ [${i+1}/${imgList.length}] SUCCESS. MsgID: ${sendRes.messageId}`);
                      } else {
                          console.error(`[Chatbot] ❌ [${i+1}/${imgList.length}] FAILED: ${sendRes.error}`);
                      }
                  } catch (err: any) {
                      console.error(`[Chatbot] 💥 [${i+1}/${imgList.length}] EXCEPTION:`, err.message);
                  }
                  
                  if (delayBetweenImgs > 0 && i < imgList.length - 1) {
                      console.log(`[Chatbot] ⏱️ Waiting ${delayBetweenImgs}s...`);
                      await new Promise(resolve => setTimeout(resolve, delayBetweenImgs * 1000));
                  }
              }
          } else {
              console.warn(`[Chatbot] ⚠️ No valid image URLs found to send after processing.`);
          }
          break; 


        case 'condition':
          const actualPrefix = node.data.field || '';
          const actual = String(replaceVariables(`{{${actualPrefix}}}`, variables));
          const expected = String(replaceVariables(node.data.value || '', variables));
          const operator = node.data.operator || 'equals';
          
          let match = false;
          const a = actual.toLowerCase().trim();
          const e = expected.toLowerCase().trim();

          if (operator === 'equals') match = a === e;
          else if (operator === 'contains') match = a.includes(e);
          else if (operator === 'not_equals') match = a !== e;
          else if (operator === 'exists') match = actual !== undefined && actual !== null && actual !== '' && actual !== `{{${actualPrefix}}}`;
          
          console.log(`⚖️ Condition: "${actual}" ${operator} "${expected}" -> ${match}`);
          
          nextNodeId = edges.find(e => e.source === node.id && e.sourceHandle === (match ? 'true' : 'false'))?.target || null;
          currentNodeId = nextNodeId;
          continue;

        default:
          console.warn(`⚠️ Unknown node type: ${node.type}`);
      }



      nextNodeId = edges.find(e => e.source === node.id)?.target || null;
      currentNodeId = nextNodeId;

    } catch (nodeErr) {
      console.error(`❌ Node error [${node.type}]:`, nodeErr);
      break;
    }
  }

  // If we exited the loop and haven't 'returned' from a wait node, the flow is over
  if (!currentNodeId) {
    await terminateSession(session.id);
  } else {
    // Save state if we hit a limit or unexpected break
    await (prisma as any).flowSession.update({
      where: { id: session.id },
      data: { currentNodeId, variables: JSON.stringify(variables) }
    });
  }
};

const terminateSession = async (sessionId: string) => {
  await (prisma as any).flowSession.delete({ where: { id: sessionId } });
};

const replaceVariables = (text: string, variables: any) => {
  return text.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    const value = key.trim().split('.').reduce((obj: any, i: string) => obj?.[i], variables);
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
};

const convertGoogleDriveLink = (url: string) => {
  if (!url || typeof url !== 'string') return url;

  // 1. Resolve ID from: https://drive.google.com/file/d/[ID]/view...
  if (url.includes('drive.google.com/file/d/')) {
      const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
  }

  // 2. Resolve ID from: https://lh3.googleusercontent.com/d/[ID]
  if (url.includes('lh3.googleusercontent.com/d/')) {
      const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
  }

  // 3. Resolve ID from: https://drive.google.com/open?id=[ID]
  if (url.includes('drive.google.com/open?id=')) {
      const idMatch = url.match(/id=([a-zA-Z0-9_-]+)/);
      if (idMatch && idMatch[1]) return `https://drive.google.com/uc?export=view&id=${idMatch[1]}`;
  }

  return url;
};
