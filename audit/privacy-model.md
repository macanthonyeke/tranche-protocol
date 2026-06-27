# Tranche Protocol — Privacy Model & Mainnet Roadmap

> Prepared for the Circle/Arc mainnet grant application. This document maps what Tranche
> currently exposes on-chain and off-chain, identifies the three privacy problems facing our
> users (freelancers, remote teams, DAOs), and proposes a three-layer selective-disclosure model
> aligned with Arc's committed network-level privacy roadmap (confidential transfers → fully
> programmable privacy).

Two facts shape the entire model:

1. **Content privacy is already partially built.** The frontend ships a "private mode" that puts
   only a `keccak256` commitment of the invoice on-chain and keeps the invoice JSON client-side;
   the counterparty verifies a local file against that commitment. This is the only real privacy
   primitive in the system today — the roadmap hardens it, it does not start from zero.
2. **Dispute resolution is denominated in basis points, not absolute USDC.** `resolveDispute`
   takes `recipientBps` (0–10000); fees and splits are all bps. The arbiter rules on a *percentage*,
   never a dollar figure. This is what makes Arc-native amount privacy compatible with the
   trustless arbiter model with almost no protocol redesign.

---

## 1. Complete Data Exposure Map

### On-chain public (block explorer / RPC)

**Escrow struct** (`mapping(uint256 => Escrow) public escrows`):

| Field | Type | Exposes |
|---|---|---|
| `depositor` | address | Payer identity (plaintext) |
| `recipient` | address | Service provider identity (plaintext) |
| `refundTo` | address | Refund address (plaintext) |
| `totalAmount` | uint256 | **Full escrow value in USDC** |
| `destinationDomain` | uint32 | Destination CCTP chain |
| `mintRecipient` | bytes32 | Cross-chain payout address |
| `reviewWindow` | uint256 | Review window seconds |
| `depositorApproveCancel` / `recipientApproveCancel` | bool | Cancellation votes |
| `invoiceHash` | bytes32 | **Commitment only** — not content |
| `invoiceURI` | string | **Raw external pointer** (plaintext) |
| `deadline` | uint256 | Delivery deadline |
| `milestoneCount` | uint256 | Milestone count |
| `state` | enum | ACTIVE / COMPLETED / CANCELLED |
| `escrowCctpForwardFee` | uint256 | Snapshotted forward fee |

**Milestone struct** (`mapping … public milestones`): `amount` (uint256, **per-milestone USDC**),
`claimedAt` (timestamp), `state` (enum PENDING/IN_REVIEW/DISPUTED/RELEASED/REFUNDED).

**DisputeData struct** (`mapping … public disputes`): `raisedBy` (address), `raisedAt`,
`evidenceHash`/`counterEvidenceHash`/`resolutionHash` (bytes32 **commitments**),
`evidenceURI`/`counterEvidenceURI`/`resolutionURI` (**raw strings**), `reason` (**plaintext string,
on-chain**), `resolvedRecipientBps` (uint256 split outcome).

**SplitRecipient[]**: `mintRecipient` (bytes32), `destinationDomain` (uint32), `bps` (share).

**Events** — every one is plaintext; selected high-signal ones:
- `EscrowCreated(escrowId, depositor, recipient, amount, invoiceHash, invoiceURI, deadline)` —
  both parties, amount, deadline, invoice pointer in one log.
- `InvoiceSnapshotted(escrowId, invoiceData)` — emits the **full invoice JSON** (only when the
  depositor did *not* choose private mode; otherwise an empty string).
- `DisputeRaised(escrowId, raisedBy, milestoneIndex, reason, evidenceHash)` — **plaintext dispute
  reason** in the log.
- `EvidenceAppended(escrowId, milestoneIndex, caller, hash, uri, timestamp)` — caller identity +
  evidence URI; not stored in contract storage (event-only, indexer reconstructs the thread).
- `DisputeResolved(escrowId, milestoneIndex, recipientBps, resolutionHash, resolutionURI)`,
  `MutualSettlementExecuted`, `DisputeTimedOutSettled(…, defaultBps)`, `PartialRefundCredited`,
  `RefundWithdrawn`, `RefundCreditTransferred`, `InvoiceURIUpdated(escrowId, oldURI, newURI)`,
  `EscrowTermsSnapshotted(escrowId, protocolFeeBps, protocolTreasury)`.

