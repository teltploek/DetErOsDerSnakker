start explorer.exe "C:\Projects\Private projects\DetErOsDerSnakker"

set-location "C:\Projects\Private projects\DetErOsDerSnakker"
Start-Process Powershell 'node app'

start chrome.exe http://localhost:3000