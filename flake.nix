{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    bun.url = "github:oven-sh/bun/bun-v1.3.14";
  };

  outputs =
    { self, nixpkgs, bun, ... }:
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
          final: _prev: {
            opencode = final.callPackage ./nix/opencode.nix {
              bun = final.callPackage ./nix/bun-bin.nix { version = bunVersion; };
              node_modules = final.callPackage ./nix/node_modules.nix {
                bun = final.callPackage ./nix/bun-bin.nix { version = bunVersion; };
              };
            };
          };
      };

      packages = forEachSystem (
        pkgs: rec {
          default = pkgs.callPackage ./nix/opencode.nix {
            bun = pkgs.callPackage ./nix/bun-bin.nix { version = bunVersion; };
            node_modules = pkgs.callPackage ./nix/node_modules.nix {
              bun = pkgs.callPackage ./nix/bun-bin.nix { version = bunVersion; };
            };
          };
          opencode = default;
        }
      );
    };
}
