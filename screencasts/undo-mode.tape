# Undo mode — entry, history, plan lifecycle
#
# Tests the /undo mode with mock connection.

Set Width 140
Set Height 34
Set Connection "mock"

Type "/undo"
Enter
Sleep 500ms
ExpectMode "undo"
Expect "Undo" statusbar

# History should be empty initially
Type "history"
Enter
Sleep 300ms
Expect "No undo history" output

# Start a plan
Type "plan \"Test Plan\""
Enter
Sleep 300ms
Expect "Test Plan"

# Discard the plan
Type "discard"
Enter
Sleep 300ms
Expect "Discarded"
Expect "Undo" statusbar

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
