# Mode switching — enter and exit modes, verify prompts
# This tape tests basic mode stack navigation.

Set Width 140
Set Height 34
Set Connection "mock"

# Start in root mode
Expect "Root" statusbar

# Enter script mode
Type "/script"
Enter
Sleep 300ms
ExpectMode "script"
Expect "Script" statusbar

# Exit back to root
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
Expect "Root" statusbar

# Enter builder mode
Type "/builder"
Enter
Sleep 300ms
ExpectMode "builder"
Expect "Builder" statusbar

# Exit back to root
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
Expect "Root" statusbar

# Enter inspect mode
Type "/inspect"
Enter
Sleep 300ms
ExpectMode "inspect"
Expect "Inspect" statusbar

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
