/** Payment authority and limits stay in the person's existing wallet client. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
export async function payWithWallet(
  url,
  body,
  { client = process.env.HOMIE_PARTS_WALLET, pending, run = execute } = {},
) {
  if (!client) return null;
  if (!["link-cli", "purl", "tempo"].includes(client))
    return { data: { detail: "Choose link-cli, purl or tempo as the wallet; hosted Checkout is available." } };
  let args;
  if (client === "link-cli") {
    args = [
      "mpp",
      "pay",
      url,
      "-X",
      "POST",
      "-d",
      JSON.stringify(body),
      "--format",
      "json",
    ];
    if (pending?.id)
      args.push(
        "--spend-request-id",
        pending.id,
        "--approved-challenge",
        pending.challenge,
      );
    else
      args.push(
        "--amount",
        String(body.amount),
        "--context",
        `Purchase the digital resource ${body.resource} version ${body.version} from ${new URL(url).host} under the exact price and licence terms approved in this conversation. The selling studio delivers the files and signed purchase proof.`,
      );
  } else {
    const atomic = BigInt(body.amount) * 10000n;
    const purlLimit = process.env.PURL_MAX_AMOUNT;
    if (purlLimit && !/^\d+$/.test(purlLimit))
      return { data: { detail: "Invalid wallet maximum amount; use hosted Checkout or correct the wallet setting." } };
    const tempoLimit = process.env.TEMPO_MAX_SPEND;
    if (
      tempoLimit &&
      (!Number.isFinite(Number(tempoLimit)) || Number(tempoLimit) < 0)
    )
      return { data: { detail: "Invalid wallet maximum spend; use hosted Checkout or correct the wallet setting." } };
    // Use the wallet's native per-request ceiling in its documented units.
    const ceiling =
      client === "tempo"
        ? [
            "--max-spend",
            String(
              Math.min(
                body.amount / 100,
                tempoLimit ? Number(tempoLimit) : Infinity,
              ),
            ),
          ]
        : [
            "--max-amount",
            String(
              purlLimit && BigInt(purlLimit) < atomic
                ? BigInt(purlLimit)
                : atomic,
            ),
            "--network",
            "base,base-sepolia",
            "--output-format",
            "json",
          ];
    args = [
      ...(client === "tempo" ? ["request"] : []),
      ...ceiling,
      "-X",
      "POST",
      "--json",
      JSON.stringify(body),
      url,
    ];
  }
  let stdout;
  try { ({ stdout } = await run(client, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 60000,
  })); } catch (error) {
    if (error.code === 'ENOENT') return { data: { detail: `The ${client} wallet is not installed; use hosted Checkout.` } };
    // Wallets often return a structured refusal with a nonzero exit status.
    // A process timeout or broken output is ambiguous: never start a second payment.
    if (error.stdout?.trim()) stdout = error.stdout;
    else if (/declined|insufficient funds|spend limit|not authenticated|not logged in|unsupported (network|method)|user rejected|user denied/i.test(error.stderr ?? ''))
      return { data: { detail: String(error.stderr).trim(), paymentStatus: 'not_paid' } };
    else return { uncertain: true, data: { detail: 'The wallet stopped without a payment result. Retry this purchase to reconcile it; do not pay again.' } };
  }
  let result;
  try { result = JSON.parse(stdout); }
  catch { return { uncertain: true, data: { detail: 'The wallet returned an unreadable payment result. Retry this purchase to reconcile it; do not pay again.' } }; }
  if (result._next?.pay_argv) {
    const next = result._next.pay_argv.args;
    return {
      pending: {
        id: result.id,
        challenge: next[next.indexOf("--approved-challenge") + 1],
      },
      approval: result.approval_url,
    };
  }
  const value = result.body ?? result;
  return { data: typeof value === "string" ? JSON.parse(value) : value };
}
