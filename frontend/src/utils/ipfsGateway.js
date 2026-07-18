// Converts the canonical ipfs:// URI — what's stored on-chain and hashed —
// into a fetchable https:// gateway URL for anything the UI makes clickable
// or fetches client-side. Browsers can't resolve ipfs:// directly, so every
// display link and every client-side re-fetch (invoice verification) needs
// this; the ipfs:// form itself should never be swapped out for the gateway
// form in state or on-chain.
const GATEWAY_HOST = import.meta.env.VITE_PINATA_GATEWAY || 'moccasin-impressed-gibbon-651.mypinata.cloud'

/**
 * @param {string} ipfsUri e.g. "ipfs://bafy..."
 * @returns {string} an https:// URL through the configured gateway, or the
 *          input unchanged if it isn't an ipfs:// URI (e.g. a legacy plain
 *          link on an escrow created before this feature).
 */
export function toGatewayUrl(ipfsUri) {
  if (typeof ipfsUri !== 'string' || !ipfsUri.startsWith('ipfs://')) return ipfsUri
  const cid = ipfsUri.slice('ipfs://'.length)
  return `https://${GATEWAY_HOST}/ipfs/${cid}`
}
