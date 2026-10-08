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

// A project's session is found by the folder path stored in this tmux user
// option rather than by its name, so it can be renamed freely, here or with
// tmux's own prefix-$, without losing track of it.
var PATH_OPTION = "@nova_path";

// tmux silently turns "." and ":" into "_", so do the same up front to keep
// the names we look up matching the names tmux actually creates.
function cleanName(name) {
  return name.replace(/[.:]/g, "_");
}

// The name a project's session gets when it is first created.
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
// unless they have pointed the extension at a specific binary.
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

// Grouped sessions (one per Nova terminal tab, see README) share their
// windows with the session they were made from, so they are folded into it.
// tmux keeps a group's original name after a rename, so each entry is named
// after its main session (the one tagged with a project path) instead.
function listSessions() {
  var format =
    "#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_group}\t#{" +
    PATH_OPTION + "}";
  return runTmux(["list-sessions", "-F", format]).then(function (result) {
    // A non-zero exit here just means no tmux server is running yet.
    if (!result || result.status != 0) {
      return [];
    }
    var sessions = [];
    var byName = {};
    result.stdout
      .split("\n")
      .filter(function (line) {
        return line.length > 0;
      })
      .forEach(function (line) {
        var fields = line.split("\t");
        var key = fields[3] || fields[0];
        var session = byName[key];
        if (!session) {
          session = byName[key] = {
            name: fields[0],
            path: "",
            windows: parseInt(fields[1], 10),
            attached: 0,
            members: [],
          };
          sessions.push(session);
        }
        if (fields[4]) {
          session.name = fields[0];
          session.path = fields[4];
        } else if (!session.path && fields[0] === key) {
          session.name = fields[0];
        }
        session.attached += parseInt(fields[2], 10);
        session.members.push(fields[0]);
      });
    return sessions;
  });
}

// The running session for this project, or null. A session that still has
// the project's default name but no path (made by a pasted join command, say)
// is adopted by tagging it, which is what the README's zsh snippet does too.
function findProjectSession() {
  return listSessions().then(function (sessions) {
    var adopt = null;
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].path === nova.workspace.path) {
        return sessions[i];
      }
      if (!sessions[i].path && sessions[i].name === defaultSessionName()) {
        adopt = sessions[i];
      }
    }
    if (!adopt) {
      return null;
    }
    return runTmux(["set", "-t", "=" + adopt.name + ":", PATH_OPTION, nova.workspace.path]).then(
      function () {
        adopt.path = nova.workspace.path;
        return adopt;
      }
    );
  });
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
      nova.localize("Copied. Paste it into a Nova terminal to join the session") +
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
      listSessions().then(function (sessions) {
        var members = [name];
        sessions.forEach(function (session) {
          if (session.name === name) {
            members = session.members;
          }
        });
        // Per-tab sessions are named "<session>-<pid>"; keep them matching.
        members.forEach(function (member) {
          var target = member;
          if (member === name) {
            target = newName;
          } else if (member.indexOf(name + "-") === 0) {
            target = newName + member.slice(name.length);
          }
          if (target === member) {
            return;
          }
          runTmux(["rename-session", "-t", "=" + member, target]).then(function (result) {
            if (result && result.status != 0) {
              showError("Error renaming session:", result.stderr);
            }
          });
        });
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
      listSessions().then(function (sessions) {
        var members = [name];
        sessions.forEach(function (session) {
          if (session.name === name) {
            members = session.members;
          }
        });
        members.forEach(function (member) {
          runTmux(["kill-session", "-t", "=" + member]).then(function (result) {
            if (result && result.status != 0) {
              showError("Error ending session:", result.stderr);
            }
          });
        });
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

    var choices = sessions.map(function (session) {
      var label = session.name;
      label += " — " + session.windows + " ";
      label += session.windows == 1 ? nova.localize("window") : nova.localize("windows");
      if (session.attached > 0) {
        label += ", " + nova.localize("open in") + " " + session.attached + " ";
        label += session.attached == 1 ? nova.localize("terminal") : nova.localize("terminals");
      }
      if (session.path && session.path === nova.workspace.path) {
        label += " " + nova.localize("(this project)");
      }
      return label;
    });

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

// Runs callback with the name of this project's session, or the name it
// will get when it is created.
function withSessionName(callback) {
  if (!nova.workspace.path) {
    showError("This workspace has no folder, so it has no tmux session.");
    return;
  }
  findProjectSession().then(function (session) {
    callback(session ? session.name : defaultSessionName());
  });
}

// For commands that need the session to exist already.
function withRunningSession(callback) {
  if (!nova.workspace.path) {
    showError("This workspace has no folder, so it has no tmux session.");
    return;
  }
  findProjectSession().then(function (session) {
    if (session) {
      callback(session.name);
    } else {
      nova.workspace.showInformativeMessage(
        nova.localize("This project's tmux session isn't running.")
      );
    }
  });
}

nova.commands.register("tmux.openExternal", function () {
  withSessionName(openExternal);
});

nova.commands.register("tmux.copyAttachCommand", function () {
  withSessionName(copyAttachCommand);
});

nova.commands.register("tmux.sessions", function () {
  showSessions();
});

nova.commands.register("tmux.renameSession", function () {
  withRunningSession(renameSession);
});

nova.commands.register("tmux.killSession", function () {
  withRunningSession(killSession);
});
