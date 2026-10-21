var TMUX_CANDIDATES = [
  "/opt/homebrew/bin/tmux",
  "/usr/local/bin/tmux",
  "/opt/local/bin/tmux",
  "/usr/bin/tmux",
];

// Each script receives one argument: the shell line to run in a new window.
var TERMINAL_SCRIPTS = {
  ghostty: [
    "on run argv",
    'tell application "Ghostty"',
    "activate",
    "set cfg to new surface configuration",
    "set initial input of cfg to (item 1 of argv) & linefeed",
    "new window with configuration cfg",
    "end tell",
    "end run",
  ],
  iterm: [
    "on run argv",
    'tell application "iTerm"',
    "activate",
    "set w to (create window with default profile)",
    "tell current session of w to write text (item 1 of argv)",
    "end tell",
    "end run",
  ],
  terminal: [
    "on run argv",
    'tell application "Terminal"',
    "activate",
    "do script (item 1 of argv)",
    "end tell",
    "end run",
  ],
};

// kitty has no AppleScript support, so it runs the shell line itself and then
// hands over to a login shell, matching the typed-in line in the others.
// Launching through "open" gives kitty a fresh environment instead of Nova's,
// so shell startup files don't mistake its shells for Nova terminal tabs.
function kittyArgs(shellLine) {
  var shell = nova.environment.SHELL || "/bin/zsh";
  var args = ["-n", "-a", "kitty", "--args", "--single-instance"];
  if (nova.workspace.path) {
    args.push("--directory", nova.workspace.path);
  }
  args.push(shell, "-lic", shellLine + "; exec " + shellQuote(shell) + " -l");
  return args;
}

exports.activate = function () {
  // Do work when the extension is activated
};

exports.deactivate = function () {
  // Clean up state before the extension is deactivated
};

