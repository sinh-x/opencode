{
  lib,
  stdenvNoCC,
  bun,
  src,
}:
stdenvNoCC.mkDerivation {
  name = "opencode-node-modules";
  inherit src;

  nativeBuildInputs = [ bun ];

  outputHashMode = "recursive";
  outputHash = lib.fakeHash;

  buildPhase = ''
    export HOME=$(mktemp -d)
    bun install --frozen-lockfile --no-cache
    mkdir -p $out
    cp -r node_modules $out/
  '';
}
