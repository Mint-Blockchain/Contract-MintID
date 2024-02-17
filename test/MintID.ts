import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

// treasuryAddress
const treasuryAddress = "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199";

const day = 60 * 60 * 24;
const publicPrice = ethers.parseEther("0.28");

function getNow() {
  return Math.floor(Date.now() / 1000);
}

function generateWallet() {
  const wallet = ethers.Wallet.createRandom(ethers.provider);
  return wallet;
}

describe("MintID", () => {
  async function deployFixture() {
    const V1contract = await ethers.getContractFactory("MintID");
    const [owner, otherAccount] = await ethers.getSigners();
    const v1contract = await upgrades.deployProxy(V1contract as any, [treasuryAddress], {
      initializer: "initialize",
      kind: "uups",
    });
    const contract = await v1contract.waitForDeployment();

    // generate wallets for test
    const publicUser = generateWallet();
    await owner.sendTransaction({
      to: publicUser.address,
      value: ethers.parseEther("2"),
    });
    const wlUser = generateWallet();
    await owner.sendTransaction({
      to: wlUser.address,
      value: ethers.parseEther("2"),
    });

    return {
      contract,
      treasuryAddress,
      owner,
      otherAccount,
      publicUser,
      wlUser,
    };
  }

  async function setRightContract(contract: any) {
    // set config
    const startDate = getNow() - day;
    const endDate = getNow() + day;
    await contract.setMintConfig(publicPrice, startDate, endDate);
  }

  describe("Deployment", () => {
    it("Set right treasuryAddress", async () => {
      const { contract, treasuryAddress } = await loadFixture(deployFixture);
      await expect(await contract.treasuryAddress()).to.equal(treasuryAddress);
    });

    it("Set right owner", async () => {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(await contract.owner()).to.equal(owner.address);
    });
  });

  describe("Mint condition", () => {
    it("Not start mint", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await contract.setMintConfig(publicPrice, getNow() + day, getNow() + 2 * day);

      await expect(
        contract.mint(1, {
          value: publicPrice,
        })
      ).to.be.revertedWithCustomError(contract, "MintNotStart");
    });
    it("Already finish mint", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await contract.setMintConfig(publicPrice, getNow() - 2 * day, getNow() - day);

      await expect(
        contract.mint(1, {
          value: publicPrice,
        })
      ).to.be.revertedWithCustomError(contract, "MintFinished");
    });
  });

  describe("Mint", async () => {
    it("Should mint 5 items", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const contractCaller = contract.connect(publicUser);
      await (contractCaller as any).mint(5, {
        value: publicPrice * BigInt(5),
      });
      await expect(await contract.balanceOf(publicUser.address)).to.equal(5);
      await expect(await contract.publiclist(publicUser.address)).to.equal(5);
      await expect(await contract.minted()).to.equal(5);
      await expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(publicPrice * BigInt(5));
    });
    it("Should't mint 6 items", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const contractCaller = contract.connect(publicUser);
      await expect(
        (contractCaller as any).mint(6, {
          value: publicPrice * BigInt(6),
        })
      )
        .to.be.revertedWithCustomError(contract, "OverLimit")
        .withArgs(publicUser.address);
    });
  });

  describe("Royalty", async () => {
    it("Set wrong royalty beacause out of range", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await expect(contract.setRoyalty(101)).to.be.revertedWith("MP: Royalty can only be between 0 and 10%");
    });
    it("Set right royalty", async () => {
      const { contract } = await loadFixture(deployFixture);
      await contract.setRoyalty(100);
      await expect(await contract.royalty()).to.be.equal(100);
    });
    it("TokenId is not exist when get royalty info", async () => {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.royaltyInfo(101, ethers.parseEther("2")))
        .to.be.revertedWithCustomError(contract, "TokenNotMinted")
        .withArgs(101);
    });
    it("Get right royalty info", async () => {
      const { contract, publicUser } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const contractCaller = contract.connect(publicUser);
      await (contractCaller as any).mint(5, {
        value: publicPrice * BigInt(5),
      });
      await contract.setRoyalty(100);
      const value = ethers.parseEther("1");
      const [address, amount] = await contract.royaltyInfo(1, value);
      await expect(amount).to.be.equal(value / BigInt(10));
      await expect(address).to.be.equal(treasuryAddress);
    });
  });

  describe("Withdrawl", async () => {
    it("Public wallet can not withdraw", async () => {
      const { contract, publicUser, owner } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const contractCaller = contract.connect(publicUser);
      await expect((contractCaller as any).withdraw())
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
        .withArgs(publicUser.address);
    });
    it("Owner withdraw ETH to treasure address", async () => {
      const { contract, publicUser, owner } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const usedValue = publicPrice * BigInt(5);
      const contractCaller = contract.connect(publicUser);
      await (contractCaller as any).mint(5, {
        value: usedValue,
      });

      const beforeBanlance = await ethers.provider.getBalance(treasuryAddress);
      await contract.withdraw();
      const afterBanlance = await ethers.provider.getBalance(treasuryAddress);
      await expect(afterBanlance - beforeBanlance).to.be.equal(usedValue);
      await expect(await ethers.provider.getBalance(contract.getAddress())).to.be.equal(0);
    });
  });

  describe("Contract Upgrade", async () => {
    it("public wallet call upgrade function", async () => {
      const { contract, publicUser, owner } = await loadFixture(deployFixture);
      const V2Contract = await ethers.getContractFactory("MintID");
      const v2 = await V2Contract.deploy();
      const data = contract.interface.encodeFunctionData("setTreasuryAddress", [owner.address]);
      const publicCaller = contract.connect(publicUser);
      await expect((publicCaller as any).upgradeToAndCall(await v2.getAddress(), data))
        .to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount")
        .withArgs(publicUser.address);
    });
    it("Upgrade successsfully", async () => {
      const { contract, publicUser, owner } = await loadFixture(deployFixture);
      const v2Contract = await ethers.getContractFactory("MintID");
      contract.abi;
      const upgradeContract = await upgrades.upgradeProxy(contract, v2Contract, {
        kind: "uups",
        call: {
          fn: "setTreasuryAddress",
          args: [owner.address],
        },
      });
      await expect(await upgradeContract.treasuryAddress()).to.be.equal(owner.address);
    });
  });

  describe("staking", async () => {
    it("should pass", async () => {
      const { contract, publicUser, wlUser } = await loadFixture(deployFixture);
      await setRightContract(contract);
      const contractCaller = contract.connect(publicUser);
      const contractCallerWL = contract.connect(wlUser);

      await (contractCaller as any).mint(5, {
        value: publicPrice * BigInt(5),
      });

      await expect(await contract.stakingState()).to.be.equal(0);

      await expect((contractCaller as any).stake([1])).to.be.revertedWith("MP: Staking not open");

      await contract.setStakingState(1);

      await expect(await contract.stakingState()).to.be.equal(1);

      await expect((contractCaller as any).stake([])).to.revertedWith("MP: Staking zero tokens");

      await expect(await (contractCaller as any).stakedNum(publicUser.address)).to.be.equal(0);

      await (contractCaller as any).stake([1]);

      await expect(await contract.stakedAddressInfo(publicUser.address, 0)).to.be.equal(1);

      await expect(await (contractCaller as any).stakedNum(publicUser.address)).to.be.equal(1);

      await (contractCaller as any).approve(wlUser, 2);

      await expect((contractCallerWL as any).stake([2])).to.be.revertedWithCustomError(contract, "TransferFromIncorrectOwner");

      await (contractCaller as any).stake([2, 4, 5]);

      await expect(await contract.stakedAddressInfo(publicUser.address, 3)).to.be.equal(5);

      await expect(await (contractCaller as any).stakedNum(publicUser.address)).to.be.equal(4);
    });
  });
});
