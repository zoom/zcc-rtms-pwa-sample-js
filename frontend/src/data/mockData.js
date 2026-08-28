export const MOCK_SUMMARY = {
  engagementId: 'demo-engagement-001',
  generatedAt: new Date().toISOString(),
  agentName: 'Sarah Johnson',
  consumerName: 'Marcus Thompson',
  stats: {
    durationMs: 7 * 60 * 1000 + 43 * 1000,
    holdPct: '20.4',
    holdCount: 2,
    transferCount: 1,
    conferenceCount: 0,
  },
  transferDetails: '- Transfer to Billing Support at 3m 12s into the call',
  conferenceDetails: '',
  aiSummary: 'The customer called in regarding a billing discrepancy on their account, specifically an unrecognized charge from the previous billing cycle. The agent greeted the customer professionally, verified their identity, and quickly located the account. After reviewing the transaction history, the agent identified an erroneous duplicate charge and applied a $34.99 credit. The customer expressed frustration mid-call when placed on hold without being told the reason, but was satisfied with the resolution. The call ended positively with the customer confirming the credit and thanking the agent.',
  coachingNotes: [
    { type: 'positive', note: 'Strong opening — agent verified identity and pulled up the account within the first 30 seconds.' },
    { type: 'positive', note: 'Correct escalation path used when the billing system flagged the duplicate charge.' },
    { type: 'improve', note: 'Customer was placed on hold without explanation at 2m 14s. Always inform the customer why they are being placed on hold and provide an estimated wait time.' },
    { type: 'improve', note: 'Agent did not offer to send a confirmation email after applying the credit — a missed opportunity to reinforce trust.' },
    { type: 'neutral', note: 'Transfer to billing queue was appropriate given the charge type, though the agent could have resolved this independently with Level 2 access.' },
  ],
  eventLog: [
    { message: 'Agent placed consumer on hold.', reason: 'The agent placed the customer on hold to look up the details of the disputed charge from the previous billing cycle.', timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), elapsedMs: 2 * 60 * 1000 + 14 * 1000 },
    { message: 'Agent initiated a transfer.', reason: "Customer's issue requires a specialised team.", timestamp: new Date(Date.now() - 4 * 60 * 1000).toISOString(), elapsedMs: 3 * 60 * 1000 + 12 * 1000 },
    { message: 'Agent placed consumer on hold.', reason: 'The agent placed the customer on hold to verify the credit approval with the billing team before confirming with the customer.', timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), elapsedMs: 5 * 60 * 1000 + 30 * 1000 },
  ],
};
