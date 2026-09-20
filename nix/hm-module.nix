# Home-manager module for Dictation speech-to-text
#
# Provides a systemd user service for autostart.
# Usage: imports = [ dictation.homeManagerModules.default ];
#        services.dictation.enable = true;
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.dictation;
in
{
  options.services.dictation = {
    enable = lib.mkEnableOption "Dictation speech-to-text user service";

    package = lib.mkOption {
      type = lib.types.package;
      defaultText = lib.literalExpression "dictation.packages.\${system}.dictation";
      description = "The Dictation package to use.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.dictation = {
      Unit = {
        Description = "Dictation speech-to-text";
        After = [ "graphical-session.target" ];
        PartOf = [ "graphical-session.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/dictation";
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "graphical-session.target" ];
    };
  };
}
