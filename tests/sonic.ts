import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Sonic } from "../target/types/sonic";

describe("initialize_program", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Sonic as Program<Sonic>;

  it("Is initialized!", async () => {
    // Generate a new keypair for the program account
    const stateAccount = anchor.web3.Keypair.generate();

    // Pass the new account to initialize
    const tx = await program.methods
      .initialize()
      .accounts({
        authority: anchor.getProvider().publicKey,
        state: stateAccount.publicKey,
      })
      .signers([stateAccount])
      .rpc();

    console.log("Your transaction signature", tx);
  });
});
