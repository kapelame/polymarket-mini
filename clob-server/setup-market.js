const { ethers } = require("ethers");

const RPC_URL       = "http://localhost:8545";
const USDC_ADDR     = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CTF_ADDR      = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const EXCHANGE_ADDR = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const TRADER_KEY    = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const USDC_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
];
const CTF_ABI = [
    "function getConditionId(address oracle, bytes32 questionId, uint outcomeSlotCount) pure returns (bytes32)",
    "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint indexSet) pure returns (bytes32)",
    "function getPositionId(address collateralToken, bytes32 collectionId) pure returns (uint256)",
    "function setApprovalForAll(address operator, bool approved)",
    "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint[] partition, uint amount)",
    "function balanceOf(address account, uint256 id) view returns (uint256)",
];
const EXCHANGE_ABI = [
    "function registerToken(bytes32 conditionId, uint indexSet)",
    "function tokenRegistry(uint256) view returns (bytes32 conditionId, uint indexSet, bool registered)",
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const trader   = new ethers.Wallet(TRADER_KEY, provider);
    const usdc     = new ethers.Contract(USDC_ADDR,     USDC_ABI,     trader);
    const ctf      = new ethers.Contract(CTF_ADDR,      CTF_ABI,      trader);
    const exchange = new ethers.Contract(EXCHANGE_ADDR, EXCHANGE_ABI, trader);

    console.log("Trader:", trader.address);
    console.log("USDC balance:", ethers.formatUnits(await usdc.balanceOf(trader.address), 6));

    // Get current nonce once, increment manually
    let nonce = await provider.getTransactionCount(trader.address, "latest");
    console.log("Starting nonce:", nonce);

    const send = async (contract, method, args) => {
        const tx = await contract[method](...args, { nonce });
        nonce++;
        const rc = await tx.wait();
        console.log(`  ✓ ${method} (gas ${rc.gasUsed})`);
    };

    // Compute IDs (condition already prepared)
    const questionId  = ethers.keccak256(ethers.toUtf8Bytes("Will ETH hit $10k in 2025?"));
    const conditionId = await ctf.getConditionId(trader.address, questionId, 2);
    const yesCollId   = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 1);
    const noCollId    = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 2);
    const yesTokenId  = await ctf.getPositionId(USDC_ADDR, yesCollId);
    const noTokenId   = await ctf.getPositionId(USDC_ADDR, noCollId);

    console.log("\nconditionId:", conditionId);
    console.log("YES tokenId:", yesTokenId.toString());
    console.log("NO  tokenId:", noTokenId.toString());

    // Register tokens if needed
    const [,, yesRegistered] = await exchange.tokenRegistry(yesTokenId);
    if (!yesRegistered) {
        console.log("\n1. Registering tokens...");
        await send(exchange, "registerToken", [conditionId, 1]);
        await send(exchange, "registerToken", [conditionId, 2]);
    } else {
        console.log("\n1. Tokens already registered ✓");
    }

    // Approve USDC for exchange
    console.log("\n2. Approving USDC for exchange...");
    await send(usdc, "approve", [EXCHANGE_ADDR, ethers.MaxUint256]);

    // Approve ERC1155 for exchange
    console.log("\n3. Approving ERC1155 for exchange...");
    await send(ctf, "setApprovalForAll", [EXCHANGE_ADDR, true]);

    // Split if no tokens yet
    const yesBal = await ctf.balanceOf(trader.address, yesTokenId);
    if (yesBal === 0n) {
        console.log("\n4. Approving USDC for CTF...");
        await send(usdc, "approve", [CTF_ADDR, 1000e6]);
        console.log("\n5. Splitting 1000 USDC into YES+NO...");
        await send(ctf, "splitPosition", [USDC_ADDR, ethers.ZeroHash, conditionId, [1, 2], 1000e6]);
    } else {
        console.log("\n4-5. Already have tokens ✓");
    }

    const finalYes = await ctf.balanceOf(trader.address, yesTokenId);
    const finalNo  = await ctf.balanceOf(trader.address, noTokenId);
    console.log("\nYES balance:", ethers.formatUnits(finalYes, 6));
    console.log("NO  balance:", ethers.formatUnits(finalNo, 6));

    console.log("\n=== Add to .env ===");
    console.log(`MARKET_PAIRS=${yesTokenId}:${noTokenId}`);
    console.log(`YES_TOKEN_ID=${yesTokenId}`);
    console.log(`NO_TOKEN_ID=${noTokenId}`);
    console.log(`CONDITION_ID=${conditionId}`);
}

main().catch(console.error);
