start explorer.exe "C:\Projects\Private projects\DetErOsDerSnakker"

set-location "C:\Projects\Private projects\DetErOsDerSnakker"
Start-Process Powershell 'node app'

set-location "C:\mongodb\bin"
Start-Process Powershell '.\mongod.exe --dbpath C:\mongodb\bin\data\mongodb'

start chrome.exe http://localhost:3000