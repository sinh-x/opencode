{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodejs
            pkg-config
            openssl
            git
          ];
        };
      });

      overlays = {
        default =
          final: _prev: {
            opencode = final.callPackage ./nix/opencode-bin.nix { };
          };
      };

      packages = forEachSystem (
        pkgs: rec {
          default = pkgs.callPackage ./nix/opencode-bin.nix { };
          opencode = default;
        }
      );
    };
}
