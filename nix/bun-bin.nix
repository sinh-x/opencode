{
  lib,
  stdenv,
  fetchurl,
  autoPatchelfHook,
  unzip,
  version,
}:
let
  sys = {
    x86_64-linux = { arch = "x64"; os = "linux"; hash = "sha256-lR7iruhV8IWVruxiJSJqKY0/6oOj3NZGXAnLzN9+hI8="; };
    aarch64-linux = { arch = "aarch64"; os = "linux"; hash = "sha256-on/7Y6gxA3WDbg1vZorhf6jY0YuIw3yCHGUzGXOhmjs="; };
    x86_64-darwin = { arch = "x64"; os = "darwin"; hash = "sha256-QYPfM3RiPlurMVxUfPoJdFM81FfYa3O2OfeoeXTNZjM="; };
    aarch64-darwin = { arch = "aarch64"; os = "darwin"; hash = "sha256-2LliIYKK1vl6x6wKt+lYcjQa92MAHogD6CZ2UsJlJiA="; };
  }.${stdenv.hostPlatform.system} or (throw "unsupported system: ${stdenv.hostPlatform.system}");
  src = fetchurl {
    url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${sys.os}-${sys.arch}.zip";
    hash = sys.hash;
  };
in
stdenv.mkDerivation {
  pname = "bun";
  inherit version src;

  nativeBuildInputs = [ unzip ] ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];
  buildInputs = lib.optionals stdenv.hostPlatform.isLinux [ stdenv.cc.cc.lib ];

  sourceRoot = ".";
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/bin
    install -Dm755 bun-${sys.os}-${sys.arch}/bun $out/bin/bun
    runHook postInstall
  '';

  meta = {
    description = "Incredibly fast JavaScript runtime, bundler, test runner, and package manager";
    homepage = "https://bun.sh";
    license = lib.licenses.mit;
    mainProgram = "bun";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
