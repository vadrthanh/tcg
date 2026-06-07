/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_POKEMON_CARD_NFT_ADDRESS: string;
  readonly VITE_PAYMENT_SPLITTER_ADDRESS: string;
  readonly VITE_GACHA_PACK_ADDRESS: string;
  readonly VITE_MARKETPLACE_ADDRESS: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    request: (args: { method: string; params?: any[] }) => Promise<any>;
    on: (event: string, handler: (...args: any[]) => void) => void;
    removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  };
}
