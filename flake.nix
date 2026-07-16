{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    bun.url = "github:oven-sh/bun/bun-v1.3.14";
  };

  outputs =
    {
      self,
      nixpkgs,
      bun,
      ...
    }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
      bunVersion = "1.3.14";
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            (pkgs.callPackage ./nix/bun-bin.nix { version = bunVersion; })
            pkgs.nodejs
            pkgs.pkg-config
            pkgs.openssl
            pkgs.git
          ];
        };
      });

      overlays = {
        default =
          final: _prev:
          let
            bunPinned = final.callPackage ./nix/bun-bin.nix { version = bunVersion; };
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
              bun = bunPinned;
            };
            opencode = final.callPackage ./nix/opencode.nix {
              inherit node_modules;
              bun = bunPinned;
            };
          in
          {
            inherit opencode;
            opencode-bin = final.callPackage ./nix/opencode-bin.nix { };
          };
      };


      packages = forEachSystem (
        pkgs:
        let
          bunPinned = pkgs.callPackage ./nix/bun-bin.nix { version = bunVersion; };
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
            bun = bunPinned;
          };
          opencode = pkgs.callPackage ./nix/opencode.nix {
            inherit node_modules;
            bun = bunPinned;
          };
          opencode-bin = pkgs.callPackage ./nix/opencode-bin.nix { };
        in
        rec {
          default = opencode;
          inherit opencode opencode-bin;
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}