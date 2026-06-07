// Admin — add a new card template to the on-chain pool. Gated to the wallet that
// holds POOL_MANAGER_ROLE on the NFT (the deployer). The write goes straight to
// the chain (addCardToPool); the indexer picks up CardAddedToPool and upserts the
// card into the backend DB, so it appears on the Collection page within a poll.

import { useCallback, useEffect, useState } from "react";
import { Contract, parseEther, isAddress } from "ethers";
import toast from "react-hot-toast";
import type { WalletState } from "../hooks/useWallet";
import type { Rarity } from "../lib/types";
import { ADDRESSES, NFT_ABI } from "../config/contracts";
import { RARITY, RARITY_ORDER, RARITY_BY_INDEX } from "../lib/tokens";
import { assertChain } from "../lib/assertChain";
import { PageHead } from "../components/PageHead";
import { NotConnected } from "../components/NotConnected";
import { Btn } from "../components/ui/Btn";
import { Icon } from "../components/ui/Icon";
import { txPending, txSuccess, txError } from "../components/TxToast";

const MAX_ROYALTY_BPS = 1000; // mirrors PokemonCardNFT.MAX_ROYALTY_BPS (10%)
const U16_MAX = 65535;

interface Props { wallet: WalletState; }
interface RoyaltyRow { receiver: string; bps: string; }

