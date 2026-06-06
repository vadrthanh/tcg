# Deploying the backend + frontend on GCP

How the read-replica backend (indexer + API) and the static frontend are deployed
on a single Google Compute Engine VM. The contracts are already on Sepolia — nothing
in this guide touches the chain.

> **Secrets/PII:** every value below is a placeholder (`<...>`). Real contract
> addresses live in `contracts/deploy/addresses.json` (gitignored) or in
> `backend/.env`; the deployer EOA, project IDs, billing/org IDs, account emails,
> and any keyed RPC URL must **never** be committed. The `.env` files stay on the
> VM only.

---

## Why one VM (not Cloud Run / serverless)

The backend is **stateful and single-node by design**:

- the indexer and the API share **one SQLite file**,
- the indexer holds an OS **file lock** (`.indexer.lock`) and only one instance may run,
- the indexer is a **long-running poller**, not a request/response handler.

That maps badly onto Cloud Run (ephemeral filesystem, autoscaling to N instances,
scale-to-zero would kill the poll loop and break the lock). So:

- **Backend → one Compute Engine VM** (indexer + API as systemd services, SQLite on
  the persistent boot disk, nginx in front).
- **Frontend → static bundle** served by the same nginx (or any static host).

If you ever outgrow SQLite, the Prisma schema is already Postgres-compatible
(`Transaction.tokenIds` is a JSON string for exactly this reason) — migrate to
Cloud SQL and Cloud Run becomes viable. Not needed for a single-node deployment.

---

## Prerequisites

- `gcloud` CLI authenticated (`gcloud auth login`) with rights to create a project
  (or use an existing general-purpose one — **not** a hardened/locked-down project).
- A billing account ID.
- A Sepolia RPC endpoint. A public no-key endpoint
  (`https://ethereum-sepolia-rpc.publicnode.com`) works for a low-volume deployment;
  swap in a keyed Alchemy/Infura URL for reliability.
