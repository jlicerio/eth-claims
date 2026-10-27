# eth-claims

Verified claim research on abandoned smart contracts: which pools still hold user funds, which claim paths actually execute, and how to tell the difference between an index number and a collectable balance.

**The method is chain-agnostic and protocol-agnostic.** Ethereum mainnet is simply the first dataset. Nothing in the pipeline assumes a particular chain, token standard, or contract family: it assumes only that a contract exposes a way to read what it owes an address, and a way for that address to take it.

Companion tool: **https://jlicerio.github.io/etherdelta-claims/** — read-only checker, one `eth_call`, no wallet connection, shows net after gas.

## Scope

Any EVM chain, any contract family. The same five steps apply to an L2 bridge's stranded deposits, a BSC game contract, a Polygon vault, or a 2016 mainnet exchange. What changes per chain is the RPC endpoint and the native unit; what stays constant is that a simulated claim from the holder's own address is the only proof that matters.

## Why this exists

There are public indexes mapping tens of thousands of addresses to "claimable" balances in dead protocols. Most of those numbers are never checked against the contract that would pay them. Three failure modes show up repeatedly:

1. **Token counts labelled as ETH.** `thedao_eth` lists 81,295 "ETH" for 4,836 addresses. The wrapper does hold 81,287 ETH, but the listed top holder has 10,200 DAO tokens, not 10,200 ETH, and `withdraw()` reverts for it. The file's own header says `balance_source: "token"`.
2. **A getter that does not answer.** `lastwinner` indexes 163.42 ETH for its top holder; `balanceOf(0x0, holder)` returns zero. The pool holds 2,424 ETH, so the money is real and the address mapping is wrong.
3. **A payout that is not the getter.** `powh3d` indexes 141.97 ETH for its top holder; the contract's own `calculateEthereumReceived` returns 87.83 ETH. A token count was priced as if 1:1.

## Method

For every pool, in this order:

1. **Denomination.** Only `balance_source == "eth"` counts as an ETH claim. `token`, `weth` and `vault` sources need a per-pool rate and must never be summed into an ETH total.
2. **Selector provenance.** Extract `PUSH4` constants from the deployed runtime bytecode and match them against signatures. Never trust an ABI or an index's claim path.
3. **Getter read.** Call the contract's own balance function for a specific holder.
4. **Claim simulation.** `eth_call` the actual withdrawal from the holder's address. A revert means there is nothing collectable at that address, whatever the index says.
5. **Executor.** Who can trigger the claim:
   - `owner-only` — the contract pays `msg.sender` and only the holder can collect (EtherDelta, IDEX). No relayer, no public-good claimer, no incentive contract can help.
   - `third-party` — anyone can trigger the payout to the registered recipient: merkle airdrops (anyone may submit the proof for a recipient), L2 bridge finalisations, and contract-held balances where a caller can poke the contract on its own behalf.
   
   This axis decides whether a public-good claimer is even possible for a pool, and it is the single most consequential distinction when comparing pools across chains.
6. **Payout proof tier.** Record how the payout was established:
   - `getter` — the claim pays `balances[msg.sender]` and the getter is that same mapping (EtherDelta, IDEX).
   - `price_function` — the contract's own curve math prices the position (`calculateEthereumReceived`).
   - `trace` — a `debug_traceCall` state diff shows value reaching the holder. Often unavailable on free RPC tiers; say so rather than implying it.

## Verified so far

| Pool | Contract | Contract ETH | Claim | Gas | Verdict |
|---|---|---|---|---|---|
| EtherDelta V2 | `0x8d12A197cB00D4747a1fe03395095ce2A5CC6819` | ~14.9k | `withdraw(uint256)` `0x2e1a7d4d` | ~36.5k | callable, getter-backed |
| IDEX v1 | `0x2a0c0DBEcC7E4D658f48E01e3fA353F44050c208` | **15,673** | `withdraw(address,uint256)` `0xf3fef3a3` | 42,077 | callable, getter-backed |
| PoWH3D | `0xB3775fB83F7D12A36E0475aBdD1FCA35c091efBe` | 2,026 | `exit()` `0xe9fad8ee` | 59,802 | callable, price-function |
| LastWinner | `0xDd9fd6b6F8f7ea932997992bbE67EabB3e316f3C` | 2,424 | — | — | **getter mismatch, not quotable** |

IDEX v1 is the largest verified pool — larger than the entire EtherDelta family. Both its selectors were confirmed in the deployed dispatcher.

## What is not counted

- **112,543 "ETH"** across token-denominated files.
- **2,225 WETH** and **265 vault** positions, which need their own rates.
- Any pool whose claim call has not been simulated from a holder address.

The honest ETH-denominated total across the index is **49,914 ETH across 182 pools**, not the 164,947 a naive sum produces.

## The constraint nobody can engineer around

For `owner-only` pools — the EtherDelta family, IDEX — `withdraw()` pays `msg.sender`, so there is no relayer, no batching and no incentive contract that can collect on someone else's behalf. Only 4 claimant addresses are contracts (115 ETH); for the rest, the key is decisive.

That is a property of those contracts, not of claims in general. Merkle airdrops are `third-party` (anyone can submit a proof for the recipient; the recipient never has to act), L2 bridge finalisations are permissionless, and a contract holding a balance can often be triggered by a caller. Reporting "unclaimable" without naming the executor is how a research repo ends up wrong about things that are routine elsewhere.

Of the 400 largest holders, 97% signed at least one transaction historically but only 4.5% have signed one in the last twelve months. Chain state cannot distinguish "lost the key" from "doesn't care". Where a key is genuinely lost, the balance is unrecoverable — and no tool, fee or contract changes that.

At 27,745 gas and 0.045 gwei, a claim notice costs about 0.0000013 ETH, so the tail of tiny balances is not negative-EV for its owner — it is negative-EV for anyone trying to reach them. That is why the checker shows **net after gas** and is willing to tell someone their claim is worth less than the transaction.

## Extending to another chain

1. Point `ALCHEMY_RPC` (or any JSON-RPC URL) at the target chain. Nothing else in the verifier is mainnet-specific.
2. Extract `PUSH4` selectors from the target contract's runtime code; match them against signatures. Forked contracts reuse selectors, so an EtherDelta-style `withdraw(uint256)` on a BSC clone verifies the same way.
3. Read the contract's own balance getter for a holder, then `eth_call` the claim from that holder.
4. Convert wei to the chain's native unit. Never sum across chains into a single headline number; report per chain.
5. Record the payout-proof tier. On chains without a free trace API, `getter` or `price_function` is the honest ceiling.

L2s need one extra check: a claim contract may have a withdrawal delay or a sequencer-side queue, so a successful `eth_call` proves the call is accepted, not that funds arrive immediately.

## Reproducing

```bash
export ALCHEMY_RPC=https://eth-mainnet.g.alchemy.com/v2/<key>
node research_pool.ts        # verify the next queued pool, append to research/log.md
```

Each run writes `research/<pool>.json` with the contract balance, the holder's getter value, whether the claim simulated, the gas estimate and the payout-proof tier.

## Licence

MIT. Numbers are chain-derived; re-verify before relying on them.