export function AdminAddCard({ wallet }: Props) {
  const connected = !!wallet.address && wallet.chainOk;

  // Authorization — does the connected wallet hold POOL_MANAGER_ROLE?
  const [authz, setAuthz] = useState<"checking" | "yes" | "no">("checking");

  useEffect(() => {
    if (!wallet.provider || !wallet.address || !wallet.chainOk) { setAuthz("checking"); return; }
    let alive = true;
    (async () => {
      try {
        const nft  = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.provider!);
        const role = await nft.POOL_MANAGER_ROLE();
        const ok   = await nft.hasRole(role, wallet.address!);
        if (alive) setAuthz(ok ? "yes" : "no");
      } catch { if (alive) setAuthz("no"); }
    })();
    return () => { alive = false; };
  }, [wallet.provider, wallet.address, wallet.chainOk]);

  // Form fields
  const [cardId, setCardId]   = useState("");
  const [name, setName]       = useState("");
  const [rarity, setRarity]   = useState<Rarity>("Common");
  const [pType, setPType]     = useState("");
  const [hp, setHp]           = useState("");
  const [attack, setAttack]   = useState("");
  const [maxSupply, setMax]   = useState("");
  const [floor, setFloor]     = useState("");
  const [imageURI, setImage]  = useState("");
  const [royalties, setRoyalties] = useState<RoyaltyRow[]>([{ receiver: "", bps: "300" }, { receiver: "", bps: "200" }]);
  const [busy, setBusy] = useState(false);

  // Default royalty receivers to the connected wallet once known.
  useEffect(() => {
    if (!wallet.address) return;
    setRoyalties(rs => rs.map(r => (r.receiver ? r : { ...r, receiver: wallet.address! })));
  }, [wallet.address]);

  const setRoyalty = (i: number, patch: Partial<RoyaltyRow>) =>
    setRoyalties(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRoyalty = () => setRoyalties(rs => [...rs, { receiver: wallet.address ?? "", bps: "0" }]);
  const removeRoyalty = (i: number) => setRoyalties(rs => rs.filter((_, idx) => idx !== i));

  const validate = useCallback((): string | null => {
    const id = Number(cardId);
    if (!Number.isInteger(id) || id <= 0 || id > U16_MAX) return "Card ID must be a whole number between 1 and 65535";
    if (!name.trim()) return "Enter a name";
    if (!pType.trim()) return "Enter a type";
    const hpN = Number(hp);
    if (!Number.isInteger(hpN) || hpN < 1 || hpN > U16_MAX) return "HP must be a whole number between 1 and 65535";
    if (!attack.trim()) return "Enter an attack (e.g. \"Fire Blast - 120\")";
    const maxN = Number(maxSupply);
    if (!Number.isInteger(maxN) || maxN < 1 || maxN > U16_MAX) return "Max supply must be a whole number between 1 and 65535";
    if (!/^\d*\.?\d+$/.test(floor.trim())) return "Floor price must be a plain decimal in ETH";
    if (Number(floor) <= 0) return "Floor price must be greater than 0";
    if (!/^https?:\/\/.+/i.test(imageURI.trim())) return "Image URL must start with http(s)://";
    if (royalties.length === 0) return "Add at least one royalty receiver";
    let total = 0;
    for (const r of royalties) {
      if (!isAddress(r.receiver)) return `Royalty receiver "${r.receiver || "(empty)"}" is not a valid address`;
      const b = Number(r.bps);
      if (!Number.isInteger(b) || b < 0 || b > U16_MAX) return "Royalty bps must be whole numbers";
      total += b;
    }
    if (total > MAX_ROYALTY_BPS) return `Total royalty ${total} bps exceeds the ${MAX_ROYALTY_BPS} bps (10%) cap`;
    return null;
  }, [cardId, name, pType, hp, attack, maxSupply, floor, imageURI, royalties]);

  async function submit() {
    if (!wallet.signer) return;
    const err = validate();
    if (err) { toast.error(err); return; }

    const nft = new Contract(ADDRESSES.PokemonCardNFT, NFT_ABI, wallet.signer);
    const id  = Number(cardId);
    const toastId = txPending("Adding card…");
    setBusy(true);
    try {
      await assertChain(wallet.provider);

      // Templates are write-once — bail early with a clear message if the id is taken.
      const existing = await nft.getCardTemplate(id);
      if (Number(existing.maxSupply) !== 0) throw new Error(`Card ID ${id} already exists on-chain — pick a different ID.`);

      const template = {
        cardId:        id,
        name:          name.trim(),
        rarity:        RARITY_BY_INDEX.indexOf(rarity), // 0..4
        pokemonType:   pType.trim(),
        hp:            Number(hp),
        attack:        attack.trim(),
        maxSupply:     Number(maxSupply),
        currentSupply: 0,
        floorPrice:    parseEther(floor.trim()),
        imageURI:      imageURI.trim(),
      };
      const receivers = royalties.map(r => ({ receiver: r.receiver, feeBps: Number(r.bps) }));

      const tx = await nft.addCardToPool(template, receivers);
      await tx.wait();
      txSuccess(toastId, `Added ${name.trim()}!`);

      // Reset for the next card.
      setCardId(""); setName(""); setPType(""); setHp(""); setAttack(""); setMax(""); setFloor(""); setImage("");
      setRoyalties([{ receiver: wallet.address ?? "", bps: "300" }, { receiver: wallet.address ?? "", bps: "200" }]);
    } catch (e) {
      txError(toastId, e);
    } finally {
      setBusy(false);
    }
  }

  if (!connected) {
    return (
      <div className="screen">
        <PageHead title="Add a Card" sub="Pool administration — deployer only." />
        <NotConnected onConnect={wallet.connect} note="Connect the deployer wallet to manage the card pool." />
      </div>
    );
  }
  if (authz === "checking") {
    return (
      <div className="screen">
        <PageHead title="Add a Card" sub="Checking permissions…" />
        <div className="panel" style={{ height: 200, opacity: 0.5 }} />
      </div>
    );
  }
  if (authz === "no") {
    return (
      <div className="screen">
        <PageHead title="Add a Card" sub="Pool administration — deployer only." />
        <div className="empty panel">
          <Icon name="lock" size={26} />
          <p>This wallet isn’t a pool manager. Connect the deployer wallet to add cards.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHead title="Add a Card" sub="Adds a new template to the on-chain pool. It joins its rarity tier in the gacha draw, and shows in Collection once the indexer catches up." />

      <div className="panel admin-form">
        <div className="admin-grid">
          <Field label="Card ID" hint="Unique, whole number (write-once on-chain)">
            <input className="adm-in mono" type="number" min="1" value={cardId} onChange={e => setCardId(e.target.value)} placeholder="41" />
          </Field>
          <Field label="Name">
            <input className="adm-in" value={name} onChange={e => setName(e.target.value)} placeholder="Charizard" />
          </Field>
          <Field label="Rarity">
            <select className="adm-in" value={rarity} onChange={e => setRarity(e.target.value as Rarity)}>
              {RARITY_ORDER.map(rk => <option key={rk} value={rk}>{RARITY[rk].label}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <input className="adm-in" value={pType} onChange={e => setPType(e.target.value)} placeholder="Fire" />
          </Field>
          <Field label="HP">
            <input className="adm-in mono" type="number" min="1" value={hp} onChange={e => setHp(e.target.value)} placeholder="120" />
          </Field>
          <Field label="Max supply">
            <input className="adm-in mono" type="number" min="1" value={maxSupply} onChange={e => setMax(e.target.value)} placeholder="25" />
          </Field>
          <Field label="Attack" hint='Free text, e.g. "Fire Blast - 120"'>
            <input className="adm-in" value={attack} onChange={e => setAttack(e.target.value)} placeholder="Fire Blast - 120" />
          </Field>
          <Field label="Floor price (ETH)">
            <input className="adm-in mono" value={floor} onChange={e => setFloor(e.target.value)} placeholder="0.05" />
          </Field>
          <Field label="Image URL" full>
            <input className="adm-in" value={imageURI} onChange={e => setImage(e.target.value)}
              placeholder="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png" />
          </Field>
        </div>

        <div className="admin-roy">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ fontSize: 14 }}>Royalty receivers <span className="faint">(total ≤ {MAX_ROYALTY_BPS} bps · 10%)</span></h3>
            <Btn kind="ghost" size="sm" icon="plus" onClick={addRoyalty}>Add receiver</Btn>
          </div>
          {royalties.map((r, i) => (
            <div key={i} className="row gap-8" style={{ marginBottom: 8 }}>
              <input className="adm-in mono" style={{ flex: 1 }} value={r.receiver}
                onChange={e => setRoyalty(i, { receiver: e.target.value })} placeholder="0x… receiver" />
              <input className="adm-in mono" style={{ width: 110 }} type="number" min="0" value={r.bps}
                onChange={e => setRoyalty(i, { bps: e.target.value })} placeholder="bps" />
              <span className="faint mono" style={{ width: 52, fontSize: 12 }}>
                {(Number(r.bps) / 100 || 0).toFixed(2)}%
              </span>
              {royalties.length > 1 && <Btn kind="ghost" size="sm" onClick={() => removeRoyalty(i)}>✕</Btn>}
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <Btn kind="primary" icon="check" disabled={busy} onClick={submit}>{busy ? "Adding…" : "Add card to pool"}</Btn>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`adm-field${full ? " adm-field-full" : ""}`}>
      <span className="adm-label">{label}{hint && <span className="adm-hint faint"> · {hint}</span>}</span>
      {children}
    </label>
  );
}
