# Mode switching — enter and exit modes, verify prompts
# This tape tests basic mode stack navigation.

Set Width 140
Set Height 34
Set Connection "mock"

# Start in root mode
ExpectPrompt "> "

# Enter script mode
Type "/script"
Enter
Sleep 300ms
ExpectMode "script"
ExpectPrompt "[script] >"

# Exit back to root
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
ExpectPrompt "> "

# Enter builder mode
Type "/builder"
Enter
Sleep 300ms
ExpectMode "builder"
ExpectPrompt "[builder] >"

# Exit back to root
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
ExpectPrompt "> "

# Enter inspect mode
Type "/inspect"
Enter
Sleep 300ms
ExpectMode "inspect"
ExpectPrompt "[inspect] >"

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
