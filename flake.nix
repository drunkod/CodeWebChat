{
  description = "Development environment for Code Web Chat";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forEachSystem =
        function: nixpkgs.lib.genAttrs systems (system: function (import nixpkgs { inherit system; }));
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.git
            pkgs.nodejs_22
            pkgs.pnpm
          ];

          env = {
            COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
          };

          shellHook = ''
            echo "Code Web Chat development shell"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
            echo "Run 'pnpm install' to install workspace dependencies."
          '';
        };
      });
    };
}
