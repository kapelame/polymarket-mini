import { keccak256, encodeAbiParameters, encodePacked, parseAbiParameters } from "viem";

const ORDER_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "Order(uint256 salt,address maker,address signer,address taker," +
    "uint256 tokenId,uint256 makerAmount,uint256 takerAmount," +
    "uint256 expiration,uint256 nonce,uint256 feeRateBps," +
    "uint8 side,uint8 signatureType)"
  )
);

export const EXCHANGE_ADDRESS = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as const;
export const USDC_ADDRESS     = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
export const CTF_ADDRESS      = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
export const CHAIN_ID         = 31337;
export const CLOB_URL         = "http://localhost:3000";

export const YES_TOKEN = "25289317257362363651730503519257896332338764406922007607406620590504396926851";
export const NO_TOKEN  = "81738685232256441632133434018448203862643857125141975749994934705394084679515";

export function getDomainSeparator() {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [
      keccak256(new TextEncoder().encode("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
      keccak256(new TextEncoder().encode("CTFExchange")),
      keccak256(new TextEncoder().encode("1")),
      BigInt(CHAIN_ID),
      EXCHANGE_ADDRESS,
    ]
  ));
}

export function getOrderHash(order: {
  salt: bigint; maker: string; signer: string; taker: string;
  tokenId: bigint; makerAmount: bigint; takerAmount: bigint;
  expiration: bigint; nonce: bigint; feeRateBps: bigint;
  side: number; signatureType: number;
}) {
  const structHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8"),
    [
      ORDER_TYPEHASH,
      order.salt, order.maker as `0x${string}`, order.signer as `0x${string}`, order.taker as `0x${string}`,
      order.tokenId, order.makerAmount, order.takerAmount,
      order.expiration, order.nonce, order.feeRateBps,
      order.side, order.signatureType,
    ]
  ));
  return keccak256(encodePacked(["string", "bytes32", "bytes32"], ["\x19\x01", getDomainSeparator(), structHash]));
}

// L1 auth types
export const AUTH_DOMAIN = { name: "ClobAuthDomain", version: "1", chainId: CHAIN_ID };
export const AUTH_TYPES  = {
  ClobAuth: [
    { name: "address",   type: "address" },
    { name: "timestamp", type: "string"  },
    { name: "nonce",     type: "uint256" },
    { name: "message",   type: "string"  },
  ],
};
export const AUTH_MSG = "This message attests that I control the given wallet";

// L2 HMAC
export async function buildHmacSig(secret: string, timestamp: string, method: string, path: string, body = "") {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret), c => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const msg  = new TextEncoder().encode(`${timestamp}${method.toUpperCase()}${path}${body}`);
  const sig  = await crypto.subtle.sign("HMAC", key, msg);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
