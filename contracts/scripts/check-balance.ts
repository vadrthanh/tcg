import { ethers } from "hardhat";
async function main() {
  const [signer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(signer.address);
  const net = await ethers.provider.getNetwork();
  console.log("Address :", signer.address);
  console.log("Network :", net.name, "chainId", Number(net.chainId));
  console.log("Balance :", ethers.formatEther(bal), "ETH");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
