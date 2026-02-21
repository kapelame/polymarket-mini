// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/core/MockUSDC.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/exchange/CTFExchange.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address operator    = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerKey);

        MockUSDC usdc = new MockUSDC();
        console.log("USDC:    ", address(usdc));

        ConditionalTokens ctf = new ConditionalTokens();
        console.log("CTF:     ", address(ctf));

        CTFExchange exchange = new CTFExchange(address(usdc), address(ctf), operator);
        console.log("Exchange:", address(exchange));

        // Mint 10,000 USDC to deployer for testing
        usdc.mint(deployer, 10_000e6);
        console.log("Minted 10000 USDC to deployer:", deployer);

        vm.stopBroadcast();
    }
}
