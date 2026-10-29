// SPDX-License-Identifier: MIT
pragma solidity =0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Protocol acceptance assets only. Neither token represents money or a claim.
contract TapeExitAcceptanceA is ERC20 {
    constructor() ERC20("TapeExit Acceptance A - No Monetary Value", "TAPE-TEST-A") {
        _mint(msg.sender, 1000 ether);
    }
}

contract TapeExitAcceptanceB is ERC20 {
    constructor() ERC20("TapeExit Acceptance B - No Monetary Value", "TAPE-TEST-B") {
        _mint(msg.sender, 1000 ether);
    }
}
