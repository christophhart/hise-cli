# TODO list for features regarding multiline code editor

## MODES

[X] add /ui get & /builder get commands that work with /expect
[X] /expect Knob1.text is "Funky"
[X] /expect Sine.Gain is 0.5 
[X] /ui: set Knob1.value 0.5 should work

## UNDO / PLAN

[X] /builder reset should also discard the undo plan group (might be stale in the TUI from a previous run)
[X] a unclosed plan group at the end of a script should be a hard failure
[X] plan messages should not be filtered out from the log:  "Enter plan mode" et al should be displayed

## Multiline Editor

[X] add F7 that validates with multiline diagnostic
[X] add a dryrun parameter to all HTTP apply endpoints - use for validation of scripts.
[X] Ctrl+Z/Y => undo/redo?
[X] right click -> copy selection (with indicator)
[X] /expect 0 is false => should pass (/expect 1 is true), /expect "true" is true

## Editor Data model

[X] show project folder in top bar in format Demo Project | D:\Development\MyPath:main 
    (:main dimmed if git repo)l. If HISE is not connected, show the CWD of the terminal.
[X] /edit "funky.hsc" => loads the file from the current project folder. F5 
    (or F7 with correct validation) saves the file.
[X] closing a multiline editor does not wipe the content (TUI app needs persistent code content)
[X] don't show the entire script in the output box, just show "> Execute     script "noice.hsc".
[X] /run "funky.hsc" - directly executes the script. supports wildcards, so /run 
    "tests/.hsc" should run all tests.
[X] oneshot commands should be displayed in the log => /script Math.random() => 5124

## Script compiler

[X] a /callback command in the /script mode that does not call the methods but collect lines & merges to callbacks then sends it to the /set_script (or whatever) endpoint and

## A HISE control mode

mode colour: SIGNAL_COLOUR

[ ] Checks "where HISE / where HISE Debug.exe", then calls "HISE.exe start_server"
/hise launch [Debug]

[ ] Closes HISE (api/shutdown)
/hise shutdown

[ ] Create a screenshot of the interface /api/screenshot
/hise screenshot Images/test1.png

[ ] Start a profile session /api/profile
/hise profile 