**Type summary:** addresses (depositor, recipient, refundTo, splits, callers), amounts
(totalAmount, milestone amounts, fees, refunds, bps), timestamps (deadline, claimedAt, raisedAt,
reviewDeadline), plaintext strings (invoiceURI, dispute reason, evidence/resolution URIs), hashes
(invoiceHash + all evidence/resolution hashes — commitments, not content).

### Off-chain queryable (Goldsky subgraph)

The subgraph re-exposes everything above and adds **parsed, structured invoice content** —
turning the protocol into a trivially graphable payment network.

- **Escrow**: `depositor`, `recipient`, `totalAmount`, `invoiceHash`, `invoiceURI`, `deadline`,
  state/counters, `createdTx`, **`invoiceData` (raw JSON string)**, **`invoiceNumber`** and
  **`titles: [String!]`** (line-item work descriptions parsed in `handleInvoiceSnapshotted`),
  `invoiceAcknowledgedAt`, `invoiceAcknowledgedBy`.
- **Dispute**: `raisedBy`, **`reason` (plaintext)**, `evidenceHash`, `counteredBy`,
  `counterEvidenceHash`, `resolutionBps`, `resolutionURI`, `resolutionType`.
- **EvidenceEntry**: `caller`, `hash`, **`uri` (plaintext pointer)**, `timestamp`.
- **Split**, **RefundBalance** (per-wallet running USDC credit), **RefundCredit**,
  **InvoiceURIUpdate** (`oldURI`/`newURI` — full audit trail of pointer changes).

Anyone can query "all escrows where depositor = X" or "all counterparties of wallet Y" and get
amounts, timing, and work descriptions in a single call.

### What is private today

- **Invoice content in "private mode"**: the frontend computes `keccak256(invoiceJson)` and sends
  only the hash; `invoiceData` goes out as `''`. The JSON never touches chain or subgraph. The
  counterparty drops the file locally to verify it against the on-chain commitment. **This is a
  working hash-commitment scheme — the only real privacy primitive in the system today.**
- **Evidence / attachment *content***: never on-chain. Only a URI + hash (`SHA-256` of file bytes,
  or `keccak256` of the URI) is stored. Whether the content is actually private depends entirely
  on where the user hosts it (a public IPFS pin is fully readable).
- **Nothing is encrypted.** All cryptography in the system is hashing for integrity/commitment
  (`keccak256`, Web Crypto `SHA-256`). No AES, no NaCl/libsodium, no ECIES, no key derivation, no
  recipient/arbiter pubkey registry, no storage/key configuration.

---

## 2. The Three Privacy Problems

### Content privacy — *partially addressed; weakest link is evidence*
- **Exposed:** in default (public) mode, full invoice JSON — invoice number, per-milestone work
  titles, amounts, dates, notes — is on-chain via `InvoiceSnapshotted` and parsed into queryable
  subgraph fields. Dispute `reason` is plaintext on-chain. Evidence URIs are plaintext; content
  privacy is outsourced to wherever the user hosts the file.
- **Harms:** freelancers leak client lists and rate cards; DAOs leak vendor relationships and the
  nature of contracted work; a plaintext dispute reason can permanently leak confidential or
  defamatory text.
- **Severity:** Medium–High, but **already mitigable** — private mode removes invoice content
  today. Residual gaps: it's opt-in/default-off, dispute `reason` has no private mode, and there is
  no protocol-assisted encrypted evidence channel.

### Relationship privacy — *not addressed at all; structurally hardest*
- **Exposed:** `depositor` ↔ `recipient` is the core of every escrow, on-chain and indexed. The
  subgraph turns this into a ready-made who-pays-whom graph, including amounts and timing.
- **Harms:** most damaging for our users. A freelancer's entire client roster, income cadence, and
  rates are reconstructable from one address. A DAO's contributor payroll and vendor map are fully
  public. Competitors, recruiters, and chain-analysis firms get it for free.
- **Severity:** **Highest.** Cannot be fixed at the application layer alone — requires unlinkable
  payment destinations (stealth addresses) and/or Arc's programmable privacy.

