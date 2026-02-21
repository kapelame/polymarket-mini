// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/core/MockUSDC.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/exchange/CTFExchange.sol";
import "../src/oracle/OptimisticOracle.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address operator    = vm.envAddress("OPERATOR_ADDRESS");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        MockUSDC          usdc     = new MockUSDC();
        ConditionalTokens ctf      = new ConditionalTokens();
        CTFExchange       exchange = new CTFExchange(address(usdc), address(ctf), operator);
        OptimisticOracle  oracle   = new OptimisticOracle(address(usdc), address(ctf), operator);

        usdc.mint(deployer, 100_000e6);
        usdc.mint(operator, 10_000e6);  // operator needs bond USDC

        vm.stopBroadcast();

        console.log("USDC:     ", address(usdc));
        console.log("CTF:      ", address(ctf));
        console.log("Exchange: ", address(exchange));
        console.log("Oracle:   ", address(oracle));
    }
}
