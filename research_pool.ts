// Scheduled pool researcher.
// Takes the next unverified ETH-sourced pool, proves what is actually claimable with the
// contract's own math, simulates the claim from the largest holder, and appends a report.
// Never trusts the index number: the index is the lead, the contract is the truth.
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";

const RPC = process.env.ALCHEMY_RPC || "https://eth-mainnet.public.blastapi.io";
const DIR = "research";
mkdirSync(DIR, { recursive: true });

const QUEUE: { key: string; contract: string; getter: "bal2" | "bal1" | "curve"; claim: string; gas?: number }[] = [
  { key: "lastwinner", contract: "0xDd9fd6b6F8f7ea932997992bbE67EabB3e316f3C", getter: "bal2", claim: "0x3ccfd60b" },
  { key: "fomo3d_long", contract: "", getter: "bal2", claim: "0x3ccfd60b" },
  { key: "ethfinex", contract: "", getter: "bal2", claim: "0x3ccfd60b" },
  { key: "singularx", contract: "", getter: "bal2", claim: "0x3ccfd60b" },
];

const rpc = async (m: string, p: unknown[]): Promise<any> => {
  for (let k = 0; k < 5; k++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const t = await r.text();
      if (!t.trim()) { await new Promise((x) => setTimeout(x, 400)); continue; }
      return JSON.parse(t);
    } catch { await new Promise((x) => setTimeout(x, 400)); }
  }
  return { error: { message: "rpc" } };
};

const done = existsSync(`${DIR}/done.json`) ? JSON.parse(readFileSync(`${DIR}/done.json`, "utf8")) : [];
const task = QUEUE.find((q) => q.contract && !done.includes(q.key));
if (!task) { console.log("queue empty or all verified"); process.exit(0); }

const topOf = (key: string): { address: string; indexEth: number } | null => {
  try {
    const j = JSON.parse(readFileSync(`/mnt/storage/fgbal/${key}_eth_balances.json`, "utf8"));
    const k = Object.keys(j).find((x) => Array.isArray(j[x]));
    const rows = j[k].slice().sort((a: any, b: any) => Number(b.balance_eth) - Number(a.balance_eth));
    return rows[0] ? { address: rows[0].address, indexEth: Number(rows[0].balance_eth) } : null;
  } catch { return null; }
};

const top = topOf(task.key);
const bal = await rpc("eth_getBalance", [task.contract, "latest"]);
const contractEth = bal.result ? Number(BigInt(bal.result)) / 1e18 : 0;

const out: any = { key: task.key, contract: task.contract, contractEth: +contractEth.toFixed(2), top };

if (top) {
  const pad = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
  const read = await rpc("eth_call", [{ to: task.contract, data: "0xf7888aec" + "0".repeat(64) + pad(top.address) }, "latest"]);
  const wei = read.result && read.result !== "0x" ? BigInt(read.result) : 0n;
  out.contractBalanceOfTop = +(Number(wei) / 1e18).toFixed(6);
  const data = task.claim + wei.toString(16).padStart(64, "0");
  const sim = await rpc("eth_call", [{ from: top.address, to: task.contract, data }, "latest"]);
  out.claimSimulated = !sim.error;
  out.claimRevert = sim.error ? String(sim.error.message).slice(0, 80) : null;
  const est = await rpc("eth_estimateGas", [{ from: top.address, to: task.contract, data }, "latest"]);
  out.gas = est.result ? parseInt(est.result, 16) : null;
  out.indexVsContract = top.indexEth ? +(out.contractBalanceOfTop / top.indexEth).toFixed(3) : null;
}

const line = `## ${task.key} — ${new Date().toISOString()}\n\n` +
  "```json\n" + JSON.stringify(out, null, 2) + "\n```\n\n" +
  (out.claimSimulated
    ? `Claim path proven: ${task.claim} simulates from the largest holder at ${out.gas} gas.\n\n`
    : `NOT PROVEN. The claim call reverted or the getter does not answer; do not quote this pool.\n\n`);
appendFileSync(`${DIR}/log.md`, line);
writeFileSync(`${DIR}/${task.key}.json`, JSON.stringify(out, null, 1));
writeFileSync(`${DIR}/done.json`, JSON.stringify([...done, task.key], null, 1));
console.log(line);