function shellQuote(text) {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

function showError(message, detail) {
  nova.workspace.showInformativeMessage(
    nova.localize(message) + (detail ? "\n\n" + detail : "")
  );
}

// tmux silently turns "." and ":" into "_", so do the same up front to keep
// the names we use matching the names tmux actually creates.
function cleanName(name) {
  return name.replace(/[.:]/g, "_");
}

// The name for a new session made from this extension.
function defaultSessionName() {
  return cleanName(nova.path.basename(nova.workspace.path));
}

function tmuxPath() {
  var path = nova.config.get("tmux.path", "string");
  if (path) {
    return path;
  }
  for (var i = 0; i < TMUX_CANDIDATES.length; i++) {
    if (nova.fs.access(TMUX_CANDIDATES[i], nova.fs.X_OK)) {
      return TMUX_CANDIDATES[i];
    }
  }
  return null;
}

// The command typed into a shell; bare "tmux" relies on the user's own PATH
// unless they have pointed the extension at a specific binary. "new -A"
// joins the session if it exists and creates it in the project folder if not.
function attachCommand(name) {
  var path = nova.config.get("tmux.path", "string");
  var command = (path ? shellQuote(path) : "tmux") + " new -A -s " + shellQuote(name);
  if (nova.workspace.path) {
    command += " -c " + shellQuote(nova.workspace.path);
  }
  return command;
}

function run(path, args) {
  return new Promise(function (resolve) {
    var process = new Process(path, { args: args });
    var stdout = [];
    var stderr = [];

    process.onStdout(function (data) {
      stdout.push(data);
    });
    process.onStderr(function (data) {
      stderr.push(data);
    });
    process.onDidExit(function (status) {
      resolve({
        status: status,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      });
    });

    try {
      process.start();
    } catch (error) {
      resolve({ status: -1, stdout: "", stderr: String(error) });
    }
  });
}

function runTmux(args) {
  var tmux = tmuxPath();
  if (!tmux) {
    showError("tmux was not found. Install it or set its path in the extension preferences.");
    return Promise.resolve(null);
  }
  return run(tmux, args);
}

// With tmux as Nova's terminal shell, each tab is its own session, started
// in the project folder. A session belongs to a project by that start folder.
function listSessions() {
  var format = "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_path}";
  return runTmux(["list-sessions", "-F", format]).then(function (result) {
    // A non-zero exit here just means no tmux server is running yet.
    if (!result || result.status != 0) {
      return [];
    }
    return result.stdout
      .split("\n")
      .filter(function (line) {
        return line.length > 0;
      })
      .map(function (line) {
        var fields = line.split("\t");
        return {
          name: fields[0],
          windows: parseInt(fields[1], 10),
          attached: parseInt(fields[2], 10),
          path: fields[3],
        };
      });
  });
}

function projectSessions() {
  return listSessions().then(function (sessions) {
    return sessions.filter(function (session) {
      return session.path === nova.workspace.path;
    });
  });
}

function sessionLabel(session) {
  var label = session.name;
  label += " — " + session.windows + " ";
  label += session.windows == 1 ? nova.localize("window") : nova.localize("windows");
  if (session.attached > 0) {
    label += ", " + nova.localize("open in") + " " + session.attached + " ";
    label += session.attached == 1 ? nova.localize("terminal") : nova.localize("terminals");
  }
  if (session.path) {
    label += " " + (session.path === nova.workspace.path
      ? nova.localize("(this project)")
      : "(" + nova.path.basename(session.path) + ")");
  }
  return label;
}

function openExternal(name) {
  var terminal = nova.config.get("tmux.terminal", "string") || "ghostty";
  var lines = TERMINAL_SCRIPTS[terminal];
  if (!lines && terminal !== "kitty") {
    showError("Unknown external terminal:", terminal);
    return;
  }

  var shellLine = attachCommand(name);
  if (nova.workspace.path) {
    shellLine = "cd " + shellQuote(nova.workspace.path) + " && " + shellLine;
  }

  var command = "/usr/bin/osascript";
  var args = [];
  if (terminal === "kitty") {
    command = "/usr/bin/open";
    args = kittyArgs(shellLine);
  } else {
    lines.forEach(function (line) {
      args.push("-e", line);
    });
    args.push(shellLine);
  }

  run(command, args).then(function (result) {
    if (result.status != 0) {
      showError("Error opening external terminal:", result.stderr);
    }
  });
}

function copyAttachCommand(name) {
  nova.clipboard.writeText(attachCommand(name)).then(function () {
    nova.workspace.showInformativeMessage(
      nova.localize("Copied. Paste it into a terminal to join the session") +
        " “" + name + "”."
    );
  });
}

function renameSession(name) {
  nova.workspace.showInputPalette(
    nova.localize("New name for the tmux session") + " “" + name + "”",
    { placeholder: name, value: name },
    function (value) {
      var newName = value ? cleanName(value.trim()) : "";
      if (!newName || newName === name) {
        return;
      }
      runTmux(["rename-session", "-t", "=" + name, newName]).then(function (result) {
        if (result && result.status != 0) {
          showError("Error renaming session:", result.stderr);
        }
      });
    }
  );
}

function killSession(name) {
  nova.workspace.showActionPanel(
    nova.localize("End the tmux session") + " “" + name + "”? " +
      nova.localize("Anything running in it will be stopped."),
    {
      buttons: [nova.localize("End Session"), nova.localize("Cancel")],
    },
    function (index) {
      if (index !== 0) {
        return;
      }
      runTmux(["kill-session", "-t", "=" + name]).then(function (result) {
        if (result && result.status != 0) {
          showError("Error ending session:", result.stderr);
        }
      });
    }
  );
}

function showSessions() {
  listSessions().then(function (sessions) {
    if (sessions.length === 0) {
      nova.workspace.showInformativeMessage(
        nova.localize("No tmux sessions are running.")
      );
      return;
    }

    var choices = sessions.map(sessionLabel);

    nova.workspace.showChoicePalette(
      choices,
      { placeholder: nova.localize("tmux sessions") },
      function (choice, index) {
        if (choice === null) {
          return;
        }
        chooseSessionAction(sessions[index].name);
      }
    );
  });
}

function chooseSessionAction(name) {
  var actions = [
    { title: nova.localize("Open in External Terminal"), run: openExternal },
    { title: nova.localize("Copy Join Command"), run: copyAttachCommand },
    { title: nova.localize("Rename Session…"), run: renameSession },
    { title: nova.localize("End Session…"), run: killSession },
  ];

  nova.workspace.showChoicePalette(
    actions.map(function (action) {
      return action.title;
    }),
    { placeholder: name },
    function (choice, index) {
      if (choice !== null) {
        actions[index].run(name);
      }
    }
  );
}

// Runs callback with one of this project's sessions, asking which when there
// are several. With none, it runs with a new session's name if allowNew is
// set, and otherwise says so.
function withProjectSession(allowNew, callback) {
  if (!nova.workspace.path) {
    showError("This workspace has no folder, so it has no tmux sessions.");
    return;
  }
  projectSessions().then(function (sessions) {
    if (sessions.length === 1) {
      callback(sessions[0].name);
    } else if (sessions.length > 1) {
      nova.workspace.showChoicePalette(
        sessions.map(sessionLabel),
        { placeholder: nova.localize("Choose a tmux session") },
        function (choice, index) {
          if (choice !== null) {
            callback(sessions[index].name);
          }
        }
      );
    } else if (allowNew) {
      callback(defaultSessionName());
    } else {
      nova.workspace.showInformativeMessage(
        nova.localize("This project has no tmux sessions running.")
      );
    }
  });
}

// Settings that make tmux behave more like Nova's own terminal. Keep in step
// with the README's "Recommended tmux settings".
var RECOMMENDED_CONFIG = [
  "# More scrollback",
  "set -g history-limit 50000",
  "",
  "# Mouse control: drag to select, copied to the macOS clipboard on release",
  "set -g mouse on",
  "bind -T copy-mode    MouseDragEnd1Pane send -X copy-pipe-and-cancel",
  "bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe-and-cancel",
  "# A plain click in copy mode clears the selection rather than starting one",
  "bind -T copy-mode    MouseDown1Pane select-pane \\; send -X clear-selection",
  "bind -T copy-mode-vi MouseDown1Pane select-pane \\; send -X clear-selection",
  "",
  "# Clicking away from Nova mid-drag can leave tmux extending a selection with",
  "# every later mouse move. Clear it whenever the terminal loses or gains focus.",
  "set -g focus-events on",
  "set-hook -g client-focus-out 'if -F \"#{pane_in_mode}\" \"send -X clear-selection\"'",
  "set-hook -g client-focus-in  'if -F \"#{pane_in_mode}\" \"send -X clear-selection\"'",
  "",
  "# Send tmux copies to the macOS clipboard (tmux 3.2+)",
  "set -s copy-command 'pbcopy'",
  "set -g set-clipboard on",
  "set -as terminal-features ',*:clipboard'",
  "",
  "# PageUp from a prompt scrolls back; scrolling to the bottom returns to the prompt",
  "bind -n PageUp copy-mode -eu",
].join("\n") + "\n";

// A launchd agent that runs the tmux server outside Nova, so sessions survive
// Nova quitting or crashing. Keep in step with the README.
function launchAgent() {
  var lang = nova.environment.LANG || "en_US.UTF-8";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "    <key>Label</key>",
    "    <string>local.tmux</string>",
    "    <key>ProgramArguments</key>",
    "    <array>",
    "        <string>" + xmlEscape(tmuxPath() || "/opt/homebrew/bin/tmux") + "</string>",
    "        <string>-D</string>",
    "    </array>",
    "    <key>EnvironmentVariables</key>",
    "    <dict>",
    "        <key>PATH</key>",
    "        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>",
    "        <key>LANG</key>",
    "        <string>" + xmlEscape(lang) + "</string>",
    "    </dict>",
    "    <key>RunAtLoad</key>",
    "    <true/>",
    "    <key>KeepAlive</key>",
    "    <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function xmlEscape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function copySnippet(text, message) {
  nova.clipboard.writeText(text).then(function () {
    nova.workspace.showInformativeMessage(nova.localize(message));
  });
}

nova.commands.register("tmux.openExternal", function () {
  withProjectSession(true, openExternal);
});

nova.commands.register("tmux.copyAttachCommand", function () {
  withProjectSession(true, copyAttachCommand);
});

nova.commands.register("tmux.sessions", function () {
  showSessions();
});

nova.commands.register("tmux.renameSession", function () {
  withProjectSession(false, renameSession);
});

nova.commands.register("tmux.killSession", function () {
  withProjectSession(false, killSession);
});

nova.commands.register("tmux.copyConfig", function () {
  copySnippet(
    RECOMMENDED_CONFIG,
    "Copied. Add it to ~/.tmux.conf, then run tmux source-file ~/.tmux.conf or open a new tab."
  );
});

nova.commands.register("tmux.copyLaunchAgent", function () {
  copySnippet(
    launchAgent(),
    "Copied. Save it as ~/Library/LaunchAgents/local.tmux.plist, then run launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tmux.plist"
  );
});
