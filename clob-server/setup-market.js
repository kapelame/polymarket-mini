const { ethers } = require("ethers");

const RPC_URL       = "http://localhost:8545";
const USDC_ADDR     = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const CTF_ADDR      = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const EXCHANGE_ADDR = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const ORACLE_ADDR   = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

const TRADER_KEY    = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OPERATOR_KEY  = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const USDC_ABI = [
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function mint(address,uint256)",
];
const CTF_ABI = [
    "function prepareCondition(address,bytes32,uint256)",
    "function getConditionId(address,bytes32,uint256) view returns (bytes32)",
    "function getCollectionId(bytes32,bytes32,uint256) view returns (bytes32)",
    "function getPositionId(address,bytes32) view returns (uint256)",
    "function setApprovalForAll(address,bool)",
    "function splitPosition(address,bytes32,bytes32,uint256[],uint256)",
    "function balanceOf(address,uint256) view returns (uint256)",
];
const EXCHANGE_ABI = [
    "function registerToken(bytes32,uint256)",
];
const ORACLE_ABI = [
    "function prepareMarket(bytes32,bytes32,uint256)",
    "function getMarket(bytes32) view returns (tuple(bytes32 conditionId,address creator,uint256 expiration,uint8 stage,uint8 proposedAnswer,address proposer,uint256 proposerBond,uint256 proposedAt,address disputer,uint256 disputerBond,bool resolved))",
];

async function main() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const trader   = new ethers.Wallet(TRADER_KEY,   provider);
    const operator = new ethers.Wallet(OPERATOR_KEY, provider);

    const usdc     = new ethers.Contract(USDC_ADDR,     USDC_ABI,     trader);
    const ctf      = new ethers.Contract(CTF_ADDR,      CTF_ABI,      trader);
    const exchange = new ethers.Contract(EXCHANGE_ADDR, EXCHANGE_ABI, trader);
    const oracle   = new ethers.Contract(ORACLE_ADDR,   ORACLE_ABI,   trader);

    let nonce = await provider.getTransactionCount(trader.address, "latest");
    const send = async (contract, method, args) => {
        const tx = await contract[method](...args, { nonce: nonce++ });
        await tx.wait();
        console.log(`  ✓ ${method}`);
    };

    const QUESTION    = "Will ETH hit $10k in 2025?";
    const questionId  = ethers.keccak256(ethers.toUtf8Bytes(QUESTION));
    // Market expires in 7 days (for testing we can warp time)
    const EXPIRATION  = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    console.log("Question ID:", questionId);
    console.log("Expiration:", new Date(EXPIRATION * 1000).toISOString());

    // 1. Prepare CTF condition (oracle contract is the oracle address)
    console.log("\n1. Preparing CTF condition...");
    const oracleSigner = new ethers.Contract(CTF_ADDR, CTF_ABI,
        new ethers.Wallet(OPERATOR_KEY, provider));
    let opNonce = await provider.getTransactionCount(operator.address, "latest");
    const tx1 = await oracleSigner.prepareCondition(ORACLE_ADDR, questionId, 2, { nonce: opNonce++ });
    await tx1.wait();
    console.log("  ✓ prepareCondition");

    const conditionId = await ctf.getConditionId(ORACLE_ADDR, questionId, 2);
    console.log("  conditionId:", conditionId);

    // 2. Register tokens in exchange
    console.log("\n2. Registering tokens...");
    const exchOp = new ethers.Contract(EXCHANGE_ADDR, EXCHANGE_ABI,
        new ethers.Wallet(OPERATOR_KEY, provider));
    const tx2 = await exchOp.registerToken(conditionId, 1, { nonce: opNonce++ });
    await tx2.wait();
    const tx3 = await exchOp.registerToken(conditionId, 2, { nonce: opNonce++ });
    await tx3.wait();
    console.log("  ✓ YES + NO registered");

    // 3. Register market with oracle
    console.log("\n3. Registering market with oracle...");
    const oracleOp = new ethers.Contract(ORACLE_ADDR, ORACLE_ABI,
        new ethers.Wallet(OPERATOR_KEY, provider));
    const tx4 = await oracleOp.prepareMarket(questionId, conditionId, EXPIRATION, { nonce: opNonce++ });
    await tx4.wait();
    console.log("  ✓ prepareMarket");

    // 4. Compute token IDs
    const yesCollId = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 1);
    const noCollId  = await ctf.getCollectionId(ethers.ZeroHash, conditionId, 2);
    const yesToken  = await ctf.getPositionId(USDC_ADDR, yesCollId);
    const noToken   = await ctf.getPositionId(USDC_ADDR, noCollId);
    console.log("\nYES tokenId:", yesToken.toString());
    console.log("NO  tokenId:", noToken.toString());

    // 5. Approve exchange
    console.log("\n4. Setting approvals...");
    await send(usdc, "approve", [EXCHANGE_ADDR, ethers.MaxUint256]);
    await send(ctf,  "setApprovalForAll", [EXCHANGE_ADDR, true]);

    // 6. Mint initial YES/NO tokens for liquidity
    console.log("\n5. Minting initial tokens...");
    await send(usdc, "approve", [CTF_ADDR, ethers.parseUnits("10000", 6)]);
    await send(ctf,  "splitPosition", [
        USDC_ADDR, ethers.ZeroHash, conditionId,
        [1, 2], ethers.parseUnits("10000", 6)
    ]);

    const yesBal = await ctf.balanceOf(trader.address, yesToken);
    const noBal  = await ctf.balanceOf(trader.address, noToken);
    console.log("  YES balance:", ethers.formatUnits(yesBal, 6));
    console.log("  NO  balance:", ethers.formatUnits(noBal,  6));

    // 7. Approve account2
    console.log("\n6. Setting up account2...");
    const acc2Key = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    const acc2    = new ethers.Wallet(acc2Key, provider);
    const usdcDep = new ethers.Contract(USDC_ADDR, [...USDC_ABI, "function mint(address,uint256)"], trader);
    let acc2Nonce = await provider.getTransactionCount(acc2.address, "latest");

    await send(usdcDep, "mint", [acc2.address, ethers.parseUnits("10000", 6)]);

    const usdc2 = new ethers.Contract(USDC_ADDR, USDC_ABI, acc2);
    const ctf2  = new ethers.Contract(CTF_ADDR,  CTF_ABI,  acc2);
    const tx5   = await usdc2.approve(EXCHANGE_ADDR, ethers.MaxUint256, { nonce: acc2Nonce++ });
    await tx5.wait();
    const tx6   = await ctf2.setApprovalForAll(EXCHANGE_ADDR, true, { nonce: acc2Nonce++ });
    await tx6.wait();
    console.log("  ✓ account2 ready");

    console.log("\n✅ Market setup complete!");
    console.log("\n.env values:");
    console.log(`YES_TOKEN=${yesToken}`);
    console.log(`NO_TOKEN=${noToken}`);
    console.log(`QUESTION_ID=${questionId}`);
    console.log(`ORACLE_ADDRESS=${ORACLE_ADDR}`);
    console.log(`EXPIRATION=${EXPIRATION}`);
}

main().catch(console.error);