- A **domain** you control (for TLS). HTTPS is **required** if the dApp connects a
  wallet — see [step 9](#9-https-required-for-wallet-connect).

Placeholders used below: `<PROJECT_ID>`, `<BILLING_ACCOUNT_ID>`, `<ORG_ID>`,
`<ZONE>` (e.g. `asia-southeast1-a`), `<VM_EXTERNAL_IP>`, `<SSH_USER>`, `<DOMAIN>`
(the punycode A-label form for an internationalized name — see step 9).

---

## 1. Project, billing, Compute API

```bash
gcloud projects create <PROJECT_ID> --name="TCG" --organization=<ORG_ID>
gcloud config set project <PROJECT_ID>
gcloud billing projects link <PROJECT_ID> --billing-account=<BILLING_ACCOUNT_ID>
gcloud services enable compute.googleapis.com    # also auto-creates the `default` network
```

Enabling Compute creates a `default` auto-mode VPC with the standard firewall rules
(`default-allow-ssh` from `0.0.0.0/0`, internal, icmp). Confirm it exists:

```bash
gcloud compute networks list
gcloud compute firewall-rules list
```

## 2. Firewall + VM

```bash
# allow public web traffic to instances tagged tcg-web
gcloud compute firewall-rules create tcg-allow-web \
  --network=default --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=tcg-web

gcloud compute instances create tcg-backend \
  --zone=<ZONE> --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=20GB --tags=tcg-web
```

e2-small (2 vCPU / 2 GB) is enough. Note the external IP from the create output as
`<VM_EXTERNAL_IP>`. It is **ephemeral** — see [Hardening](#hardening--follow-ups).

## 3. Find the indexer start block (`DEPLOY_BLOCK`)

The indexer must start at the contracts' deployment block; otherwise it begins at
the chain tip and silently misses all history. `eth_getCode` at a historical block
needs an **archive** node, but block *headers* are always available on full nodes —
so binary-search by **timestamp** against `deployedAt` from `addresses.json`:

```python
import json, urllib.request, datetime
RPC="https://ethereum-sepolia-rpc.publicnode.com"
UA="Mozilla/5.0"          # publicnode rejects the default urllib user-agent
def call(m, p):
    req=urllib.request.Request(RPC, data=json.dumps(
        {"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),
        headers={"Content-Type":"application/json","User-Agent":UA})
    return json.load(urllib.request.urlopen(req, timeout=20))["result"]
target=datetime.datetime.fromisoformat("<DEPLOYED_AT_ISO>").timestamp()
ts=lambda b: int(call("eth_getBlockByNumber",[hex(b),False])["timestamp"],16)
lo,hi=0,int(call("eth_blockNumber",[]),16)
while lo<hi:                       # largest block with ts <= target
    mid=(lo+hi+1)//2
    lo,hi=(mid,hi) if ts(mid)<=target else (lo,mid-1)
print("DEPLOY_BLOCK =", max(0, lo-100))   # 100-block safety margin
```

## 4. Install runtime on the VM

```bash
gcloud compute ssh tcg-backend --zone=<ZONE>
# on the VM:
sudo apt-get update
sudo apt-get install -y nginx git ca-certificates curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs        # Node 20.x
```

## 5. Backend: clone, configure, migrate, seed

```bash
sudo mkdir -p /opt/tcg && sudo chown -R <SSH_USER>:<SSH_USER> /opt/tcg
git clone https://github.com/<owner>/tcg.git /opt/tcg/app
cd /opt/tcg/app/backend
npm ci
```

> The compiled ABIs are committed under `backend/abi/`, so the VM does **not** need
> to build the contracts. (`copy-abi` is only needed if those are regenerated.)

Create `/opt/tcg/app/backend/.env` (both processes self-load it via `dotenv`):

```bash
DATABASE_URL="file:/opt/tcg/app/backend/prod.db"
SEPOLIA_RPC_URL="https://ethereum-sepolia-rpc.publicnode.com"
NODE_ENV=production
PORT=4000

CHAIN_ID=11155111
CONTRACT_NETWORK=sepolia
DEPLOYER_ADDRESS=0x...
POKEMON_CARD_NFT_ADDRESS=0x...
PAYMENT_SPLITTER_ADDRESS=0x...
GACHA_PACK_ADDRESS=0x...
MARKETPLACE_ADDRESS=0x...
DEPLOY_BLOCK=<from step 3>

API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=5000        # see trust-proxy note in Hardening
INDEXER_POLL_INTERVAL_MS=15000
INDEXER_BATCH_BLOCKS=2000
```

Initialize the database with the **production-safe** migrate command (the `setup`
script uses `prisma migrate dev`, which is interactive/dev-only):

```bash
npx prisma generate
npx prisma migrate deploy
npm run seed                  # seeds the 40 card templates into SQLite
```

`NODE_ENV=production` matters: it makes the API error handler return a generic
`"Internal server error"` instead of leaking internal details.

## 6. Run as systemd services

Two units, both `Restart=always` and enabled on boot. They invoke `tsx` directly
by absolute path (avoids npm wrapper + a deprecated Node flag in the `start` script):

`/etc/systemd/system/tcg-indexer.service`
```ini
[Unit]
Description=TCG Sepolia event indexer
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=<SSH_USER>
WorkingDirectory=/opt/tcg/app/backend
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/tcg/app/backend/node_modules/.bin/tsx src/indexer.ts
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/tcg-api.service` — identical, except:
`Description=TCG read-replica API`, add `tcg-indexer.service` to `After=`, and
`ExecStart=.../tsx src/index.ts`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tcg-indexer tcg-api
systemctl is-active tcg-indexer tcg-api
curl -s http://127.0.0.1:4000/api/health      # ok=true once the indexer starts
```

Run **exactly one** indexer instance — the file lock enforces it; don't enable the
unit on a second host.

## 7. Frontend: build the static bundle

Vite reads `VITE_*` at **build time**, so the API URL is baked into the bundle.
Create `/opt/tcg/app/frontend/.env`:

```bash
VITE_CHAIN_ID=11155111
VITE_POKEMON_CARD_NFT_ADDRESS=0x...
VITE_PAYMENT_SPLITTER_ADDRESS=0x...
VITE_GACHA_PACK_ADDRESS=0x...
VITE_MARKETPLACE_ADDRESS=0x...
VITE_API_BASE_URL=https://<DOMAIN>            # origin only; client appends /api/...
```

> `VITE_API_BASE_URL` must be a non-empty absolute origin — an empty value makes the
> frontend treat the API as unconfigured and fall back to direct on-chain reads.

> Set this to the **final public origin**. If you're enabling TLS (step 9), use
> `https://<DOMAIN>` and build *after* the cert is issued. A bare `http://<VM_EXTERNAL_IP>`
> is fine only for a static-content smoke test — MetaMask won't connect on a
> non-HTTPS origin (step 9).

```bash
cd /opt/tcg/app/frontend
# e2-small has 2 GB RAM; add swap as insurance against an OOM during the build:
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile \
  && sudo mkswap /swapfile && sudo swapon /swapfile
npm ci
npm run build                 # → dist/
```

## 8. nginx: serve SPA + proxy the API

`/etc/nginx/sites-available/tcg`
```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /opt/tcg/app/frontend/dist;
    index index.html;

    location /api/ {                      # full /api/... URI is preserved
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / { try_files $uri $uri/ /index.html; }   # SPA fallback
}
```

```bash
sudo ln -sf /etc/nginx/sites-available/tcg /etc/nginx/sites-enabled/tcg
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx && sudo systemctl enable nginx
```

## 9. HTTPS (required for wallet connect)

> **MetaMask only injects `window.ethereum` in a secure context** — HTTPS, or
> `localhost` during dev. On a plain-HTTP origin (including a raw `http://<IP>`) the
> provider is absent, so "Connect MetaMask" silently fails. If the dApp connects a
> wallet, TLS is **mandatory**, not a hardening nicety.

Point a DNS `A` record for your hostname at `<VM_EXTERNAL_IP>` and let it propagate.
If the zone is behind Cloudflare, keep the record **DNS-only (grey-cloud)** so Let's
Encrypt's HTTP-01 challenge reaches the VM directly — a proxied (orange-cloud) record
terminates TLS at Cloudflare, and `dig +short A <host>` would return Cloudflare IPs
instead of `<VM_EXTERNAL_IP>`.

**Internationalized domains (IDN):** DNS, nginx, certbot, and the frontend env all
need the **punycode (A-label)** form, not the Unicode name:

```bash
python3 -c "print('<DOMAIN_UNICODE>'.encode('idna').decode())"   # Unicode host → its xn-- A-label
```

Issue the certificate — certbot rewrites the nginx vhost to add the 443 server and an
HTTP→HTTPS redirect, and installs an auto-renew timer:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo sed -i 's/server_name _;/server_name <DOMAIN>;/' /etc/nginx/sites-available/tcg
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <DOMAIN> --agree-tos --redirect \
  --register-unsafely-without-email      # omit email to avoid storing PII
```

Then rebuild the frontend so the bundle calls the API over TLS (an HTTPS page calling
an `http://` API is blocked as mixed content):

```bash
sed -i "s|VITE_API_BASE_URL=.*|VITE_API_BASE_URL=https://<DOMAIN>|" /opt/tcg/app/frontend/.env
cd /opt/tcg/app/frontend && npm run build
```

Using `<DOMAIN>` (not the IP) here also decouples the bundle from the VM's IP: if the
ephemeral IP changes, update the DNS `A` record only — no rebuild.

## Verify (from anywhere)

```bash
curl -s -o /dev/null -w "HTTP %{http_code} ssl_verify=%{ssl_verify_result}\n" https://<DOMAIN>/   # 200, ssl_verify=0
curl -s https://<DOMAIN>/api/health                                  # ok=true, lastBlock near tip
curl -s https://<DOMAIN>/api/stats                                   # template/NFT/listing counts
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/marketplace            # 200 (try_files)
curl -s -o /dev/null -w "redirect %{http_code} -> %{redirect_url}\n" http://<DOMAIN>/   # 301 -> https
```

`ssl_verify=0` means the chain validated. `lastBlock` climbs during catch-up, then
tracks the chain tip on the live poll.

---

## Operations

```bash
sudo journalctl -u tcg-indexer -f          # follow indexer logs
sudo journalctl -u tcg-api -f
sudo systemctl restart tcg-api             # e.g. after an .env change

# redeploy new code:
cd /opt/tcg/app && git pull
cd backend && npm ci && npx prisma migrate deploy
sudo systemctl restart tcg-indexer tcg-api
cd ../frontend && npm ci && npm run build   # if frontend changed

# swap RPC providers: edit SEPOLIA_RPC_URL in backend/.env, then:
sudo systemctl restart tcg-indexer

# cost control: stop the VM when idle (services auto-resume on start):
gcloud compute instances stop tcg-backend --zone=<ZONE>
```

The chain is the source of truth — `prod.db` can always be rebuilt by re-syncing
from `DEPLOY_BLOCK`. A periodic copy to a bucket avoids paying that re-sync cost.

---

## Hardening / follow-ups

1. **Reserve a static IP.** The external IP is ephemeral and can change on stop/start.
   With TLS (step 9) the frontend targets `<DOMAIN>`, not the IP, so an IP change only
   needs a DNS `A`-record update — no rebuild. A reserved static IP removes even that:
   ```bash
   gcloud compute addresses create tcg-ip --region=<REGION>
   # then assign it to the instance's access config
   ```
2. **`trust proxy`.** Behind nginx the rate limiter sees the proxy IP, so per-IP
   limiting collapses to a single shared bucket (hence the raised
   `API_RATE_LIMIT_MAX`). For correct per-IP limiting, set
   `app.set("trust proxy", 1)` in `backend/src/index.ts`.
3. **Dedicated service user.** This guide runs the services as the login SSH user for
   simplicity. To harden, create a `nologin` system user, `chown` `/opt/tcg` to it,
   and set `User=` in both units. (Low risk — the backend holds no keys and signs
   nothing; it is a read replica.)
4. **Persist swap** across reboots by adding `/swapfile` to `/etc/fstab` (only needed
   for builds, not at runtime).