### Amount privacy — *not addressed; but cleanly deferrable to Arc*
- **Exposed:** `totalAmount` and every milestone `amount`, fee, refund, and settlement is plaintext
  USDC on-chain and in the subgraph.
- **Harms:** reveals contract sizes, freelancer income, DAO treasury outflows, and (via fee bps)
  protocol revenue. Combined with relationship data, a full financial profile.
- **Severity:** High — but **exactly what Arc has committed to solving natively** with confidential
  transfers. Tranche should not build ZK amount-hiding itself; it should architect to inherit it.
  The bps-denominated settlement model makes that inheritance unusually clean.

---

## 3. The Three-Layer Selective-Disclosure Model

### Layer 1 — Application-level privacy (Tranche builds; no Arc changes)

Harden the existing commitment scheme into a real selective-disclosure system:

1. **Promote private mode to default** for invoice content. Keep the `keccak256` commitment on-chain
   (already implemented); the JSON stays off-chain. This removes `invoiceData`, `titles`,
   `invoiceNumber` from public exposure.
2. **Encrypted invoice payload with counterparty reveal.** Replace "withhold entirely" with
   "encrypt-to-recipient": the frontend encrypts the invoice JSON to the recipient's public key
   (ECIES / `x25519` + `xsalsa20-poly1305`). Ciphertext goes to off-chain storage; the on-chain
   commitment stays the same `invoiceHash`. Requires a lightweight **public-key registry** (a
   wallet publishes an encryption pubkey, or derives one deterministically from a signature) — the
   one genuinely new primitive Layer 1 needs.
3. **Encrypted dispute evidence revealed only to the arbiter.** Evidence is encrypted to the
   arbiter's published pubkey (plus the submitting party). Only `hash` + a ciphertext pointer go
   on-chain — the existing `evidenceHash`/`uri` fields already carry exactly this shape, so **no
   contract change is required**, only frontend encryption + an arbiter pubkey in the registry.
4. **Private dispute reason.** Apply the invoice's commitment treatment to the `reason` string
   (commit a hash, encrypt the text to the arbiter). This is a contract touch if the on-chain
   `reason` is to become a hash; until then the frontend should simply stop placing sensitive prose
   in `reason`.

**Net:** content privacy becomes strong and default-on, with disclosure routed to exactly the
counterparty and the arbiter — without touching Arc and mostly without touching the contract.
Layer 1 cannot fix relationship or amount privacy: parties and amounts are intrinsic to the
contract's logic and must be visible *to the contract* today.

### Layer 2 — Arc-native amount privacy (Arc ships; Tranche inherits)

When Arc ships **confidential transfers** (confidential USDC balances), Tranche integrates them so
escrowed amounts, milestone values, fees, and payouts are hidden from third-party observers.

**Why this fits Tranche almost for free — the bps insight:**
- The optimistic flow (`claimDelivery` → review window → permissionless `release`) is **purely
  time-based**; it never reads an amount to decide *whether* to release. It works unchanged with
  hidden amounts.
- **Dispute resolution is denominated in basis points.** `resolveDispute(recipientBps)`,
  `mutualSettle(bps)`, and the 50/50 timeout rule on *proportions*. **The arbiter never needs the
  dollar amount to render a fair decision** — they judge merits and assign a percentage, then the
  confidential-transfer primitive applies that proportion to a hidden balance. Amount privacy does
  not break arbitration.
- Protocol fee and splits are also bps — same story.

**The real integration question:** whether Arc's confidential-transfer primitive supports
**proportional (scalar-by-bps) transfers over hidden balances** — "send `recipientBps/10000` of
this confidential balance to A, the remainder to B" — performed by the contract without revealing
cleartext. If yes, the whole settlement path inherits amount privacy with the contract still
computing only in bps. If the primitive hides *balances* but needs cleartext *amounts* at transfer
time, then in this layer the parties + contract still know the amount (via viewing keys) while
third parties don't — already a large win.

**Open implications to flag:** (a) CCTP V2 burn/mint legs currently carry a visible USDC amount —
confidential cross-chain settlement depends on how Arc + CCTP compose, so confidential amounts may
land first for *same-chain* (Arc-domain) settlement; (b) the permissionless `release()` path must
stay triggerable by an outsider who can see the *timer* expired but not the value — compatible,
since release reads time, not amount.

