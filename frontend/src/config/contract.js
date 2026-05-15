import { CONTRACT_ADDRESS, USDC_ADDRESS } from './wagmi'

export { CONTRACT_ADDRESS, USDC_ADDRESS }

// Minimal ERC20 ABI we need
export const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
]

// Components for ICrossChainEscrow.EscrowSummary, used by several view ABIs below.
function ESCROW_SUMMARY_COMPONENTS() {
  return [
    { name: 'escrowId', type: 'uint256' },
    { name: 'depositor', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'totalAmount', type: 'uint256' },
    { name: 'state', type: 'uint8' },
    { name: 'deadline', type: 'uint256' },
    { name: 'milestoneCount', type: 'uint256' },
    { name: 'releasedMilestoneCount', type: 'uint256' },
    { name: 'disputedMilestoneCount', type: 'uint256' },
    { name: 'invoiceHash', type: 'bytes32' },
    { name: 'invoiceURI', type: 'string' }
  ]
}

// CrossChainEscrow ABI
export const ESCROW_ABI = [
  // ----- Roles & admin views -----
  { type: 'function', name: 'ARBITER_ROLE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'PAUSER_ROLE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'DOMAIN_MANAGER_ROLE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'DEFAULT_ADMIN_ROLE', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hasRole', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'getRoleMember', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getRoleMemberCount', stateMutability: 'view', inputs: [{ name: 'role', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'grantRole', stateMutability: 'nonpayable', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [] },
  { type: 'function', name: 'revokeRole', stateMutability: 'nonpayable', inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }], outputs: [] },

  // ----- Misc state -----
  { type: 'function', name: 'escrowCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'protocolFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'protocolTreasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'cctpForwardFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'supportedDomains', stateMutability: 'view', inputs: [{ type: 'uint32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'refundBalances', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },

  // ----- Escrow / Milestone / Dispute getters -----
  {
    type: 'function', name: 'escrows', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'refundTo', type: 'address' },
      { name: 'totalAmount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'disputeWindow', type: 'uint256' },
      { name: 'depositorApproveCancel', type: 'bool' },
      { name: 'recipientApproveCancel', type: 'bool' },
      { name: 'invoiceHash', type: 'bytes32' },
      { name: 'invoiceURI', type: 'string' },
      { name: 'deadline', type: 'uint256' },
      { name: 'milestoneCount', type: 'uint256' },
      { name: 'state', type: 'uint8' },
      { name: 'deliveryNoticeWindow', type: 'uint256' }
    ]
  },
  {
    type: 'function', name: 'milestones', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'conditionMetTimestamp', type: 'uint256' },
      { name: 'state', type: 'uint8' },
      { name: 'deliveredAt', type: 'uint256' }
    ]
  },
  {
    type: 'function', name: 'disputes', stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }],
    outputs: [
      { name: 'disputedBy', type: 'address' },
      { name: 'evidenceHash', type: 'bytes32' },
      { name: 'evidenceURI', type: 'string' },
      { name: 'reason', type: 'string' },
      { name: 'counterEvidenceHash', type: 'bytes32' },
      { name: 'counterEvidenceURI', type: 'string' },
      { name: 'resolutionHash', type: 'bytes32' },
      { name: 'raisedAt', type: 'uint256' }
    ]
  },

  // ----- Aggregated view functions (added for frontend efficiency) -----
  {
    type: 'function', name: 'getRefundBalance', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function', name: 'getEscrow', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'depositor', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'refundTo', type: 'address' },
        { name: 'totalAmount', type: 'uint256' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'disputeWindow', type: 'uint256' },
        { name: 'depositorApproveCancel', type: 'bool' },
        { name: 'recipientApproveCancel', type: 'bool' },
        { name: 'invoiceHash', type: 'bytes32' },
        { name: 'invoiceURI', type: 'string' },
        { name: 'deadline', type: 'uint256' },
        { name: 'milestoneCount', type: 'uint256' },
        { name: 'state', type: 'uint8' },
        { name: 'deliveryNoticeWindow', type: 'uint256' }
      ]
    }]
  },
  {
    type: 'function', name: 'getMilestones', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint256' },
        { name: 'conditionMetTimestamp', type: 'uint256' },
        { name: 'state', type: 'uint8' },
        { name: 'deliveredAt', type: 'uint256' }
      ]
    }]
  },
  {
    type: 'function', name: 'getDisputes', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'disputedBy', type: 'address' },
        { name: 'evidenceHash', type: 'bytes32' },
        { name: 'evidenceURI', type: 'string' },
        { name: 'reason', type: 'string' },
        { name: 'counterEvidenceHash', type: 'bytes32' },
        { name: 'counterEvidenceURI', type: 'string' },
        { name: 'resolutionHash', type: 'bytes32' },
        { name: 'raisedAt', type: 'uint256' }
      ]
    }]
  },
  {
    type: 'function', name: 'getSplits', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [{
      type: 'tuple[]',
      components: [
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'bps', type: 'uint256' }
      ]
    }]
  },
  {
    type: 'function', name: 'isDisputeWindowExpired', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function', name: 'isDeliverySignaled', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function', name: 'getRole', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'caller', type: 'address' }],
    outputs: [
      { name: 'isPayer', type: 'bool' },
      { name: 'isFreelancer', type: 'bool' },
      { name: 'isArbiter', type: 'bool' }
    ]
  },
  {
    type: 'function', name: 'getEscrowDetail', stateMutability: 'view',
    inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'caller', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'escrowId', type: 'uint256' },
        {
          name: 'escrow', type: 'tuple',
          components: [
            { name: 'depositor', type: 'address' },
            { name: 'recipient', type: 'address' },
            { name: 'refundTo', type: 'address' },
            { name: 'totalAmount', type: 'uint256' },
            { name: 'destinationDomain', type: 'uint32' },
            { name: 'mintRecipient', type: 'bytes32' },
            { name: 'disputeWindow', type: 'uint256' },
            { name: 'depositorApproveCancel', type: 'bool' },
            { name: 'recipientApproveCancel', type: 'bool' },
            { name: 'invoiceHash', type: 'bytes32' },
            { name: 'invoiceURI', type: 'string' },
            { name: 'deadline', type: 'uint256' },
            { name: 'milestoneCount', type: 'uint256' },
            { name: 'state', type: 'uint8' },
            { name: 'deliveryNoticeWindow', type: 'uint256' }
          ]
        },
        {
          name: 'milestones', type: 'tuple[]',
          components: [
            { name: 'amount', type: 'uint256' },
            { name: 'conditionMetTimestamp', type: 'uint256' },
            { name: 'state', type: 'uint8' },
            { name: 'deliveredAt', type: 'uint256' }
          ]
        },
        {
          name: 'disputes', type: 'tuple[]',
          components: [
            { name: 'disputedBy', type: 'address' },
            { name: 'evidenceHash', type: 'bytes32' },
            { name: 'evidenceURI', type: 'string' },
            { name: 'reason', type: 'string' },
            { name: 'counterEvidenceHash', type: 'bytes32' },
            { name: 'counterEvidenceURI', type: 'string' },
            { name: 'resolutionHash', type: 'bytes32' },
            { name: 'raisedAt', type: 'uint256' }
          ]
        },
        {
          name: 'splits', type: 'tuple[]',
          components: [
            { name: 'mintRecipient', type: 'bytes32' },
            { name: 'destinationDomain', type: 'uint32' },
            { name: 'bps', type: 'uint256' }
          ]
        },
        { name: 'disputeWindowExpired', type: 'bool[]' },
        { name: 'deliverySignaled', type: 'bool[]' },
        { name: 'effectiveDisputeDeadlines', type: 'uint256[]' },
        { name: 'isPayer', type: 'bool' },
        { name: 'isFreelancer', type: 'bool' },
        { name: 'isArbiter', type: 'bool' }
      ]
    }]
  },
  {
    type: 'function', name: 'getEscrowsForPayer', stateMutability: 'view',
    inputs: [{ name: 'payer', type: 'address' }],
    outputs: [{
      type: 'tuple[]',
      components: ESCROW_SUMMARY_COMPONENTS()
    }]
  },
  {
    type: 'function', name: 'getEscrowsForFreelancer', stateMutability: 'view',
    inputs: [{ name: 'freelancer', type: 'address' }],
    outputs: [{
      type: 'tuple[]',
      components: ESCROW_SUMMARY_COMPONENTS()
    }]
  },
  {
    type: 'function', name: 'getActiveEscrowCount', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function', name: 'getOpenDisputeCount', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function', name: 'getDashboard', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'asPayer', type: 'tuple[]', components: ESCROW_SUMMARY_COMPONENTS() },
        { name: 'asFreelancer', type: 'tuple[]', components: ESCROW_SUMMARY_COMPONENTS() },
        { name: 'activeEscrowCount', type: 'uint256' },
        { name: 'openDisputeCount', type: 'uint256' },
        { name: 'refundBalance', type: 'uint256' }
      ]
    }]
  },
  {
    type: 'function', name: 'getDisputedEscrows', stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple[]',
      components: ESCROW_SUMMARY_COMPONENTS()
    }]
  },
  {
    type: 'function', name: 'getCallerRoles', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'isDefaultAdmin', type: 'bool' },
        { name: 'isArbiter', type: 'bool' },
        { name: 'isPauser', type: 'bool' },
        { name: 'isDomainManager', type: 'bool' }
      ]
    }]
  },
  {
    type: 'function', name: 'getProtocolConfig', stateMutability: 'view',
    inputs: [],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'usdc', type: 'address' },
        { name: 'tokenMessenger', type: 'address' },
        { name: 'protocolTreasury', type: 'address' },
        { name: 'protocolFeeBps', type: 'uint256' },
        { name: 'maxProtocolFeeBps', type: 'uint256' },
        { name: 'cctpForwardFee', type: 'uint256' },
        { name: 'arcDomain', type: 'uint32' },
        { name: 'escrowCount', type: 'uint256' },
        { name: 'paused', type: 'bool' }
      ]
    }]
  },

  // ----- Writes -----
  {
    type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [
      { name: '_recipient', type: 'address' },
      { name: '_refundTo', type: 'address' },
      { name: '_totalAmount', type: 'uint256' },
      { name: '_destinationDomain', type: 'uint32' },
      { name: '_mintRecipient', type: 'bytes32' },
      { name: '_disputeWindow', type: 'uint256' },
      { name: '_deliveryNoticeWindow', type: 'uint256' },
      { name: '_invoiceHash', type: 'bytes32' },
      { name: '_invoiceURI', type: 'string' },
      { name: '_milestoneAmounts', type: 'uint256[]' },
      { name: '_deadline', type: 'uint256' },
      {
        name: '_splits', type: 'tuple[]',
        components: [
          { name: 'mintRecipient', type: 'bytes32' },
          { name: 'destinationDomain', type: 'uint32' },
          { name: 'bps', type: 'uint256' }
        ]
      }
    ],
    outputs: [{ name: 'escrowId', type: 'uint256' }]
  },
  { type: 'function', name: 'fulfillCondition', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'raiseDispute', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { name: '_reason', type: 'string' }, { name: '_evidenceHash', type: 'bytes32' }, { name: '_evidenceURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'submitCounterEvidence', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { name: '_counterEvidenceHash', type: 'bytes32' }, { name: '_counterEvidenceURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'resolveDispute', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { name: 'releaseToRecipient', type: 'bool' }, { name: '_resolutionHash', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'releaseAfterWindow', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { name: 'maxFee', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'escalateAfterDeadline', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { name: '_reason', type: 'string' }, { name: '_evidenceHash', type: 'bytes32' }, { name: '_evidenceURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'mutualCancel', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdrawRefund', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }], outputs: [] },
  { type: 'function', name: 'updateReceivingAddress', stateMutability: 'nonpayable', inputs: [{ name: 'escrowId', type: 'uint256' }, { name: 'newAddress', type: 'bytes32' }, { name: 'newDestinationDomain', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'signalDelivery', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimSilentApproval', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'addSupportedDomain', stateMutability: 'nonpayable', inputs: [{ type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'removeSupportedDomain', stateMutability: 'nonpayable', inputs: [{ type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'setCctpForwardFee', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },

  // ----- Events -----
  {
    type: 'event', name: 'EscrowCreated',
    inputs: [
      { name: 'escrowId', type: 'uint256', indexed: true },
      { name: 'depositor', type: 'address', indexed: false },
      { name: 'recipient', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'invoiceHash', type: 'bytes32', indexed: false },
      { name: 'invoiceURI', type: 'string', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event', name: 'ReceivingAddressUpdated',
    inputs: [
      { name: 'escrowId', type: 'uint256', indexed: true },
      { name: 'oldAddress', type: 'bytes32', indexed: false },
      { name: 'newAddress', type: 'bytes32', indexed: false },
      { name: 'oldDomain', type: 'uint32', indexed: false },
      { name: 'newDomain', type: 'uint32', indexed: false }
    ]
  }
]
