---
name: claim-checker
description: Check whether an Ethereum address has unclaimed ETH in abandoned exchange and game contracts, and get the exact transaction that releases it. Read-only by default; never signs. Use when a user asks "do I have money stuck in old contracts", "check this wallet for unclaimed balances", or before offering to claim on someone's behalf.
---

# Claim checker

Given an Ethereum address, read every pool in this list and report what is claimable, the exact calldata that releases it, and whether the claim is worth its gas.

**This skill never signs and never asks for a key.** It produces calldata. The owner sends it, or an agent sends it if the owner has explicitly handed over a signer.

## Pools covered

| Pool | Contract | Getter | Claim |
|---|---|---|---|
| EtherDelta V2 | `0x8d12A197cB00D4747a1fe03395095ce2A5CC6819` | `balanceOf(address,address)` `0xf7888aec` (token `0x0`) | `withdraw(uint256)` `0x2e1a7d4d` |
| ED-family A | `0x4d55f76ce2dbbae7b48661bef9bd144ce0c9091b` | `0xf7888aec` | `0x2e1a7d4d` |
| ED-family B | `0x4aea7cf559f67cedcad07e12ae6bc00f07e8cf65` | `0xf7888aec` | `0x2e1a7d4d` |
| EtherDelta V1b | `0x373c55c277b866a69dc047cad488154ab9759466` | `0xf7888aec` | `0x2e1a7d4d` |
| Token.Store | `0x1ce7ae555139c5ef5a57cc8d814a867ee6ee33d8` | `0xf7888aec` | `0x2e1a7d4d` |
| Old WETH (2016) | `0xecf8f87f810ecf450940c9f60066b4a7a501d6a7` | `balanceOf(address)` `0x70a08231` | `withdraw(uint256)` `0x2e1a7d4d` |
| IDEX v1 | `0x2a0c0DBEcC7E4D658f48E01e3fA353F44050c208` | `0xf7888aec` | `withdraw(address,uint256)` `0xf3fef3a3` |

## Run

```bash
node skill/check_claims.ts 0xYourAddress
node skill/check_claims.ts 0xYourAddress --json      # machine-readable
RPC_URL=https://your-node node skill/check_claims.ts 0x...
```

Output per pool: balance, claimable ETH, net after gas at the current base fee, calldata, gas estimate, and a verdict.

## Interpreting the result

- **`owner-only`** pools (all of the above except airdrops) pay `msg.sender`. Nobody can claim on someone else's behalf — not a relayer, not an incentive contract, not you. If the owner will not act and has not delegated a signer, the balance stays.
- **`third-party`** claims (merkle airdrops, bridge finalisations) can be submitted by anyone and pay the registered recipient. Those are the only ones an agent can usefully perform for a user who never acts.
- A claim worth less than its gas is a negative. Say so instead of encouraging the transaction.

## Safety rules for agents using this skill

1. Never ask for a seed phrase or private key in order to *read* balances.
2. Only sign if the owner explicitly authorised that specific transaction.
3. Show the calldata and the target contract before any signature.
4. A checker that asks you to connect a wallet, sign a message, or approve a token, just to display a balance, is a drainer. This one only makes `eth_call` reads.
