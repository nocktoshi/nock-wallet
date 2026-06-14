/**
 * Local Nockchain wallet — signs HTLC txs with the Nock Wallet passkey vault
 * (PrivateKey) instead of the Rose browser extension.
 */
import {
  PrivateKey,
  TxBuilder,
  txEngineSettingsV1BythosDefault,
  type Digest,
  type NockchainTx,
  type Note,
} from "@nockchain/rose-ts";
import type { RpcClient } from "@nockchain/rose-ts";
import { makeRpcClient } from "../../rpc/client.js";
import { prepareBuiltTx, finalizeAndBroadcast } from "./broadcast.js";

export type RoseSignTxParams = {
  tx: NockchainTx;
  notes?: Note[];
};

export type RawSignMessageResponse = {
  signature: unknown;
  publicKey: unknown;
};

export type NockWalletProvider = {
  signTx(params: RoseSignTxParams): Promise<NockchainTx>;
  signMessage(message: string): Promise<RawSignMessageResponse>;
};

export type NockWalletSession = {
  pkh: Digest;
  address?: string;
  provider: NockWalletProvider;
  grpc: RpcClient;
};

export function createLocalNockWallet(
  pkh: Digest,
  privateKey: Uint8Array
): NockWalletSession {
  const provider: NockWalletProvider = {
    async signTx({ tx }) {
      const builder = TxBuilder.fromNockchainTx(tx, txEngineSettingsV1BythosDefault());
      await builder.sign(PrivateKey.fromBytes(privateKey));
      return builder.build();
    },
    signMessage() {
      throw new Error("signMessage is handled by swap/nock/sign.ts");
    },
  };
  return {
    pkh,
    address: pkh,
    provider,
    grpc: makeRpcClient(),
  };
}

export async function signAndSendRoseTx(
  wallet: NockWalletSession,
  builder: TxBuilder,
  inputNotes: Note[] = []
): Promise<string> {
  const nockTx = prepareBuiltTx(builder, inputNotes);
  let signedNockTx: NockchainTx;
  try {
    signedNockTx = await wallet.provider.signTx({ tx: nockTx, notes: inputNotes });
  } catch (err) {
    throw new Error(
      `Signing failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  return finalizeAndBroadcast(wallet.grpc, signedNockTx);
}