### Layer 3 — Fully programmable privacy (Arc's longer-term roadmap)

When Arc ships **private function execution**, Tranche can hide the **relationship** dimension and
run escrow logic privately. A fully private escrow:
- **Hidden parties:** depositor↔recipient linkage concealed (stealth / one-time payout addresses,
  private state for the binding). The public graph stops revealing who works with whom.
- **Hidden amounts + content:** subsumes Layers 1–2.
- **Private contract logic:** milestone state transitions and bps math execute without revealing
  inputs.

**Irreducible public minimum** (what must stay public for trustlessness to hold):
1. **That an escrow exists and which state it is in** — enough for the *permissionless* release and
   timeout paths to be pokeable. If everything is private, no third party can trigger
   `release()`/`resolveDisputeByTimeout()`; this likely resolves to the parties (or a relayer with
   a viewing key) being the pokers, but the existence + timer of a pending settlement is the hard
   floor.
2. **The arbiter's authority binding** — the arbiter must be petitionable, and their `ARBITER_ROLE`
   ruling must be verifiably the one that moved funds, even if parties/amount/evidence are private.
3. **Protocol-fee accountability and contract rules** — the rules and that fees were taken per the
   rules must be auditable (can be aggregate / ZK-proven rather than per-escrow).

Everything else — identities, amounts, invoice and evidence content, the per-escrow graph — can be
private.

---

## 4. The Core Tension: Privacy vs. Trustlessness

An escrow's trustlessness comes from a third party being able to *verify and act* without trusting
the participants — but privacy is precisely the act of hiding information from third parties, so the
two pull against each other. In Tranche the irreducible public anchor is the **arbiter dispute
path**: an arbiter must be petitionable, must see enough to rule, and their ruling must be publicly
verifiable as the thing that released funds — otherwise "neutral arbitration" is just trust. The
good news is that what the arbiter needs is **merit plus a proportion, not identities or dollar
amounts**: because resolution is denominated in basis points, the arbiter can decide fairly while
amounts stay confidential, and evidence can be encrypted so *only* the arbiter (and the submitting
party) can read it. So the safely-hideable set is large — invoice content, evidence content,
absolute amounts, and (with Arc's programmable privacy) identities and the payment graph. The
must-stay-public set is narrow — that an escrow exists and what state it's in (so the permissionless,
timer-based release/refund stays triggerable), the arbiter's authority, and the verifiability of
fees and rules. **Selective disclosure** therefore means a precise routing of facts: the
*counterparty* sees the invoice; the *arbiter* sees the evidence and rules in percentages; *anyone*
can see that a settlement is due and poke the state machine; *no one else* sees who, how much, or
what for. The protocol's job is to make each audience exact — never broader than the trust
requirement demands.

---

## 5. Roadmap Summary

| Feature | Who builds it | When | What it requires |
|---|---|---|---|
| Invoice content commitment (hash on-chain, JSON off-chain) | Tranche | **Shipped** | Already in the create-escrow private mode + invoice-card verify flow |
| Private mode default-on for invoices | Tranche | Pre-mainnet | Flip default; UX copy update |
| Encrypted invoice content (encrypt-to-recipient) | Tranche | Pre-mainnet | Pubkey registry + frontend ECIES/x25519; reuse existing `invoiceHash` commitment |
| Encrypted evidence, arbiter-only reveal | Tranche | Pre-mainnet | Arbiter pubkey in registry + frontend encryption; **no contract change** (uses existing `evidenceHash`/`uri`) |
| Private dispute `reason` (commit + encrypt) | Tranche | Pre-mainnet (contract touch if hashed on-chain) | Stop emitting sensitive prose, or change `reason` to a commitment |
| Confidential transfer amounts | Arc (Tranche integrates) | Arc privacy upgrade | Arc protocol change; relies on bps-denominated settlement; resolve confidential-vs-CCTP-burn composition |
| Stealth / one-time payout addresses | Tranche | Post-mainnet v2 | Key management + UX; partial relationship privacy without full Arc programmable privacy |
| Fully private escrow mode (hidden parties + private logic) | Tranche + Arc | Arc programmable privacy | Arc protocol change; preserve irreducible public minimum (escrow existence/state, arbiter authority, fee auditability) |
