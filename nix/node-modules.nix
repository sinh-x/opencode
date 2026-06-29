{
  lib,
  stdenv,
  bun,
  src,
}:
stdenv.mkDerivation {
  name = "opencode-node-modules";
  inherit src;

  nativeBuildInputs = [ bun ];

  outputHashMode = "recursive";
  outputHash = lib.fakeHash;

  buildPhase = ''
    export HOME=$(mktemp -d)

    # First pass: install packages but skip native build scripts
    bun install --no-cache --ignore-scripts

    # Fix shebangs so native install scripts can find interpreters
    patchShebangs node_modules

    # Second pass: run install scripts now that shebangs are fixed
    bun install --no-cache

    mkdir -p $out
    cp -r node_modules $out/
    cp -r packages $out/
  '';
}
