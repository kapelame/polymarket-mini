const { ethers } = require("ethers");
const { Order } = require("../orderbook/OrderBook");
const OrderRepo = require("../db/OrderRepository");
const { getOrderHash, getDomainSeparator } = require("../signing/verify");

const SELLER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEMO_TRADER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const USDC_ABI = [
    "function mint(address,uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
];

const CTF_ABI = [
    "function splitPosition(address,bytes32,bytes32,uint256[],uint256)",
    "function setApprovalForAll(address,bool)",
    "function isApprovedForAll(address,address) view returns (bool)",
    "function balanceOf(address,uint256) view returns (uint256)",
];

const EXCHANGE_ABI = [
    "function registerOrder((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) order)",
];

function toUnits(value) {
    return ethers.parseUnits(String(value), 6);
}

async function ensureErc20Balance(token, signer, address, minimum, mintAmount) {
    const balance = await token.balanceOf(address);
    if (balance < minimum) {
        const tx = await token.connect(signer).mint(address, mintAmount);
        await tx.wait();
    }
}

async function ensureAllowance(token, signer, ownerAddress, spender, amount) {
    const allowance = await token.allowance(ownerAddress, spender);
    if (allowance < amount) {
        const tx = await token.connect(signer).approve(spender, ethers.MaxUint256);
        await tx.wait();
    }
}

async function ensureApprovalForAll(ctf, signer, ownerAddress, operator) {
    const approved = await ctf.isApprovedForAll(ownerAddress, operator);
    if (!approved) {
        const tx = await ctf.connect(signer).setApprovalForAll(operator, true);
        await tx.wait();
    }
}

async function buildSignedOrder(wallet, { tokenId, side, makerAmount, takerAmount, salt, chainId, exchangeAddress }) {
    const order = {
        salt: String(salt),
        maker: wallet.address,
        signer: wallet.address,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId: String(tokenId),
        makerAmount: String(makerAmount),
        takerAmount: String(takerAmount),
        expiration: "0",
        nonce: "0",
        feeRateBps: "0",
        side,
        signatureType: 0,
    };
    const domainSep = getDomainSeparator(chainId, exchangeAddress);
    const orderHash = getOrderHash(order, domainSep);
    order.signature = ethers.Signature.from(wallet.signingKey.sign(orderHash)).serialized;
    return order;
}

function toChainOrder(order) {
    return {
        ...order,
        salt: BigInt(order.salt),
        tokenId: BigInt(order.tokenId),
        makerAmount: BigInt(order.makerAmount),
        takerAmount: BigInt(order.takerAmount),
        expiration: BigInt(order.expiration),
        nonce: BigInt(order.nonce),
        feeRateBps: BigInt(order.feeRateBps),
        side: order.side === "BUY" ? 0 : 1,
    };
}

async function registerAndPost({ exchange, signer, order, books }) {
    const tx = await exchange.connect(signer).registerOrder(toChainOrder(order));
    await tx.wait();

    const liveOrder = new Order(order);
    books.get(liveOrder.tokenId.toString())?.add(liveOrder);
    OrderRepo.save({
        orderId: liveOrder.id,
        maker: liveOrder.maker,
        tokenId: liveOrder.tokenId.toString(),
        side: liveOrder.side,
        makerAmount: liveOrder.makerAmount.toString(),
        takerAmount: liveOrder.takerAmount.toString(),
        salt: liveOrder.salt.toString(),
        signature: order.signature,
        ...order,
    });
    return liveOrder.id;
}

async function seedDemoLiquidity(market, books, options = {}) {
    const rpcUrl = options.rpcUrl || process.env.RPC_URL || "http://localhost:8545";
    const chainId = Number(options.chainId || process.env.CHAIN_ID || "31337");
    const usdcAddress = options.usdcAddress || process.env.USDC_ADDRESS;
    const ctfAddress = options.ctfAddress || process.env.CTF_ADDRESS;
    const exchangeAddress = options.exchangeAddress || process.env.EXCHANGE_ADDRESS;

    if (!market?.conditionId || !market?.yesToken || !market?.noToken) {
        throw new Error("Cannot seed liquidity without a complete market");
    }
    if (!usdcAddress || !ctfAddress || !exchangeAddress) {
        throw new Error("Cannot seed liquidity without USDC, CTF, and Exchange addresses");
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const seller = new ethers.Wallet(SELLER_KEY, provider);
    const demoTrader = new ethers.Wallet(DEMO_TRADER_KEY, provider);
    const sellerSigner = new ethers.NonceManager(seller);
    const demoSigner = new ethers.NonceManager(demoTrader);
    const usdc = new ethers.Contract(usdcAddress, USDC_ABI, provider);
    const ctf = new ethers.Contract(ctfAddress, CTF_ABI, provider);
    const exchange = new ethers.Contract(exchangeAddress, EXCHANGE_ABI, provider);

    const liquidity = toUnits(250);
    await ensureErc20Balance(usdc, sellerSigner, seller.address, liquidity, toUnits(10000));
    await ensureAllowance(usdc, sellerSigner, seller.address, ctfAddress, liquidity);

    const currentYes = await ctf.balanceOf(seller.address, market.yesToken);
    const currentNo = await ctf.balanceOf(seller.address, market.noToken);
    if (currentYes < toUnits(100) || currentNo < toUnits(100)) {
        const tx = await ctf.connect(sellerSigner).splitPosition(
            usdcAddress,
            ethers.ZeroHash,
            market.conditionId,
            [1, 2],
            liquidity
        );
        await tx.wait();
    }

    await ensureApprovalForAll(ctf, sellerSigner, seller.address, exchangeAddress);

    await ensureErc20Balance(usdc, sellerSigner, demoTrader.address, toUnits(1000), toUnits(50000));
    await ensureAllowance(usdc, demoSigner, demoTrader.address, exchangeAddress, toUnits(1000));
    await ensureApprovalForAll(ctf, demoSigner, demoTrader.address, exchangeAddress);

    const salt = Date.now();
    const orders = [
        await buildSignedOrder(seller, {
            tokenId: market.yesToken,
            side: "SELL",
            makerAmount: toUnits(100),
            takerAmount: toUnits(57),
            salt,
            chainId,
            exchangeAddress,
        }),
        await buildSignedOrder(seller, {
            tokenId: market.noToken,
            side: "SELL",
            makerAmount: toUnits(100),
            takerAmount: toUnits(43),
            salt: salt + 1,
            chainId,
            exchangeAddress,
        }),
    ];

    const orderIds = [];
    for (const order of orders) {
        orderIds.push(await registerAndPost({ exchange, signer: sellerSigner, order, books }));
    }

    return orderIds;
}

module.exports = { seedDemoLiquidity };
