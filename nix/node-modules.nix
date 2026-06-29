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

    bun install --no-cache --ignore-scripts
    patchShebangs node_modules

    mkdir -p $out
    cp -r node_modules $out/
    cp -r packages $out/
  '';
}
