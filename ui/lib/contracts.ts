export const EXCHANGE_ABI = [
  {
    name: "registerOrder",
    type: "function",
    inputs: [{
      name: "order",
      type: "tuple",
      components: [
        { name: "salt",          type: "uint256" },
        { name: "maker",         type: "address" },
        { name: "signer",        type: "address" },
        { name: "taker",         type: "address" },
        { name: "tokenId",       type: "uint256" },
        { name: "makerAmount",   type: "uint256" },
        { name: "takerAmount",   type: "uint256" },
        { name: "expiration",    type: "uint256" },
        { name: "nonce",         type: "uint256" },
        { name: "feeRateBps",    type: "uint256" },
        { name: "side",          type: "uint8"   },
        { name: "signatureType", type: "uint8"   },
        { name: "signature",     type: "bytes"   },
      ],
    }],
    outputs: [],
  },
] as const;

export const USDC_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve",   type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const CTF_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "isApprovedForAll", type: "function", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "setApprovalForAll", type: "function", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
] as const;
