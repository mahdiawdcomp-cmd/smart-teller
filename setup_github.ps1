Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   Smart Teller - Push Code to GitHub Tool        " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (!(Test-Path .git)) {
    Write-Host "Error: Git is not initialized in this directory." -ForegroundColor Red
    Exit
}

# Prompt user for GitHub URL
$repoUrl = Read-Host "Enter your GitHub repository URL (e.g. https://github.com/username/repo-name.git)"
if ([string]::IsNullOrWhiteSpace($repoUrl)) {
    Write-Host "Error: Repository URL is empty." -ForegroundColor Red
    Exit
}

try {
    # Check if origin already exists, remove it if it does
    $originExists = git remote get-url origin 2>$null
    if ($originExists) {
        git remote remove origin
        Write-Host "Updating repository URL..." -ForegroundColor Yellow
    }
    
    # Add remote and rename branch
    git remote add origin $repoUrl
    git branch -M main
    
    Write-Host ""
    Write-Host "Pushing code to GitHub..." -ForegroundColor Yellow
    Write-Host "Note: If not logged in, a browser window will open to authenticate GitHub." -ForegroundColor Gray
    
    git push -u origin main
    
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "Success: Code pushed successfully to GitHub!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "Next step: Go to Render.com and connect your repository." -ForegroundColor Cyan
}
catch {
    Write-Host ""
    Write-Host "Error occurred during push. Please check:" -ForegroundColor Red
    Write-Host "1. You created an empty repository on GitHub." -ForegroundColor Red
    Write-Host "2. Your internet connection is active." -ForegroundColor Red
    Write-Host "3. You have write permissions to the repository." -ForegroundColor Red
}
