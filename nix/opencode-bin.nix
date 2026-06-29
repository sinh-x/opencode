{
  lib,
  stdenvNoCC,
  makeBinaryWrapper,
  ripgrep,
  installShellFiles,
  writableTmpDirAsHomeHook,
  bun,
  nodejs,
  src,
}:
let
  version = "1.17.11";
in
stdenvNoCC.mkDerivation {
  pname = "opencode";
  inherit version src;

  nativeBuildInputs = [
    bun
    nodejs
    installShellFiles
    makeBinaryWrapper
    writableTmpDirAsHomeHook
  ];

  env.OPENCODE_DISABLE_MODELS_FETCH = "true";
  env.OPENCODE_VERSION = version;
  env.OPENCODE_CHANNEL = "prod";

  buildPhase = ''
    runHook preBuild

    export HOME=$(mktemp -d)
    bun install --frozen-lockfile

    cd ./packages/opencode
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/opencode-*/bin/opencode $out/bin/opencode

    wrapProgram $out/bin/opencode \
      --prefix PATH : ${lib.makeBinPath [ ripgrep ]}

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    export HOME=$(mktemp -d)
    installShellCompletion --cmd opencode \
      --bash <($out/bin/opencode completion 2>/dev/null || echo "") \
      --zsh <(SHELL=/bin/zsh $out/bin/opencode completion 2>/dev/null || echo "")
  '';

  passthru = {
    env = {
      OPENCODE_VERSION = version;
      OPENCODE_CHANNEL = "prod";
      OPENCODE_DISABLE_MODELS_FETCH = true;
    };
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "opencode";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
