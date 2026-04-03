# Builder tree — verify tree is fully expanded on open
#
# TDD test: the tree sidebar should show all nodes expanded
# by default when opened in builder mode (not just root).
# Asserts deeply nested nodes are visible in the sidebar region.

Set Width 140
Set Height 34
Set Connection "mock"

Type "/builder"
Enter
Sleep 1000ms
ExpectMode "builder"

# Open the sidebar
Ctrl+B
Sleep 1000ms

# The tree should be fully expanded by default.
# "Master Chain" is the root — always visible (check full screen, sidebar region
# detection depends on search icon rendering which may not be captured in PTY)
Expect "Master Chain"

# "Osc 1" is a direct child (sound generator) — visible if root is expanded
Expect "Osc 1"

# "Gain Modulation" is a modulation chain — visible if fully expanded
Expect "Gain Modulation"

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
