#!/usr/bin/env node
// Claim checker: read-only. Given an address, report claimable ETH across the abandoned pools
// covered by this skill, with the exact calldata that releases each claim.
// Never signs, never asks for a key, never sends a transaction.
import { argv, exit } from "node:process";

const RPC = process.env.RPC_URL || process.env.ALCHEMY_RPC || "https://eth-mainnet.public.blastapi.io";
const JSON_OUT = argv.includes("--json");
const addr = argv.slice(2).find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));

if (!addr) {
  console.error("usage: node skill/check_claims.ts 0xAddress [--json]");
  exit(2);
}

type Pool = { key: string; name: string; contract: string; getter: "bal2" | "bal1"; claim: "withdraw(uint256)" | "withdraw(address,uint256)"; gas: number };

const POOLS: Pool[] = [
  { key: "edv2", name: "EtherDelta V2", contract: "0x8d12A197cB00D4747a1fe03395095ce2A5CC6819", getter: "bal2", claim: "withdraw(uint256)", gas: 36493 },
  { key: "famA", name: "ED-family A", contract: "0x4d55f76ce2dbbae7b48661bef9bd144ce0c9091b", getter: "bal2", claim: "withdraw(uint256)", gas: 38726 },
  { key: "famB", name: "ED-family B", contract: "0x4aea7cf559f67cedcad07e12ae6bc00f07e8cf65", getter: "bal2", claim: "withdraw(uint256)", gas: 38726 },
  { key: "v1b", name: "EtherDelta V1b", contract: "0x373c55c277b866a69dc047cad488154ab9759466", getter: "bal2", claim: "withdraw(uint256)", gas: 38726 },
  { key: "tstore", name: "Token.Store", contract: "0x1ce7ae555139c5ef5a57cc8d814a867ee6ee33d8", getter: "bal2", claim: "withdraw(uint256)", gas: 38726 },
  { key: "weth", name: "Old WETH (2016)", contract: "0xecf8f87f810ecf450940c9f60066b4a7a501d6a7", getter: "bal1", claim: "withdraw(uint256)", gas: 38726 },
  { key: "idex", name: "IDEX v1", contract: "0x2a0c0DBEcC7E4D658f48E01e3fA353F44050c208", getter: "bal2", claim: "withdraw(address,uint256)", gas: 42077 },
];

const ZERO = "0".repeat(64);
const padAddr = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const word = (n: bigint) => n.toString(16).padStart(64, "0");

const rpc = async (method: string, params: unknown[]): Promise<any> => {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const t = await r.text();
      if (!t.trim()) { await new Promise((x) => setTimeout(x, 400)); continue; }
      const j = JSON.parse(t);
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch { await new Promise((x) => setTimeout(x, 400)); }
  }
  throw new Error("rpc unavailable");
};

const fmt = (wei: bigint) => (Number(wei) / 1e18).toFixed(6);

const latestBlock = await rpc("eth_getBlockByNumber", ["latest", false]) as any;
const baseFee = BigInt(latestBlock.baseFeePerGas);

const rows: any[] = [];
for (const p of POOLS) {
  const readData = p.getter === "bal2" ? "0xf7888aec" + ZERO + padAddr(addr) : "0x70a08231" + padAddr(addr);
  let wei = 0n;
  try {
    const res = await rpc("eth_call", [{ to: p.contract, data: readData }, "latest"]) as string;
    wei = res && res !== "0x" ? BigInt(res) : 0n;
  } catch { rows.push({ pool: p.name, contract: p.contract, error: "read failed" }); continue; }
  if (wei === 0n) continue;

  const claimData = p.claim === "withdraw(address,uint256)"
    ? "0xf3fef3a3" + ZERO + word(wei)
    : "0x2e1a7d4d" + word(wei);

  let gas: number | null = null;
  try {
    const est = await rpc("eth_estimateGas", [{ from: addr, to: p.contract, data: claimData }, "latest"]) as string;
    gas = parseInt(est, 16);
  } catch { gas = null; }

  const gasCost = BigInt(gas ?? p.gas) * baseFee;
  const net = wei - gasCost;
  rows.push({
    pool: p.name, contract: p.contract, executor: "owner-only",
    claimableEth: fmt(wei), netAfterGasEth: net > 0n ? fmt(net) : "0 (below gas)",
    worthIt: net > 0n, claim: p.claim, calldata: claimData, gas,
  });
}

if (JSON_OUT) {
  console.log(JSON.stringify({ address: addr, baseFeeGwei: Number(baseFee) / 1e9, pools: rows }, null, 1));
} else {
  if (!rows.length) { console.log(`${addr}: no claimable balance in any covered pool.`); exit(0); }
  console.log(`${addr}  (base fee ${(Number(baseFee) / 1e9).toFixed(4)} gwei)\n`);
  for (const r of rows) {
    if (r.error) { console.log(`${r.pool}: ${r.error}`); continue; }
    console.log(`${r.pool} — ${r.claimableEth} ETH`);
    console.log(`  claim : ${r.claim} on ${r.contract}`);
    console.log(`  gas   : ${r.gas ?? "unknown"} → net ${r.netAfterGasEth} ETH${r.worthIt ? "" : "  [claim costs more than it pays]"}`);
    console.log(`  data  : ${r.calldata}`);
    console.log(`  note  : owner-only — pays msg.sender; nobody else can claim this for you.\n`);
  }
}
