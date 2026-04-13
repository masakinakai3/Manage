$ErrorActionPreference = 'Stop'

Write-Host 'Running backend tests...'
python -m pytest

Write-Host 'Running frontend tests...'
Push-Location frontend
npm test
npm run lint
npm run format:check
Pop-Location
