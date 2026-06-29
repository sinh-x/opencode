{
  lib,
  stdenvNoCC,
  fetchurl,
  makeBinaryWrapper,
  ripgrep,
  installShellFiles,
  writableTmpDirAsHomeHook,
}:
let
  version = "1.17.3";
  sysInfo = {
    x86_64-linux = { arch = "x64"; os = "linux"; ext = "tar.gz"; hash = "sha256-1L0jiiwf9WrKHNM5fSGgoxf1mSI0UXp/jir7vXIBCn0="; };
    aarch64-linux = { arch = "arm64"; os = "linux"; ext = "tar.gz"; hash = "sha256-hhuMZs7VHW2aZup3POR+3mY6RL0X2De5whrPo0aIAeU="; };
    x86_64-darwin = { arch = "x64"; os = "darwin"; ext = "zip"; hash = "sha256-O/pnpWfe5ECog4hugsgjox01kAKffrjXrkA+BWpD4E="; };
    aarch64-darwin = { arch = "arm64"; os = "darwin"; ext = "zip"; hash = "sha256-tJlI+W2OksV31UhU4vA4OJ0Dw9+76sxEZDtzEjIQ/RM="; };
  }.${stdenvNoCC.hostPlatform.system} or (throw "unsupported system: ${stdenvNoCC.hostPlatform.system}");
  assetName = "opencode-${sysInfo.os}-${sysInfo.arch}.${sysInfo.ext}";
  src = fetchurl {
    url = "https://github.com/anomalyco/opencode/releases/download/v${version}/${assetName}";
    hash = sysInfo.hash;
  };
in
stdenvNoCC.mkDerivation {
  pname = "opencode";
  inherit version src;

  sourceRoot = ".";

  nativeBuildInputs = [
    installShellFiles
    makeBinaryWrapper
    writableTmpDirAsHomeHook
  ];

  dontAutoPatchelf = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 opencode $out/bin/opencode

    wrapProgram $out/bin/opencode \
      --prefix PATH : ${lib.makeBinPath [ ripgrep ]}

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    export HOME=$(mktemp -d)
    $out/bin/opencode completion 2>/dev/null >/dev/null || true
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
