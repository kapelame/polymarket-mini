const { ethers } = require("ethers");
const { getOrderHash, getDomainSeparator } = require("./src/signing/verify");
const { DOMAIN, TYPES, MSG_TO_SIGN }       = require("./src/auth/l1");
const { buildHmacSignature }               = require("./src/auth/l2");

const CLOB_URL      = "http://localhost:3000";
const CHAIN_ID      = 31337;
const EXCHANGE_ADDR = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const RPC_URL       = "http://localhost:8545";

const YES_TOKEN = "25289317257362363651730503519257896332338764406922007607406620590504396926851";
const NO_TOKEN  = "81738685232256441632133434018448203862643857125141975749994934705394084679515";

// Account 0 — has YES tokens, will SELL
const SELLER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Account 2 — has USDC, will BUY
const BUYER_KEY  = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const EXCHANGE_ABI = [
    "function registerOrder((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) order)",
];
const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];
const CTF_ABI  = ["function balanceOf(address,uint256) view returns (uint256)"];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const seller   = new ethers.Wallet(SELLER_KEY, provider);
const buyer    = new ethers.Wallet(BUYER_KEY,  provider);
const exchange = new ethers.Contract(EXCHANGE_ADDR, EXCHANGE_ABI, provider);
const usdc     = new ethers.Contract("0x5FbDB2315678afecb367f032d93F642f64180aa3", USDC_ABI, provider);
const ctf      = new ethers.Contract("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", CTF_ABI,  provider);

async function getApiCreds(wallet) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce     = 0;
    const message   = { address: wallet.address, timestamp, nonce, message: MSG_TO_SIGN };
    const domain    = { ...DOMAIN, chainId: CHAIN_ID };
    const signature = await wallet.signTypedData(domain, TYPES, message);
    const resp = await fetch(`${CLOB_URL}/auth/api-key`, {
        method: "POST",
        headers: {
            "poly_address":   wallet.address,
            "poly_timestamp": timestamp,
            "poly_nonce":     String(nonce),
            "poly_signature": signature,
        },
    });
    const creds = await resp.json();
    if (creds.error) throw new Error(`L1 auth failed: ${creds.error}`);
    creds.address = wallet.address;
    return creds;
}

function l2Headers(creds, method, path, body = "") {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sig       = buildHmacSignature(creds.secret, timestamp, method, path, body);
    return {
        "Content-Type":   "application/json",
        "poly_address":   creds.address,
        "poly_api_key":   creds.apiKey,
        "poly_timestamp": timestamp,
        "poly_signature": sig,
    };
}

async function buildSignedOrder(wallet, { tokenId, side, makerAmount, takerAmount, salt }) {
    const order = {
        salt:          String(salt),
        maker:         wallet.address,
        signer:        wallet.address,
        taker:         "0x0000000000000000000000000000000000000000",
        tokenId:       String(tokenId),
        makerAmount:   String(makerAmount),
        takerAmount:   String(takerAmount),
        expiration:    "0",
        nonce:         "0",
        feeRateBps:    "0",
        side,
        signatureType: 0,
    };
    const domainSep = getDomainSeparator(CHAIN_ID, EXCHANGE_ADDR);
    const orderHash = getOrderHash(order, domainSep);
    order.signature = ethers.Signature.from(wallet.signingKey.sign(orderHash)).serialized;
    return order;
}

async function registerOnChain(wallet, order, nonce) {
    const ex = exchange.connect(wallet);
    const chainOrder = {
        ...order,
        salt:        BigInt(order.salt),
        tokenId:     BigInt(order.tokenId),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        expiration:  BigInt(order.expiration),
        nonce:       BigInt(order.nonce),
        feeRateBps:  BigInt(order.feeRateBps),
        side:        order.side === "BUY" ? 0 : 1,
    };
    const tx = await ex.registerOrder(chainOrder, { nonce });
    await tx.wait();
    console.log(`  registerOrder ✓ [${order.side}] ${wallet.address.slice(0,10)}`);
}

async function postOrder(creds, order) {
    const body    = JSON.stringify(order);
    const headers = l2Headers(creds, "POST", "/order", body);
    const resp    = await fetch(`${CLOB_URL}/order`, { method: "POST", headers, body });
    return resp.json();
}

async function showBalances(label) {
    const sellerUsdc = await usdc.balanceOf(seller.address);
    const sellerYes  = await ctf.balanceOf(seller.address, YES_TOKEN);
    const buyerUsdc  = await usdc.balanceOf(buyer.address);
    const buyerYes   = await ctf.balanceOf(buyer.address, YES_TOKEN);
    console.log(`\n[${label}]`);
    console.log(`  SELLER (${seller.address.slice(0,10)}) USDC: ${ethers.formatUnits(sellerUsdc,6)}  YES: ${ethers.formatUnits(sellerYes,6)}`);
    console.log(`  BUYER  (${buyer.address.slice(0,10)}) USDC: ${ethers.formatUnits(buyerUsdc,6)}  YES: ${ethers.formatUnits(buyerYes,6)}`);
}

async function main() {
    await showBalances("BEFORE");

    // Get API creds for both wallets
    const sellerCreds = await getApiCreds(seller);
    const buyerCreds  = await getApiCreds(buyer);
    console.log(`\nSeller API key: ${sellerCreds.apiKey}`);
    console.log(`Buyer  API key: ${buyerCreds.apiKey}`);

    // Build orders
    // Seller: give 100 YES tokens, want 60 USDC (@$0.60)
    // Buyer:  spend 65 USDC, want 100 YES tokens (@$0.65 — crosses!)
    const sellOrder = await buildSignedOrder(seller, {
        tokenId:     YES_TOKEN,
        side:        "SELL",
        makerAmount: 100e6,
        takerAmount: 60e6,
        salt:        Date.now(),
    });
    const buyOrder = await buildSignedOrder(buyer, {
        tokenId:     YES_TOKEN,
        side:        "BUY",
        makerAmount: 65e6,
        takerAmount: 100e6,
        salt:        Date.now() + 1,
    });

    // Register both orders on-chain
    console.log("\nRegistering on-chain...");
    const sellerNonce = await provider.getTransactionCount(seller.address, "latest");
    const buyerNonce  = await provider.getTransactionCount(buyer.address,  "latest");
    await registerOnChain(seller, sellOrder, sellerNonce);
    await registerOnChain(buyer,  buyOrder,  buyerNonce);

    // Post to CLOB
    console.log("\nPosting to CLOB...");
    console.log("  SELL ->", await postOrder(sellerCreds, sellOrder));
    console.log("  BUY  ->", await postOrder(buyerCreds,  buyOrder));

    // Wait for engine to match and settle on-chain
    console.log("\nWaiting for on-chain settlement...");
    await new Promise(r => setTimeout(r, 3000));

    await showBalances("AFTER");
    console.log("\nExpected: seller +60 USDC -100 YES | buyer -60 USDC +100 YES");
}

main().catch(console.error);
