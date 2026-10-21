# Tmux Session

Use [tmux](https://github.com/tmux/tmux) as Nova's terminal shell, and open any of its sessions in an external terminal: Ghostty, iTerm, kitty or Terminal.

Set tmux as Nova's terminal shell and each Nova terminal tab runs its own tmux session in the project folder. Quit tmux and the tab closes. Close the tab instead and the session keeps running, so you can join it again from Nova or your external terminal.

tmux also provides split panes, windows and searchable scrollback inside Nova's terminal.

## Setup

1. Install tmux: `brew install tmux`
2. In Nova's **Settings > Terminal**, set the shell to tmux: `/opt/homebrew/bin/tmux` (run `which tmux` if yours is elsewhere).
3. Open a new terminal tab in Nova. You'll see tmux's status bar along the bottom.

If you used the `~/.zshrc` snippet from version 1.x, remove it.

### Keep sessions after quitting Nova

If the tmux server is started by Nova's first terminal tab, it belongs to Nova and its sessions can end when Nova quits or crashes. To keep them around to reattach to later, start the server outside Nova with a launchd agent. Then if Nova crashes, none of your sessions are lost: everything running in them carries on, and you can rejoin them when Nova is back.

Run **Copy launchd Agent** to copy the agent with your tmux path and locale filled in, or copy it from here. Save it as `~/Library/LaunchAgents/local.tmux.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>local.tmux</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/tmux</string>
        <string>-D</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>LANG</key>
        <string>en_US.UTF-8</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then load it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.tmux.plist`. The server starts now and at every login, and restarts if it stops. Set `LANG` to your own locale.

### Recommended tmux settings

These make tmux behave more like Nova's own terminal: scroll and select with the mouse, copy to the macOS clipboard, and page back through output. Run **Copy Recommended tmux Settings** to copy them, or copy them from here. Add them to `~/.tmux.conf`, then run `tmux source-file ~/.tmux.conf` or open a new tab:

```
# More scrollback
set -g history-limit 50000

# Mouse control: drag to select, copied to the macOS clipboard on release
set -g mouse on
bind -T copy-mode    MouseDragEnd1Pane send -X copy-pipe-and-cancel
bind -T copy-mode-vi MouseDragEnd1Pane send -X copy-pipe-and-cancel
# A plain click in copy mode clears the selection rather than starting one
bind -T copy-mode    MouseDown1Pane select-pane \; send -X clear-selection
bind -T copy-mode-vi MouseDown1Pane select-pane \; send -X clear-selection

# Clicking away from Nova mid-drag can leave tmux extending a selection with
# every later mouse move. Clear it whenever the terminal loses or gains focus.
set -g focus-events on
set-hook -g client-focus-out 'if -F "#{pane_in_mode}" "send -X clear-selection"'
set-hook -g client-focus-in  'if -F "#{pane_in_mode}" "send -X clear-selection"'

# Send tmux copies to the macOS clipboard (tmux 3.2+)
set -s copy-command 'pbcopy'
set -g set-clipboard on
set -as terminal-features ',*:clipboard'

# PageUp from a prompt scrolls back; scrolling to the bottom returns to the prompt
bind -n PageUp copy-mode -eu
```

## Commands

These commands are available under **Extensions > Tmux Session** and in the Command Palette.

| Command | What it does |
|---|---|
| **Open in External Terminal** | Opens one of this project's sessions in your terminal app |
| **Copy Join Command** | Copies a command you can paste into another terminal to join one of this project's sessions |
| **Show All Sessions…** | Lists every running session, so you can open, copy, rename or end one |
| **Rename Session…** | Gives one of this project's sessions a new name |
| **End Session…** | Ends one of this project's sessions and everything running in it |
| **Copy Recommended tmux Settings** | Copies the settings from [Recommended tmux settings](#recommended-tmux-settings) |
| **Copy launchd Agent** | Copies the agent from [Keep sessions after quitting Nova](#keep-sessions-after-quitting-nova), with your tmux path and locale |

## Settings

In **Extensions > Extension Library > Tmux Session > Settings**:

- **External Terminal**: the app used by **Open in External Terminal**. Ghostty by default.
- **tmux Path**: only needed if tmux isn't found automatically.

A project's sessions are the ones started in its folder. When there are several, the commands ask which one to use. When there are none, **Open in External Terminal** and **Copy Join Command** start a new session named after the project folder.

## Tips

- tmux's default shortcut prefix is Ctrl+B. Nova reserves Cmd for its own shortcuts.
- When Nova and another terminal show the same window, tmux sizes it to whichever one you typed in last.

## Troubleshooting

**Open in External Terminal does nothing.** Check that your terminal app is enabled under **System Settings > Privacy & Security > Automation > Nova**. For error details, open **Extensions > Show Extension Console**.

**Ghostty shows an AppleScript error.** Update Ghostty to version 1.3 or later, or choose another terminal in Settings.

**"tmux was not found."** Set **tmux Path** in Settings.

**New Nova tabs don't start tmux.** Check the shell in Nova's **Settings > Terminal**, then open a new tab. It won't affect tabs that are already open.

**Old sessions pile up.** Closing a Nova tab leaves its session running. Use **Show All Sessions…** to rejoin or end them, or quit tmux in the tab instead of closing it.

**Part of a Nova tab is filled with dots.** Another terminal is showing the same window at a different size. Type in the Nova tab and it resizes to fit.

**A Nova tab fills with random text.** Image output from apps running in Ghostty or kitty can appear as garbled text in Nova, which doesn't support terminal images. Run `tmux refresh-client` to redraw the tab.

## Requirements

- [tmux](https://github.com/tmux/tmux)
- For **Open in External Terminal**, one of:
  - [Ghostty](https://ghostty.org) 1.3 or later
  - [iTerm](https://iterm2.com)
  - [kitty](https://sw.kovidgoyal.net/kitty/)
  - Terminal

The first time you open a session in Ghostty, iTerm or Terminal, macOS asks whether Nova may control that app. kitty doesn't need this permission.
