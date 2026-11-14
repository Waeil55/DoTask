# Stores the App Store secrets in the GitHub repo, so the "iOS" and "iOS App Store listing" workflows can
# sign, upload and fill in App Review Information. Run it yourself; it asks for each value and sends it
# straight to GitHub (nothing is saved on this PC or printed).
#   powershell -NoProfile -ExecutionPolicy Bypass -File mobile\tools\set-store-secrets.ps1
# Needs the GitHub CLI signed in (gh auth status). Re-run any time to replace a value; Enter keeps it.
# Optional parameters pre-fill the answers (you still confirm each one with Enter):
#   -KeyFile <AuthKey_XXXXXXXXXX.p8>  -IssuerId <id>  -ContactName "<first last>"  -Phone "<+1 ...>"
#   -ReviewProject <Google Cloud project id>  creates the review-only Gemini key there with gcloud

param(
  [string]$KeyFile,
  [string]$IssuerId,
  [string]$ContactName,
  [string]$Phone,
  [string]$ReviewProject
)

$ErrorActionPreference = 'Stop'
$Repo = 'Waeil55/DoTask'

function Have($name) { (gh secret list -R $Repo 2>$null | ForEach-Object { ($_ -split "`t")[0] }) -contains $name }
function SetValue($name, $value) {
  # --body keeps the value exact (piping in Windows PowerShell would add a line break)
  gh secret set $name -R $Repo --body $value | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not set $name" }
  Write-Host "  saved $name" -ForegroundColor Green
}
function Ask($name, $prompt, $default) {
  $hint = if ($default) { " [Enter = $default]" } elseif (Have $name) { ' [Enter = keep the saved one]' } else { '' }
  $v = (Read-Host "$prompt$hint").Trim()
  if (-not $v) { $v = $default }
  if ($v) { SetValue $name $v } elseif (-not (Have $name)) { Write-Host "  skipped $name (still missing)" -ForegroundColor Yellow }
}
function AskHidden($name, $prompt) {
  $hint = if (Have $name) { ' [Enter = keep the saved one]' } else { '' }
  $s = Read-Host "$prompt$hint" -AsSecureString
  $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Trim()
  if ($v) { SetValue $name $v } elseif (-not (Have $name)) { Write-Host "  skipped $name (still missing)" -ForegroundColor Yellow }
  $v = $null
}

gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Sign in to GitHub first: gh auth login' }
Write-Host "`nDoTask store secrets for $Repo`n" -ForegroundColor Cyan

# 1. Apple team
Ask 'APPLE_TEAM_ID' 'Apple Team ID' 'UC8SHC93NW'

# 2. App Store Connect API key (the same Team key the Kiddos workflows use is fine)
Write-Host "`nApp Store Connect API key: pick the AuthKey_XXXXXXXXXX.p8 file you downloaded from"
Write-Host "Users and Access > Integrations > App Store Connect API (Team key, Admin access)."
Write-Host 'If you no longer have it, create a new Team key there (Apple lets you download it once).'
$picked = $null
if ($KeyFile -and (Test-Path -LiteralPath $KeyFile)) {
  $v = (Read-Host "Use the key file $KeyFile? [Enter = yes, n = pick another]").Trim()
  if ($v -notmatch '^n') { $picked = (Resolve-Path -LiteralPath $KeyFile).Path }
}
if (-not $picked) {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title = 'Pick your App Store Connect key (AuthKey_XXXXXXXXXX.p8)'
  $dlg.Filter = 'App Store Connect key (*.p8)|*.p8'
  $dlg.InitialDirectory = Join-Path $HOME 'Downloads'
  if ($dlg.ShowDialog() -eq 'OK') { $picked = $dlg.FileName }
}
if ($picked) {
  $p8 = Get-Content -Raw -LiteralPath $picked
  if ($p8 -notmatch 'BEGIN PRIVATE KEY') { throw 'That file is not an App Store Connect .p8 key' }
  SetValue 'ASC_KEY_P8' $p8.Trim()
  $p8 = $null
  $keyId = if ([IO.Path]::GetFileName($picked) -match '^AuthKey_([A-Z0-9]{10})\.p8$') { $Matches[1] } else { $null }
  Ask 'ASC_KEY_ID' 'Key ID (10 characters, shown next to the key)' $keyId
} elseif (-not (Have 'ASC_KEY_P8')) {
  Write-Host '  skipped ASC_KEY_P8 (still missing)' -ForegroundColor Yellow
}
Ask 'ASC_ISSUER_ID' 'Issuer ID (shown above the list of keys on the same page)' $IssuerId

# 3. App Review contact and review-only Gemini key (private App Review Information, never public)
Write-Host ''
Ask 'REVIEW_CONTACT_NAME' 'Your first and last name, for App Review' $ContactName
Ask 'REVIEW_PHONE' 'Phone number App Review may call, with country code (e.g. +1 555 123 4567)' $Phone

$made = $false
if ($ReviewProject) {
  # A key in its own no-billing project: free tier, and its own quota, so Apple's testing never
  # runs into your daily limit (or the other way round). Delete the key once DoTask is approved.
  $v = (Read-Host "`nCreate the review-only Gemini key in Google Cloud project $ReviewProject with gcloud? [Enter = yes, n = paste one instead]").Trim()
  if ($v -notmatch '^n') {
    $label = 'DoTask App Review (delete after approval)'
    # gcloud reports progress on stderr, which Windows PowerShell would treat as an error under 'Stop'
    $ErrorActionPreference = 'Continue'
    $uid = gcloud services api-keys list --project $ReviewProject --filter "displayName='$label'" --format 'value(uid)' --limit 1 2>$null
    if (-not $uid) {
      gcloud services api-keys create --project $ReviewProject --display-name $label --api-target=service=generativelanguage.googleapis.com 2>$null | Out-Null
      $uid = gcloud services api-keys list --project $ReviewProject --filter "displayName='$label'" --format 'value(uid)' --limit 1 2>$null
    }
    $key = if ($uid) { (gcloud services api-keys get-key-string $uid --project $ReviewProject --format 'value(keyString)' 2>$null | Out-String).Trim() } else { '' }
    $ErrorActionPreference = 'Stop'
    if (-not $uid) { throw "gcloud could not create the key in $ReviewProject" }
    if ($key -notmatch '^AIza') { throw 'gcloud did not return the new key' }
    SetValue 'REVIEWER_GEMINI_KEY' $key
    $key = $null
    $made = $true
  }
}
if (-not $made) {
  Write-Host "`nReview-only Gemini key: create a NEW key for Apple's reviewers (Google AI Studio opens now)."
  Write-Host 'Delete it in AI Studio once DoTask is approved.'
  Start-Process 'https://aistudio.google.com/apikey'
  AskHidden 'REVIEWER_GEMINI_KEY' 'Paste the review-only Gemini key (hidden)'
}

Write-Host "`nSaved secrets:" -ForegroundColor Cyan
gh secret list -R $Repo
Write-Host "`nDone. Tell Claude, or run: gh workflow run ios.yml -R $Repo -f upload=true" -ForegroundColor Cyan
