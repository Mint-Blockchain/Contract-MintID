// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

contract MintID is
    ERC721AUpgradeable,
    IERC2981,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    struct MintConfig {
        uint64 price;
        uint32 startTime;
        uint32 endTime;
    }

    MintConfig public mintConfig;
    uint256 constant MAX_SUPPLY = 10000;
    uint8 constant maxMintPerAddress = 5;
    uint256 constant DENO = 1000;

    uint256 public royalty;
    address public treasuryAddress;

    string private _baseUri;

    mapping(address => uint256) public publiclist;

    error InvalidCaller();
    error MintNotStart();
    error MintFinished();
    error OverLimit(address minter);
    error OverMaxLimit();
    error InsufficientBalance(address minter);
    error TokenNotMinted(uint256 tokenId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _address
    ) public initializerERC721A initializer {
        __ERC721A_init("MintID", "MintID");
        __UUPSUpgradeable_init();
        __Pausable_init();
        __Ownable_init(_msgSender());

        royalty = 50;
        treasuryAddress = address(_address);
    }

    modifier isEOA() {
        if (tx.origin != msg.sender) revert InvalidCaller();
        _;
    }

    modifier isSufficient() {
        if (block.timestamp < mintConfig.startTime) revert MintNotStart();
        if (block.timestamp > mintConfig.endTime) revert MintFinished();
        _;
    }

    function minted() public view returns (uint256) {
        return _totalMinted();
    }

    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    function mint(
        uint8 _quantity
    ) external payable isEOA whenNotPaused isSufficient {
        address account = _msgSender();
        if (msg.value < mintConfig.price * _quantity)
            revert InsufficientBalance(account);
        if (_quantity + minted() > MAX_SUPPLY) revert OverMaxLimit();
        if (publiclist[account] + _quantity > maxMintPerAddress)
            revert OverLimit(account);
        publiclist[account] += _quantity;
        _safeMint(account, _quantity);
    }

    /**
     * @inheritdoc IERC2981
     */
    function royaltyInfo(
        uint256 tokenId,
        uint256 salePrice
    ) external view override returns (address, uint256) {
        if (!super._exists(tokenId)) revert TokenNotMinted(tokenId);
        uint256 royaltyAmount = (salePrice * royalty) / DENO;
        return (treasuryAddress, royaltyAmount);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseUri;
    }

    function setBaseURI(string calldata _uri) external onlyOwner {
        _baseUri = _uri;
    }

    function setMintConfig(
        uint64 _price,
        uint32 _startTime,
        uint32 _endTime
    ) external onlyOwner {
        require(_endTime > _startTime, "MP: MUST(end time  > Start time)");
        mintConfig = MintConfig(_price, _startTime, _endTime);
    }

    function setRoyalty(uint256 _royalty) external onlyOwner {
        require(
            _royalty <= 100 && _royalty >= 0,
            "MP: Royalty can only be between 0 and 10%"
        );
        royalty = _royalty;
    }

    function setTreasuryAddress(address _addr) external onlyOwner {
        require(_addr != address(0x0), "MP: Address not be zero");
        treasuryAddress = _addr;
    }

    function withdraw() external onlyOwner {
        require(
            treasuryAddress != address(0x0),
            "MP: Must set withdrawal address"
        );
        (bool success, ) = treasuryAddress.call{value: address(this).balance}(
            ""
        );
        require(success, "MP: Transfer failed");
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721AUpgradeable, IERC165) returns (bool) {
        return ERC721AUpgradeable.supportsInterface(interfaceId);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}
}
