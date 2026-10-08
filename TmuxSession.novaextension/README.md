# Tmux Session

Use the same [tmux](https://github.com/tmux/tmux) session in Nova and an external terminal: Ghostty, iTerm, kitty or Terminal.

With the shell setup below, each project gets a session and each Nova terminal tab gets a tmux window. Close a tab or quit Nova and your shells, builds and other processes keep running. Open another tab to return to an unused window, or join the session from your external terminal.

tmux also provides split panes, windows and searchable scrollback inside Nova's terminal.

## Setup

1. Install tmux: `brew install tmux`
2. Add this to the end of `~/.zshrc` to have Nova terminal tabs join the project's session:

   ```sh
   # Tmux Session for Nova: each Nova terminal tab gets its own window in the
   # project's tmux session, reusing a window that no tab is showing. Sessions
   # are found by project folder, so they can be renamed.
   if [[ "$__CFBundleIdentifier" == "com.panic.Nova" && -z "$TMUX" ]] && (( $+commands[tmux] )); then
     () {
       local base win
       base=$(tmux list-sessions -F "#{@nova_path}"$'\t'"#{session_name}" 2>/dev/null |
         awk -F '\t' -v p="$PWD" '$1 == p { print $2; exit }')
       if [[ -z $base ]]; then
         base=${${PWD:t}//[.:]/_}
         tmux has-session -t "=$base" 2>/dev/null || tmux new-session -d -s "$base" -c "$PWD"
         tmux set -t "=$base:" @nova_path "$PWD"
       fi
       win=$(tmux list-windows -t "=$base" -F '#{window_active_clients} #{window_id}' | awk '$1 == 0 { print $2; exit }')
       [[ -n $win ]] || win=$(tmux new-window -d -P -F '#{window_id}' -t "=$base:" -c "$PWD")
       tmux new-session -t "=$base" -s "$base-$$" \; set-option destroy-unattached on \; select-window -t "$win"
     }
   fi
   ```

3. Open a new terminal tab in Nova. You'll see tmux's status bar along the bottom.

New tabs reuse tmux windows that no other tab is showing. If all windows are in use, a new one is created.

## Commands

These commands are available under **Extensions > Tmux Session** and in the Command Palette.

| Command | What it does |
|---|---|
| **Open in External Terminal** | Opens this project's session in your terminal app |
| **Copy Join Command** | Copies a command you can paste into another terminal to join the session |
| **Show All Sessions…** | Lists every running session, so you can open, copy, rename or end one |
| **Rename Session…** | Gives this project's session a new name |
| **End Session…** | Ends this project's session and everything running in it |

## Settings

In **Extensions > Extension Library > Tmux Session > Settings**:

- **External Terminal**: the app used by **Open in External Terminal**. Ghostty by default.
- **tmux Path**: only needed if tmux isn't found automatically.

A new session is named after the project folder. To rename it, use **Rename Session…**. Nova tabs and the commands still find it afterwards, because sessions are matched to their project folder, not their name. (tmux's own rename shortcut, Ctrl+B then `$`, only renames the tab you're in.)

## Tips

- tmux's default shortcut prefix is Ctrl+B. Nova reserves Cmd for its own shortcuts.
- When Nova and another terminal show the same window, tmux sizes it to whichever one you typed in last.
- tmux's status bar cuts session names off after 9 characters. To show the full name, without the number added to each Nova tab's session, add this to `~/.tmux.conf`:

  ```
  set -g status-left-length 40
  set -g status-left '[#{?@nova_path,#{session_name},#{?session_grouped,#{s/-[0-9]+$//:session_name},#{session_name}}}] '
  ```

## Troubleshooting

**Open in External Terminal does nothing.** Check that your terminal app is enabled under **System Settings > Privacy & Security > Automation > Nova**. For error details, open **Extensions > Show Extension Console**.

**Ghostty shows an AppleScript error.** Update Ghostty to version 1.3 or later, or choose another terminal in Settings.

**"tmux was not found."** Set **tmux Path** in Settings.

**New Nova tabs don't join the session.** Check that the setup snippet is in `~/.zshrc`, then open a new tab. It won't affect tabs that are already open.

**A new tab shows an old window.** New tabs reuse windows that are still running but aren't being shown elsewhere. Type `exit` in a shell to close its window when you're finished with it.

**Part of a Nova tab is filled with dots.** Another terminal is showing the same window at a different size. Type in the Nova tab and it resizes to fit.

**A Nova tab fills with random text.** Image output from apps running in Ghostty or kitty can appear as garbled text in Nova, which doesn't support terminal images. Run `tmux refresh-client` to redraw the tab.

## Requirements

- [tmux](https://github.com/tmux/tmux)
- zsh, the macOS default shell, for the setup snippet
- For **Open in External Terminal**, one of:
  - [Ghostty](https://ghostty.org) 1.3 or later
  - [iTerm](https://iterm2.com)
  - [kitty](https://sw.kovidgoyal.net/kitty/)
  - Terminal

The first time you open a session in Ghostty, iTerm or Terminal, macOS asks whether Nova may control that app. kitty doesn't need this permission.
