// viem-based contract event listener with reconnection.
// Reads the ABI from the Foundry build artifact at out/TrancheProtocol.sol/TrancheProtocol.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, defineChain, http } from 'viem';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = path.resolve(
  __dirname,
  '../../out/TrancheProtocol.sol/TrancheProtocol.json',
);

export function loadAbi() {
  if (!fs.existsSync(ARTIFACT_PATH)) {
    throw new Error(
      `Foundry artifact not found at ${ARTIFACT_PATH}. Run 'forge build' in the project root first.`,
    );
  }
  const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  return artifact.abi;
}

export function createArcChain({ chainId, rpcUrl, name = 'Arc Testnet' }) {
  return defineChain({
    id: Number(chainId),
    name,
    network: 'arc-testnet',
    nativeCurrency: { name: 'Arc', symbol: 'ARC', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
  });
}

export function createListener({
  rpcUrl,
  chainId,
  contractAddress,
  abi,
  notifier,
  pollingIntervalMs = 4_000,
  reconnectDelayMs = 5_000,
}) {
  const chain = createArcChain({ chainId, rpcUrl });
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl, { retryCount: 3, retryDelay: 1_000 }),
  });

  const status = {
    connected: false,
    lastEventAt: null,
    watchingFrom: null,
    contractAddress,
    rpcUrl,
  };

  const unwatchers = new Map(); // event name -> unwatch fn

  // ---------- contract reader helpers (passed to notifier) ----------

  async function getEscrow(escrowId) {
    const r = await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'escrows',
      args: [BigInt(escrowId)],
    });
    // The auto-generated getter returns a tuple matching the Escrow struct
    // member order (mappings/arrays skipped, dynamic byte fields included):
    // [depositor, recipient, refundTo, totalAmount, destinationDomain,
    //  mintRecipient, reviewWindow, depositorApproveCancel,
    //  recipientApproveCancel, invoiceHash, invoiceURI, deadline,
    //  milestoneCount, state, escrowCctpForwardFee]
    return {
      depositor: r[0],
      recipient: r[1],
      refundTo: r[2],
      totalAmount: r[3],
      destinationDomain: r[4],
      mintRecipient: r[5],
      reviewWindow: r[6],
      depositorApproveCancel: r[7],
      recipientApproveCancel: r[8],
      invoiceHash: r[9],
      invoiceURI: r[10],
      deadline: r[11],
      milestoneCount: r[12],
      state: r[13], // 0=ACTIVE, 1=COMPLETED, 2=CANCELLED
      escrowCctpForwardFee: r[14],
    };
  }

  async function getMilestone(escrowId, milestoneIndex) {
    const r = await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'milestones',
      args: [BigInt(escrowId), BigInt(milestoneIndex)],
    });
    return {
      amount: r[0],
      claimedAt: r[1],
      state: r[2], // 0=PENDING, 1=IN_REVIEW, 2=DISPUTED, 3=RELEASED, 4=REFUNDED
    };
  }

  async function getEscrowCount() {
    return await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'escrowCount',
      args: [],
    });
  }

  async function getDispute(escrowId, milestoneIndex) {
    const r = await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'disputes',
      args: [BigInt(escrowId), BigInt(milestoneIndex)],
    });
    // Tuple order: disputedBy, evidenceHash, evidenceURI, reason,
    // counterEvidenceHash, counterEvidenceURI, resolutionHash, raisedAt.
    return {
      disputedBy: r[0],
      evidenceHash: r[1],
      evidenceURI: r[2],
      reason: r[3],
      counterEvidenceHash: r[4],
      counterEvidenceURI: r[5],
      resolutionHash: r[6],
      raisedAt: r[7],
    };
  }

  async function getRefundBalance(wallet) {
    return await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'refundBalances',
      args: [wallet],
    });
  }

  let cachedArbiterTimeout = null;
  async function getArbiterInactionTimeout() {
    if (cachedArbiterTimeout !== null) return cachedArbiterTimeout;
    const v = await client.readContract({
      address: contractAddress,
      abi,
      functionName: 'ARBITER_INACTION_TIMEOUT',
      args: [],
    });
    cachedArbiterTimeout = v;
    return v;
  }

  // ---------- event watching with reconnect ----------

  let handlersRef = notifier.handlers;

  function setHandlers(handlers) {
    handlersRef = handlers;
  }

  function startWatching() {
    for (const [eventName, handler] of Object.entries(handlersRef)) {
      armWatcher(eventName, handler);
    }

    client
      .getBlockNumber()
      .then((bn) => {
        status.connected = true;
        status.watchingFrom = bn.toString();
        logger.info('listener watching', {
          contract: contractAddress,
          fromBlock: status.watchingFrom,
        });
      })
      .catch((err) => {
        status.connected = false;
        logger.error('failed to fetch block number', { message: err.message });
      });
  }

  function armWatcher(eventName, handler) {
    const unwatch = client.watchContractEvent({
      address: contractAddress,
      abi,
      eventName,
      pollingInterval: pollingIntervalMs,
      onLogs: async (logs) => {
        status.connected = true;
        status.lastEventAt = Date.now();
        for (const log of logs) {
          try {
            await handler(log);
          } catch (err) {
            logger.error('event handler threw', {
              eventName,
              message: err.message,
              stack: err.stack?.split('\n').slice(0, 3).join(' | '),
            });
          }
        }
      },
      onError: (err) => {
        status.connected = false;
        logger.warn('watcher error, will reconnect', {
          eventName,
          message: err.message,
        });
        // Tear down then re-arm after a delay.
        try {
          unwatchers.get(eventName)?.();
        } catch {}
        unwatchers.delete(eventName);
        setTimeout(() => {
          logger.info('reconnecting watcher', { eventName });
          armWatcher(eventName, handler);
        }, reconnectDelayMs);
      },
    });
    unwatchers.set(eventName, unwatch);
  }

  function stop() {
    for (const [name, fn] of unwatchers.entries()) {
      try {
        fn();
      } catch (err) {
        logger.warn('unwatch failed', { eventName: name, message: err.message });
      }
    }
    unwatchers.clear();
    status.connected = false;
  }

  function getStatus() {
    return { ...status };
  }

  return {
    client,
    start: startWatching,
    stop,
    setHandlers,
    getStatus,
    getEscrow,
    getMilestone,
    getEscrowCount,
    getDispute,
    getRefundBalance,
    getArbiterInactionTimeout,
  };
}
