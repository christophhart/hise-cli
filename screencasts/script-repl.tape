# Script REPL — enter script mode, verify prompt, exit
# Tests script mode entry, prompt display, and exit.
# Expression evaluation (requires HISE or SetMockResponse) is
# deferred until mock response support is added to the pty runner.

Set Width 140
Set Height 34

# Enter script mode
Type "/script"
Enter
Sleep 500ms
ExpectMode "script"
Expect "Script" statusbar

# Exit
Type "/exit"
Enter
Sleep 500ms
ExpectMode "root"
