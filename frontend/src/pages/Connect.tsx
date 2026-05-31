import type { WalletState } from "../hooks/useWallet";
import { CHAIN_ID } from "../config/contracts";

interface Props { wallet: WalletState; }

export function Connect({ wallet }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
      <h1 className="text-4xl font-bold text-white">Pokémon TCG</h1>
      <p className="text-gray-400 max-w-md">
        Open card packs, trade NFTs, and earn royalties — all on Ethereum Sepolia.
      </p>

      {!wallet.address ? (
        <button
          onClick={wallet.connect}
          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition"
        >
          Connect MetaMask
        </button>
      ) : !wallet.chainOk ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-yellow-400">⚠ Wrong network — please switch to Sepolia</p>
          <button
            onClick={wallet.switchToSepolia}
            className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl transition"
          >
            Switch to Sepolia (chainId {CHAIN_ID})
          </button>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl p-4 text-left w-80">
          <p className="text-green-400 text-sm font-medium">✓ Connected to Sepolia</p>
          <p className="text-gray-300 text-sm mt-1 font-mono break-all">{wallet.address}</p>
        </div>
      )}
    </div>
  );
}
