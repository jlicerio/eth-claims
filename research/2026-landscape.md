# What 2026's exploit data says to do next

Research note, 2026-10-27. Sources are public post-mortems and benchmarks; every number below is quoted, not estimated.

## The landscape changed shape

| Year to date | Value |
|---|---|
| Tracked DeFi losses, 2026 | **$2.369B across 312 incidents** (DefiLlama, 27 Oct 2026) |
| H1 2026 incidents | 207–224 depending on definition; $972M–$1.32B |
| Three incidents' share of H1 losses | **63.9%** (KelpDAO/LayerZero $292M, Drift $285M, Trezor Value Wallet) |

The concentration is the finding. Nine-figure losses come from **trust assumptions** — forged cross-chain messages, compromised admin keys, manipulated oracles — not from coding mistakes in a single function.

## Where reentrancy still lives

Reentrancy fell from the #1 high-severity class (2018–2020) to roughly **6–8% of high-severity findings** in 2026. But it did not disappear; it moved into a specific contract type: **one-time claim and airdrop contracts**.

- **Hemi Genesis Drop**, 7 Sep 2026 — `MerkleBox` claim contract. Locks were created before the claim accounting updated, so 63 recursive claims inside one flash-loan-funded transaction drained 124.5M unclaimed HEMI (~$255K realised). Immutable, so unpatchable.
- **FutureSwap**, 14 Jan 2026 — same class, ~$74K on Arbitrum.

Both were distribution contracts written for one event, deployed immutable, and left unmonitored once the claim window closed.

**That is precisely the contract type this project spends its time on.** Every address we verify is trying to withdraw from a one-shot distribution contract whose team moved on years ago.

## What the benchmark says an agent can actually do

OpenAI/Paradigm/OtterSec's **EVMbench** (2026) evaluates agents on detection, patching and exploitation over 120 vulnerabilities from 40 Code4rena repos:

- agents **detect up to 45.6%** of vulnerabilities;
- agents **exploit 72.2%** of a curated subset;
- with a mechanism hint, GPT-5.2 reaches **93.9% on patching and 73.8% on exploitation**.

Anthropic reported an agent finding a real exploit that a human attacker independently used four days later.

Two conclusions worth acting on: exploitation is easier for an agent than detection (a hint or a hypothesis converts to a working exploit most of the time), and no agent finds half of what is there. So the productive loop is **hypothesis-driven**: propose a specific mechanism, then test it — not "scan the world and hope".

## Our own data, checked against that

We ran two hypothesis-driven sweeps today over 158 ETH-denominated pools:

1. **Unguarded admin surface** — probed `setOwner`, `transferOwnership`, `kill`, `destroy`, `mint`, `setAdmin`, `setAccountMap`, `pause`, `adminWithdraw` from an EOA holding no role. **Zero unguarded across all 158.** Every admin selector reverted. The contracts are abandoned, not ownerless.
2. **Claim path simulation** — 37 pools where the getter is the payout and the withdrawal executes from a real holder; 58 callable but token-priced; 63 with no matching shape.

So the abandoned-pool set is not an exploit target. That is consistent with the market data: nobody has taken the money in seven years, and the reason is not lack of attention.

## The one hypothesis worth testing next

**Reentrancy through the claim path of live, bounty-scoped distribution contracts.** Not the abandoned pools — the *live* ones, where a program pays for the finding.

Test procedure, in the order that produces evidence rather than suspicion:

1. Take one live claim/airdrop contract with a public bounty scope.
2. Fork mainnet at its deployed block.
3. Deploy a recipient contract whose `receive`/`fallback` re-enters `claim()`.
4. Execute the claim through the malicious recipient inside one transaction. If state is not updated before the external call, the second entry sees a stale balance.
5. Measure the delta: how many claims were paid against one entitlement. A delta > 0 on the fork is a candidate finding; a delta of 0 is a clean negative and goes in the log either way.

The same harness applies to the read-only variant: call a `view` function (`balanceOf`, `getReserves`, `totalSupply`) from inside the recipient callback and compare it against its post-transaction value. Stale reads mid-callback are what break composable protocols that trust them.

## Why this is the right next step for this project

- It uses the method already built and repeatedly validated: selector provenance from runtime bytecode, per-address simulation, denomination checks.
- It targets the contract class our data is already organised around.
- It has a **buyer**: bounty programs pay for disclosure, which is the only revenue path in this project that has ever had one.
- And the failure mode is cheap and safe: an unsuccessful attempt on a fork costs nothing, and a successful one is reported to the program, never executed.
