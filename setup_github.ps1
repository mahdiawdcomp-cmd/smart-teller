Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   أداة رفع مشروع حساب الصراف الذكي إلى GitHub   " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (!(Test-Path .git)) {
    Write-Host "❌ نظام Git غير مهيأ في هذا المجلد." -ForegroundColor Red
    Exit
}

# Prompt user for GitHub URL
$repoUrl = Read-Host "⌨️ يرجى لصق رابط مستودع GitHub الخاص بك (مثلاً: https://github.com/username/repo-name.git)"
if ([string]::IsNullOrWhiteSpace($repoUrl)) {
    Write-Host "❌ لم تقم بإدخال رابط المستودع." -ForegroundColor Red
    Exit
}

try {
    # Check if origin already exists, remove it if it does
    $originExists = git remote get-url origin 2>$null
    if ($originExists) {
        git remote remove origin
        Write-Host "ℹ️ تم تحديث رابط المستودع السابق..." -ForegroundColor Yellow
    }
    
    # Add remote and rename branch
    git remote add origin $repoUrl
    git branch -M main
    
    Write-Host ""
    Write-Host "🚀 جاري رفع الكود إلى GitHub..." -ForegroundColor Yellow
    Write-Host "ملاحظة: إذا لم تقم بتسجيل الدخول مسبقاً، قد تظهر لك نافذة من المتصفح لتأكيد هويتك على GitHub." -ForegroundColor Gray
    
    git push -u origin main
    
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "✅ تم رفع الكود بنجاح إلى مستودعك السحابي على GitHub!" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "الخطوة القادمة هي الذهاب لموقع Render.com وربط المستودع لتشغيل الموقع مجاناً." -ForegroundColor Cyan
}
catch {
    Write-Host ""
    Write-Host "❌ حدث خطأ أثناء الرفع. يرجى التأكد من:" -ForegroundColor Red
    Write-Host "1. أنك أنشأت مستودعاً فارغاً (Empty Repository) على موقع GitHub بنفس الاسم." -ForegroundColor Red
    Write-Host "2. أن جهازك متصل بالإنترنت." -ForegroundColor Red
    Write-Host "3. أن لديك صلاحية الوصول والكتابة للمستودع المحدد." -ForegroundColor Red
}
