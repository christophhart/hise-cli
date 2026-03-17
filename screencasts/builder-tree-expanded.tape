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
Sleep 500ms
ExpectMode "builder"

# Open the sidebar
Ctrl+B
Sleep 500ms

# The tree should be fully expanded by default.
# "Oscillators" is a direct child of root — visible even if only root expanded
Expect "Oscillators" sidebar

# "Osc 1" is a child of Oscillators — only visible if Oscillators is expanded
Expect "Osc 1" sidebar

# "KeyNumber" is deeply nested (5 levels) — only visible if everything is expanded
Expect "KeyNumber" sidebar

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
